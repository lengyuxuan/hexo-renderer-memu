/*
 * modified to support math block
 * check https://github.com/jonschlinkert/remarkable/blob/875554aedb84c9dd190de8d0b86c65d2572eadd5/lib/rules.js
 */

// tslint:disable-next-line no-implicit-dependencies
import { MarkdownIt } from 'markdown-it';
import { normalizeBlockInfo, parseBlockInfo } from '../parseBlockInfo';
import { escapeString } from '../utility';

export default (md: MarkdownIt) => {
  md.renderer.rules.fence = (tokens, idx, options, env, instance) => {
    const token = tokens[idx];

    // get code info (same line as opening fence)
    const info = token.info.trim();
    const parsedInfo = parseBlockInfo(info);
    const normalizedInfo = normalizeBlockInfo(parsedInfo);

    // get code content
    const content = escapeString(token.content);

    // copied from getBreak function.
    const finalBreak =
      idx < tokens.length && tokens[idx].type === 'list_item_close' ? '\n' : '';

    return `
    <div class="code-title">
      <a name="${ parsedInfo.attributes.file }">${ parsedInfo.attributes.file || 'code' }</a>
      <span>${ parsedInfo.language }</span>
    </div>
    <pre data-role="codeBlock" data-info="${escapeString(
      info,
    )}" data-parsed-info="${escapeString(
      JSON.stringify(parsedInfo),
    )}" data-normalized-info="${escapeString(
      JSON.stringify(normalizedInfo),
    )}">${content}</pre>${finalBreak}`;
  };
};
