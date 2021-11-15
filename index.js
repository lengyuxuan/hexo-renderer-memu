const fs = require('fs');
const render = require('./dist/render').default;
const md = fs.readFileSync('./README.md').toString();

hexo.extend.renderer.register('md', 'html', render, true);
