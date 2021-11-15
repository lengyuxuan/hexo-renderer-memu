// tslint:disable no-var-requires member-ordering

import * as cheerio from 'cheerio';
import * as path from 'path';
import * as utility from './utility';

export interface MarkdownEngineRenderOption {
  useRelativeFilePath: boolean;
  isForPreview: boolean;
  hideFrontMatter: boolean;
  triggeredBySave?: boolean;
  runAllCodeChunks?: boolean;
  emojiToSvg?: boolean;
}

export interface MarkdownEngineOutput {
  html: string;
  markdown: string;
  tocHTML: string;
  yamlConfig: any;
  /**
   * imported javascript and css files
   * convert .js file to <script src='...'></script>
   * convert .css file to <link href='...'></link>
   */
  JSAndCssFiles: string[];
  // slideConfigs: Array<object>
}

export interface HTMLTemplateOption {
  /**
   * whether is for print.
   */
  isForPrint: boolean;
  /**
   * whether is for prince export.
   */
  isForPrince: boolean;
  /**
   * whether for offline use
   */
  offline: boolean;
  /**
   * whether to embed local images as base64
   */
  embedLocalImages: boolean;
  /**
   * whether to embed svg images
   */
  embedSVG?: boolean;
}

export async function generateHTMLTemplateForExport(html: string, options: HTMLTemplateOption): Promise<string> {
  // get `id` and `class`
  const elementId = '';
  const elementClass = [];

  // math style and script
  const mathStyle = '';

  // font-awesome
  let fontAwesomeStyle = '';
  if (html.indexOf('<i class="fa ') >= 0) {
    if (options.offline) {
      fontAwesomeStyle = `<link rel="stylesheet" href="file:///${ path.resolve(
        __dirname,
        `../../dependencies/font-awesome/css/font-awesome.min.css`,
      ) }">`;
    } else {
      fontAwesomeStyle = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">`;
    }
  }

  // presentation
  const presentationScript = '';
  const presentationStyle = '';
  const presentationInitScript = '';

  // prince
  let princeClass = '';
  if (options.isForPrince) {
    princeClass = 'prince';
  }

  const title = '';
  // prism and preview theme
  let styleCSS = '';
  try {
    styleCSS += await utility.readFile(path.join(__dirname, '../../styles/prism_theme/default.css'));
    styleCSS += await utility.readFile(path.join(__dirname, '../../styles/preview_theme/vue.css'));
    styleCSS += await utility.readFile(path.join(__dirname, '../../styles/style-template.css'));

    // markdown-it-admonition
    if (html.indexOf('admonition') > 0) {
      styleCSS += await utility.readFile(
        path.resolve(
          __dirname,
          '../../styles/markdown-it-admonition.css',
        ),
        { encoding: 'utf-8' },
      );
    }
  } catch (e) {
    styleCSS = '';
  }

  // sidebar toc
  const sidebarTOC = '';
  const sidebarTOCScript = '';
  const sidebarTOCBtn = '';

  // task list script
  if (html.indexOf('task-list-item-checkbox') >= 0) {
    const $ = cheerio.load('<div>' + html + '</div>');
    $('.task-list-item-checkbox').each(
      (index: number, elem: CheerioElement) => {
        const $elem = $(elem);
        let $li = $elem.parent();
        if (!$li[0].name.match(/^li$/i)) {
          $li = $li.parent();
        }
        if ($li[0].name.match(/^li$/i)) {
          $li.addClass('task-list-item');
        }
      },
    );
    html = $.html();
  }

  // process styles
  // move @import ''; to the very start.
  let styles = styleCSS;
  let imports = '';
  styles = styles.replace(/\@import\s+url\(([^)]+)\)\s*;/g, (whole, url) => {
    imports += whole + '\n';
    return '';
  });
  styles = imports + styles;

  html = `
<!DOCTYPE html>
<html>
  <head>
    <title>${ title }</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${ presentationStyle }
    ${ mathStyle }
    ${ fontAwesomeStyle }
    ${ presentationScript }
    <style>
    ${ styles }
    </style>
  </head>
  <body ${ options.isForPrint ? '' : 'for="html-export"' }>
    <div class="mume markdown-preview ${ princeClass } ${ elementClass }" ${ elementId ? `id="${ elementId }"` : '' }>
    ${ html }
    </div>
    ${ sidebarTOC }
    ${ sidebarTOCBtn }
  </body>
  ${ presentationInitScript }
  ${ sidebarTOCScript }
</html>
  `;

  return html.trim();
}
