const path = require('path');
const { DEFAULT_CONFIG } = require('./config');

function resolveOutputPath(sourcePath, name, config) {
  const dir = (config.outputPath || '').trim() || (sourcePath ? path.dirname(sourcePath) : '');
  if (!dir) return { error: '未设置输出目录，且该图片没有源目录（拖拽添加）。请先设置输出目录。' };
  const base = sourcePath ? path.parse(sourcePath).name : path.parse(name || 'image').name;
  const suffix = config.suffix != null ? String(config.suffix) : DEFAULT_CONFIG.suffix;
  let output = path.join(dir, base + suffix + '.png');
  if (sourcePath && path.resolve(output) === path.resolve(sourcePath)) {
    output = path.join(dir, base + '_rounded.png');
  }
  return { output };
}

module.exports = { resolveOutputPath };
