import * as fs from 'fs';
import * as path from 'path';
import * as less from 'less';
import * as vm from 'vm';

const TAGS_TO_REPLACE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#x27;',
  '/': '&#x2F;',
  '\\': '&#x5C;',
};

export function escapeString(str: string = ''): string {
  return str.replace(/[&<>"'\/\\]/g, (tag) => TAGS_TO_REPLACE[tag] || tag);
}

export function removeFileProtocol(filePath: string): string {
  const regex = /^(?:(?:file|(vscode)-(?:webview-)?resource|vscode--resource):\/+)(.*)/m;

  return filePath.replace(regex, (m, isVSCode, rest) => {
    if (isVSCode) {
      // For vscode urls -> Remove host: `file///C:/a/b/c` -> `C:/a/b/c`
      rest = rest.replace(/^file\/+/, '');
    }

    if (process.platform !== 'win32' && !rest.startsWith('/')) {
      // On Linux platform, add a slash at the front
      return '/' + rest;
    } else {
      return rest;
    }
  });
}

export function readFile(file: string, options?): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(file, options, (error, text) => {
      if (error) {
        return reject(error.toString());
      } else {
        return resolve(text.toString());
      }
    });
  });
}

export function writeFile(file: string, text, options?) {
  return new Promise<void>((resolve, reject) => {
    fs.writeFile(file, text, options, (error) => {
      if (error) {
        return reject(error.toString());
      } else {
        return resolve();
      }
    });
  });
}

export async function getGlobalStyles(): Promise<string> {
  const globalLessFilePath = './style.less';

  let fileContent: string;
  try {
    fileContent = await readFile(globalLessFilePath, { encoding: 'utf-8' });
  } catch (e) {
    // create style.less file
    fileContent = `
/* Please visit the URL below for more information: */
/*   https://shd101wyy.github.io/markdown-preview-enhanced/#/customize-css */

.markdown-preview.markdown-preview {
  // modify your style here
  // eg: background-color: blue;
}
`;
    await writeFile(globalLessFilePath, fileContent, { encoding: 'utf-8' });
  }

  return new Promise<string>((resolve, reject) => {
    less.render(
      fileContent,
      { paths: [path.dirname(globalLessFilePath)] },
      (error, output) => {
        if (error) {
          return resolve(`html body:before {
  content: "Failed to compile \`style.less\`. ${error}" !important;
  padding: 2em !important;
}
.mume.mume { display: none !important; }`);
        } else {
          return resolve(output.css || '');
        }
      },
    );
  });
}

interface BlockAttributes {
  [key: string]: any;
}

export interface BlockInfo {
  attributes: BlockAttributes;
  derivedAttributes?: BlockAttributes;
  language: string;
}

export const extractCommandFromBlockInfo = (info: BlockInfo) =>
  info.attributes['cmd'] === true ? info.language : info.attributes['cmd'];

export function Function(...args: string[]) {
  let body = '';
  const paramLists: string[] = [];
  if (args.length) {
    body = arguments[args.length - 1];
    for (let i = 0; i < args.length - 1; i++) {
      paramLists.push(args[i]);
    }
  }

  const params = [];
  for (let j = 0, len = paramLists.length; j < len; j++) {
    let paramList: any = paramLists[j];
    if (typeof paramList === 'string') {
      paramList = paramList.split(/\s*,\s*/);
    }
    params.push.apply(params, paramList);
  }

  return vm.runInThisContext(`
    (function(${ params.join(', ') }) {
      ${ body }
    })
  `);
}
