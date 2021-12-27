import * as fs from 'fs';
import * as path from 'path';
import render from './render';

(async () => {
  const html = await render({ path: path.join(__dirname, '../README.md') });
  fs.writeFileSync(path.join(__dirname, '../dist/README.html'), html);
})();
