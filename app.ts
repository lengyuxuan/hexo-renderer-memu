import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { transformMarkdown } from './memu/transformer';
import { generateHTMLTemplateForExport } from './memu/markdown-engine';
import enhanceWithCodeBlockStyling from './memu/code-block-styling';
import enhanceWithResolvedImagePaths from './memu/resolved-image-paths';
import useMarkdownAdmonition from './memu/custom-markdown-it-features/admonition';
import useMarkdownItCodeFences from './memu/custom-markdown-it-features/code-fences';
import useMarkdownItCriticMarkup from './memu/custom-markdown-it-features/critic-markup';
import useMarkdownItEmoji from './memu/custom-markdown-it-features/emoji';
import * as MarkdownIt from 'markdown-it';

const markdownIt = new MarkdownIt({
  breaks: true,
  html: true,
  langPrefix: 'language-',
  linkify: true,
  typographer: false,
  xhtmlOut: false,
});

const extensions = [
  '../dependencies/markdown-it/extensions/markdown-it-footnote.min.js',
  '../dependencies/markdown-it/extensions/markdown-it-sub.min.js',
  '../dependencies/markdown-it/extensions/markdown-it-sup.min.js',
  '../dependencies/markdown-it/extensions/markdown-it-deflist.min.js',
  '../dependencies/markdown-it/extensions/markdown-it-abbr.min.js',
  '../dependencies/markdown-it/extensions/markdown-it-mark.min.js',
];

for (const js of extensions) {
  const fullPath = path.resolve(__dirname, js);
  const plugin = require(fullPath);
  markdownIt.use(plugin);
}

useMarkdownAdmonition(markdownIt);
useMarkdownItCodeFences(markdownIt);
useMarkdownItCriticMarkup(markdownIt);
useMarkdownItEmoji(markdownIt);

const md = fs.readFileSync(path.join(__dirname, '../README.md')).toString();

(async () => {
  const { outputString } = await transformMarkdown(md, {
    fileDirectoryPath: null,
    projectDirectoryPath: null,
    forPreview: false,
    protocolsWhiteListRegExp: null,
    useRelativeFilePath: true,
    filesCache: null,
    usePandocParser: false,
  });

  let html = markdownIt.render(outputString);

  const $ = cheerio.load(html);
  await enhanceWithCodeBlockStyling($);
  await enhanceWithResolvedImagePaths(
    $,
    { useRelativeFilePath: true, hideFrontMatter: true, isForPreview: false, runAllCodeChunks: false },
    (filePath) => filePath,
    false,
  );

  html = $('head').html() + $('body').html();

  html = await generateHTMLTemplateForExport(html, {
    isForPrint: false,
    isForPrince: false,
    embedLocalImages: true,
    offline: false,
    embedSVG: true,
  });
  fs.writeFileSync(path.join(__dirname, '../x.html'), html);
})();
