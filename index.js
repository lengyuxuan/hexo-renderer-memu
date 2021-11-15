const render = require('./dist/render').default;

hexo.extend.renderer.register('md', 'html', render, true);
