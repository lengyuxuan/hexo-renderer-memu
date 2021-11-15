// from https://github.com/shd101wyy/mume
import * as path from 'path';
import { parseBlockAttributes, stringifyBlockAttributes } from './blockAttributes';
import HeadingIdGenerator from './heading-id-generator';

export interface HeadingData {
  content: string;
  level: number;
  id: string;
}

export interface TransformMarkdownOutput {
  outputString: string;
  /**
   * An array of slide configs.
   */
  slideConfigs: object[];
  /**
   * whehter we found [TOC] in markdown file or not.
   */
  tocBracketEnabled: boolean;

  /**
   * imported javascript and css files
   * convert .js file to <script src='...'></script>
   * convert .css file to <link href='...'></link>
   */
  JSAndCssFiles: string[];

  headings: HeadingData[];

  /**
   * Get `---\n...\n---\n` string.
   */
  frontMatterString: string;
}

export interface TransformMarkdownOptions {
  fileDirectoryPath: string;
  projectDirectoryPath: string;
  filesCache: { [key: string]: string };
  useRelativeFilePath: boolean;
  forPreview: boolean;
  forMarkdownExport?: boolean;
  protocolsWhiteListRegExp: RegExp;
  notSourceFile?: boolean;
  imageDirectoryPath?: string;
  usePandocParser: boolean;
  headingIdGenerator?: HeadingIdGenerator;
  onWillTransformMarkdown?: (markdown: string) => Promise<string>;
  onDidTransformMarkdown?: (markdown: string) => Promise<string>;
}

const fileExtensionToLanguageMap = {
  vhd: 'vhdl',
  erl: 'erlang',
  dot: 'dot',
  gv: 'dot',
  viz: 'dot',
};

const selfClosingTag = {
  area: 1,
  base: 1,
  br: 1,
  col: 1,
  command: 1,
  embed: 1,
  hr: 1,
  img: 1,
  input: 1,
  keygen: 1,
  link: 1,
  meta: 1,
  param: 1,
  source: 1,
  track: 1,
  wbr: 1,
};

/**
 * Convert 2D array to markdown table.
 * The first row is headings.
 */
function twoDArrayToMarkdownTable(twoDArr) {
  let output = '  \n';
  twoDArr.forEach((arr, offset) => {
    let i = 0;
    output += '|';
    while (i < arr.length) {
      output += arr[i] + '|';
      i += 1;
    }
    output += '  \n';
    if (offset === 0) {
      output += '|';
      i = 0;
      while (i < arr.length) {
        output += '---|';
        i += 1;
      }
      output += '  \n';
    }
  });

  output += '  ';
  return output;
}

function createAnchor(lineNo) {
  return `\n\n<p data-line="${ lineNo }" class="sync-line" style="margin:0;"></p>\n\n`;
}

/**
 *
 * @param inputString
 * @param fileDirectoryPath
 * @param projectDirectoryPath
 * @param param3
 */
export async function transformMarkdown(
  inputString: string,
  {
    fileDirectoryPath = '',
    projectDirectoryPath = '',
    filesCache = {},
    useRelativeFilePath = null,
    forPreview = false,
    forMarkdownExport = false,
    protocolsWhiteListRegExp = null,
    notSourceFile = false,
    imageDirectoryPath = '',
    usePandocParser = false,
    headingIdGenerator = new HeadingIdGenerator(),
    onWillTransformMarkdown = null,
    onDidTransformMarkdown = null,
  }: TransformMarkdownOptions,
): Promise<TransformMarkdownOutput> {
  let lastOpeningCodeBlockFence: string = null;
  let codeChunkOffset = 0;
  const slideConfigs = [];
  // tslint:disable-next-line: variable-name
  const JSAndCssFiles = [];
  const headings = [];
  let tocBracketEnabled = false;
  let frontMatterString = '';

  /**
   * As the recursive version of this function will cause the error:
   *   RangeError: Maximum call stack size exceeded
   * I wrote it in iterative way.
   * @param i start offset
   * @param lineNo start line number
   */
  async function helper(i, lineNo = 0): Promise<TransformMarkdownOutput> {
    let outputString = '';

    while (i < inputString.length) {
      if (inputString[i] === '\n') {
        // return helper(i+1, lineNo+1, outputString+'\n')
        i = i + 1;
        lineNo = lineNo + 1;
        outputString = outputString + '\n';
        continue;
      }

      let end = inputString.indexOf('\n', i);
      if (end < 0) {
        end = inputString.length;
      }
      let line = inputString.substring(i, end);

      const inCodeBlock = !!lastOpeningCodeBlockFence;

      const currentCodeBlockFence = (line.match(/^[`]{3,}/) || [])[0];
      if (currentCodeBlockFence) {
        if (!inCodeBlock && forPreview) {
          outputString += createAnchor(lineNo);
        }

        const containsCmd = !!line.match(/\"?cmd\"?\s*[:=\s}]/);
        if (!inCodeBlock && !notSourceFile && containsCmd) {
          // it's code chunk, so mark its offset
          line = line.replace('{', `{code_chunk_offset=${ codeChunkOffset }, `);
          codeChunkOffset++;
        }
        if (!inCodeBlock) {
          lastOpeningCodeBlockFence = currentCodeBlockFence;
        } else if (
          currentCodeBlockFence.length >= lastOpeningCodeBlockFence.length
        ) {
          lastOpeningCodeBlockFence = null;
        }

        // return helper(end+1, lineNo+1, outputString+line+'\n')
        i = end + 1;
        lineNo = lineNo + 1;
        outputString = outputString + line + '\n';
        continue;
      }

      if (inCodeBlock) {
        // return helper(end+1, lineNo+1, outputString+line+'\n')
        i = end + 1;
        lineNo = lineNo + 1;
        outputString = outputString + line + '\n';
        continue;
      }

      let headingMatch;
      let taskListItemMatch;
      let htmlTagMatch;

      /*
        // I changed this because for case like:

        * haha
        ![](image.png)

        The image will not be displayed correctly in preview as there will be `anchor` inserted
        between...
        */
      if (
        line.match(/^(\!\[|@import)/) &&
        inputString[i - 1] === '\n' &&
        inputString[i - 2] === '\n'
      ) {
        if (forPreview) {
          outputString += createAnchor(lineNo); // insert anchor for scroll sync
        }
        /* tslint:disable-next-line:no-conditional-assignment */
      } else if ((headingMatch = line.match(/^(\#{1,7}).*/))) {
        /* ((headingMatch = line.match(/^(\#{1,7})(.+)$/)) ||
                  // the ==== and --- headers don't work well. For example, table and list will affect it, therefore I decide not to support it.
                  (inputString[end + 1] === '=' && inputString[end + 2] === '=') ||
                  (inputString[end + 1] === '-' && inputString[end + 2] === '-')) */ // headings

        if (forPreview) {
          outputString += createAnchor(lineNo);
        }
        let heading;
        let level;
        let tag;
        // if (headingMatch) {
        heading = line.replace(headingMatch[1], '');
        tag = headingMatch[1];
        level = tag.length;
        /*} else {
            if (inputString[end + 1] === '=') {
              heading = line.trim()
              tag = '#'
              level = 1
            } else {
              heading = line.trim()
              tag = '##'
              level = 2
            }

            end = inputString.indexOf('\n', end + 1)
            if (end < 0) end = inputString.length
          }*/

        /*if (!heading.length) {
          // return helper(end+1, lineNo+1, outputString + '\n')
          i = end + 1;
          lineNo = lineNo + 1;
          outputString = outputString + "\n";
          continue;
        }*/

        // check {class:string, id:string, ignore:boolean}
        const optMatch = heading.match(/(\s+\{|^\{)(.+?)\}(\s*)$/);
        let classes = '';
        let id = '';
        let ignore = false;
        let opt;
        if (optMatch) {
          heading = heading.replace(optMatch[0], '');

          try {
            opt = parseBlockAttributes(optMatch[0]);

            classes = opt.class;
            id = opt.id;
            ignore = opt.ignore;
            delete opt.class;
            delete opt.id;
            delete opt.ignore;
          } catch (e) {
            heading = 'OptionsError: ' + optMatch[1];
            ignore = true;
          }
        }

        if (!id) {
          id = headingIdGenerator.generateId(heading);
          if (usePandocParser) {
            id = id.replace(/^[\d\-]+/, '');
            if (!id) {
              id = 'section';
            }
          }
        }

        if (!ignore) {
          headings.push({ content: heading, level, id });
        }

        if (usePandocParser) {
          // pandoc
          let optionsStr = '{';
          if (id) {
            optionsStr += `#${ id } `;
          }
          if (classes) {
            optionsStr += '.' + classes.replace(/\s+/g, ' .') + ' ';
          }
          if (opt) {
            for (const key in opt) {
              if (typeof opt[key] === 'number') {
                optionsStr += ' ' + key + '=' + opt[key];
              } else {
                optionsStr += ' ' + key + '="' + opt[key] + '"';
              }
            }
          }
          optionsStr += '}';

          // return helper(end+1, lineNo+1, outputString + `${tag} ${heading} ${optionsStr}` + '\n')
          i = end + 1;
          lineNo = lineNo + 1;
          outputString =
            outputString + `${ tag } ${ heading } ${ optionsStr }` + '\n';
          continue;
        } else {
          // markdown-it
          // tslint:disable-next-line: prefer-conditional-expression
          if (!forMarkdownExport) {
            // convert to <h? ... ></h?>
            line = `${ tag } ${ heading }\n<p class="mume-header ${ classes }" id="${ id }"></p>`;
          } else {
            line = `${ tag } ${ heading }`;
          }

          // return helper(end+1, lineNo+1, outputString + line + '\n\n')
          i = end + 1;
          lineNo = lineNo + 1;
          outputString = outputString + line + '\n\n';
          continue;
          // I added one extra `\n` here because remarkable renders content below
          // heading differently with `\n` and without `\n`.
        }
      } else if (line.match(/^\<!--/)) {
        // custom comment
        if (forPreview) {
          outputString += createAnchor(lineNo);
        }
        let commentEnd = inputString.indexOf('-->', i + 4);

        if (commentEnd < 0) {
          // didn't find -->
          // return helper(inputString.length, lineNo+1, outputString+'\n')
          i = inputString.length;
          lineNo = lineNo + 1;
          outputString = outputString + '\n';
          continue;
        } else {
          commentEnd += 3;
        }

        const subjectMatch = line.match(/^\<!--\s+([^\s]+)/);
        if (!subjectMatch) {
          const content = inputString.slice(i + 4, commentEnd - 3).trim();
          const newlinesMatch = content.match(/\n/g);
          const newlines = newlinesMatch ? newlinesMatch.length : 0;

          // return helper(commentEnd, lineNo + newlines, outputString + '\n')
          i = commentEnd;
          lineNo = lineNo + newlines;
          outputString = outputString + '\n';
          continue;
        } else {
          const subject = subjectMatch[1];
          if (subject === '@import') {
            const commentEnd2 = line.lastIndexOf('-->');
            if (commentEnd2 > 0) {
              line = line.slice(4, commentEnd2).trim();
            }
          } else {
            const content = inputString.slice(i + 4, commentEnd - 3).trim();
            const newlinesMatch = content.match(/\n/g);
            const newlines = newlinesMatch ? newlinesMatch.length : 0;
            // return helper(commentEnd, lineNo + newlines, outputString + '\n')
            i = commentEnd;
            lineNo = lineNo + newlines;
            outputString = outputString + '\n';
            continue;
          }
        }
      } else if (line.match(/^\s*\[toc\]\s*$/i)) {
        // [TOC]
        if (forPreview) {
          outputString += createAnchor(lineNo); // insert anchor for scroll sync
        }
        tocBracketEnabled = true;
        // return helper(end+1, lineNo+1, outputString + `\n[MUMETOC]\n\n`)
        i = end + 1;
        lineNo = lineNo + 1;
        outputString = outputString + `\n[MUMETOC]\n\n`;
        continue;
      } else if (
        /* tslint:disable-next-line:no-conditional-assignment */
        (taskListItemMatch = line.match(
          /^\s*(?:[*\-+]|\d+\.)\s+(\[[xX\s]\])\s/,
        ))
      ) {
        // task list
        const checked = taskListItemMatch[1] !== '[ ]';
        if (!forMarkdownExport) {
          line = line.replace(
            taskListItemMatch[1],
            `<input type="checkbox" class="task-list-item-checkbox${ forPreview ? ' sync-line' : ''
            }" ${ forPreview ? `data-line="${ lineNo }"` : '' }${ checked ? ' checked' : ''
            }>`,
          );
        }
        // return helper(end+1, lineNo+1, outputString+line+`\n`)
        i = end + 1;
        lineNo = lineNo + 1;
        outputString = outputString + line + `\n`;
        continue;
      } else if (
        /* tslint:disable-next-line:no-conditional-assignment */
        (htmlTagMatch = line.match(
          /^\s*<(?:([a-zA-Z]+)|([a-zA-Z]+)\s+(?:.+?))>/,
        ))
      ) {
        // escape html tag like <pre>
        const tagName = htmlTagMatch[1] || htmlTagMatch[2];
        if (!(tagName in selfClosingTag)) {
          const closeTagName = `</${ tagName }>`;
          const end2 = inputString.indexOf(
            closeTagName,
            i + htmlTagMatch[0].length,
          );
          if (end2 < 0) {
            // HTML error. Tag not closed
            // Do Nothing here. Reason:
            //     $$ x
            //     <y>
            //     $$
            /*
              i = inputString.length
              lineNo = lineNo + 1
              outputString = outputString + `\n\`\`\`\nHTML error. Tag <${tagName}> not closed. ${closeTagName} is required.\n\`\`\`\n\n`
              continue
              */
          } else {
            const htmlString = inputString.slice(i, end2 + closeTagName.length);
            const newlinesMatch = htmlString.match(/\n/g);
            const newlines = newlinesMatch ? newlinesMatch.length : 0;

            // return helper(commentEnd, lineNo + newlines, outputString + '\n')
            i = end2 + closeTagName.length;
            lineNo = lineNo + newlines;
            outputString = outputString + htmlString;
            continue;
          }
        }
      }

      // file import
      const importMatch = line.match(/^(\s*)\@import(\s+)\"([^\"]+)\";?/);
      if (importMatch) {
        outputString += importMatch[1];
        const filePath = importMatch[3].trim();

        const leftParen = line.indexOf('{');
        let config = null;
        let configStr = '';
        if (leftParen > 0) {
          const rightParen = line.lastIndexOf('}');
          if (rightParen > 0) {
            configStr = line.substring(leftParen + 1, rightParen);
            try {
              config = parseBlockAttributes(configStr);
            } catch (error) {
              // null
            }
          }
        }

        let absoluteFilePath;
        if (filePath.match(protocolsWhiteListRegExp)) {
          absoluteFilePath = filePath;
        } else if (filePath.startsWith('/')) {
          absoluteFilePath = path.resolve(projectDirectoryPath, '.' + filePath);
        } else {
          absoluteFilePath = path.resolve(fileDirectoryPath, filePath);
        }

        const extname = path.extname(filePath).toLocaleLowerCase();
        let output = '';
        if (
          ['.jpeg', '.jpg', '.gif', '.png', '.apng', '.svg', '.bmp'].indexOf(
            extname,
          ) >= 0
        ) {
          // image
          let imageSrc: string = filesCache[filePath];

          if (!imageSrc) {
            if (filePath.match(protocolsWhiteListRegExp)) {
              imageSrc = filePath;
            } else if (useRelativeFilePath) {
              imageSrc =
                path.relative(fileDirectoryPath, absoluteFilePath) +
                '?' +
                Math.random();
            } else {
              imageSrc =
                '/' +
                path.relative(projectDirectoryPath, absoluteFilePath) +
                '?' +
                Math.random();
            }
            // enchodeURI(imageSrc) is wrong. It will cause issue on Windows
            // #414: https://github.com/shd101wyy/markdown-preview-enhanced/issues/414
            imageSrc = imageSrc.replace(/ /g, '%20').replace(/\\/g, '/');
            filesCache[filePath] = imageSrc;
          }

          if (config) {
            if (
              config.width ||
              config.height ||
              config.class ||
              config.id
            ) {
              output = `<img src="${ imageSrc }" `;
              for (const key in config) {
                if (config.hasOwnProperty(key)) {
                  output += ` ${ key }="${ config[key] }" `;
                }
              }
              output += '>';
            } else {
              output = '![';
              if (config.alt) {
                output += config.alt;
              }
              output += `](${ imageSrc }`;
              if (config.title) {
                output += ` "${ config.title }"`;
              }
              output += ')  ';
            }
          } else {
            output = `![](${ imageSrc })  `;
          }
          // return helper(end+1, lineNo+1, outputString+output+'\n')
          i = end + 1;
          lineNo = lineNo + 1;
          outputString = outputString + output + '\n';
          continue;
        } else if (filePath === '[TOC]') {
          if (!config) {
            config = {
              // same case as in normalized attributes
              ['depth_from']: 1,
              ['depth_to']: 6,
              ['ordered_list']: true,
            };
          }
          config.cmd = 'toc';
          config.hide = true;
          config.run_on_save = true;
          config.modify_source = true;
          if (!notSourceFile) {
            // mark code_chunk_offset
            config.code_chunk_offset = codeChunkOffset;
            codeChunkOffset++;
          }

          const output2 = `\`\`\`text ${ stringifyBlockAttributes(
            config,
          ) }  \n\`\`\`  `;
          // return helper(end+1, lineNo+1, outputString+output+'\n')
          i = end + 1;
          lineNo = lineNo + 1;
          outputString = outputString + output2 + '\n';
          continue;
        }
      } else {
        // return helper(end+1, lineNo+1, outputString+line+'\n')
        i = end + 1;
        lineNo = lineNo + 1;
        outputString = outputString + line + '\n';
        continue;
      }
    }

    // done
    return {
      outputString,
      slideConfigs,
      tocBracketEnabled,
      JSAndCssFiles,
      headings,
      frontMatterString,
    };
  }

  let endFrontMatterOffset = 0;
  if (
    inputString.startsWith('---') &&
    /* tslint:disable-next-line:no-conditional-assignment */
    (endFrontMatterOffset = inputString.indexOf('\n---')) > 0
  ) {
    frontMatterString = inputString.slice(0, endFrontMatterOffset + 4);
    return helper(
      frontMatterString.length,
      frontMatterString.match(/\n/g).length,
    );
  } else {
    return helper(0, 0);
  }
}
