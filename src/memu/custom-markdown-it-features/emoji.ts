// tslint:disable-next-line no-implicit-dependencies
import { MarkdownIt } from 'markdown-it';
import { resolve } from 'path';

export default (md: MarkdownIt) => {
  md.use(
    require(resolve(
      __dirname,
      '../../../dependencies/markdown-it/extensions/markdown-it-emoji.min.js',
    )),
  );

  md.renderer.rules.emoji = (tokens, idx) => {
    const token = tokens[idx];
    const markup = token.markup;
    if (markup.startsWith('fa-')) {
      // font-awesome
      return `<i class="fa ${ markup }" aria-hidden="true"></i>`;
    } else {
      // emoji
      return token.content;
    }
  };
};
