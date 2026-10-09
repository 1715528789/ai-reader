/**
 * 把 dist/ 的构建产物内联成单个 HTML 文件，双击即可在浏览器打开（无需起服务）。
 *
 * 背景：file:// 协议下浏览器会拦截外部 module script（CORS），所以必须把 JS/CSS 全部内联。
 * 用法：npm run build:single
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const OUT = 'ai-reader-standalone.html';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('找不到 dist/index.html，请先执行 npm run build');
  process.exit(1);
}

let html = readFileSync(join(DIST, 'index.html'), 'utf8');

/** 去掉可能提前闭合标签的写法 */
const escapeForScript = (code) => code.replace(/<\/script>/gi, '<\\/script>');

let inlined = 0;

// 内联样式
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
  const match = tag.match(/href="([^"]+)"/);
  if (!match) return tag;
  const file = join(DIST, match[1].replace(/^\.?\//, ''));
  if (!existsSync(file)) return tag;
  inlined += 1;
  return `<style>\n${readFileSync(file, 'utf8')}\n</style>`;
});

// 内联脚本
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/g, (tag, src) => {
  const file = join(DIST, src.replace(/^\.?\//, ''));
  if (!existsSync(file)) return tag;
  inlined += 1;
  return `<script type="module">\n${escapeForScript(readFileSync(file, 'utf8'))}\n</script>`;
});

// 清理 modulepreload（单文件不需要）
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');

writeFileSync(OUT, html, 'utf8');

const leftover = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g);
const size = (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2);

console.log(`已生成 ${OUT}（${size} MB，内联 ${inlined} 个文件）`);
if (leftover && leftover.length) {
  console.warn(`警告：仍有 ${leftover.length} 处外部资源引用，双击可能加载失败：`);
  console.warn(leftover.join('\n'));
  process.exit(1);
}
console.log('无外部资源引用，可直接双击打开。');
