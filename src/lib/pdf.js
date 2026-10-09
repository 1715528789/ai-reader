/**
 * PDF 处理层：文档加载、页面渲染、文本层渲染、按段落切分。
 *
 * 关键约定：
 * 1. worker 使用 `pdfjs-dist/build/pdf.worker.min.mjs?url` 由 Vite 解析成静态资源，
 *    避免打包后 worker 404（等价于 new URL(..., import.meta.url) 写法）。
 * 2. 文本层自行渲染：把 getTextContent() 的每个 item 渲染成绝对定位的 span，
 *    保证鼠标可以划词选中，划词内容通过 window.getSelection() 获取。
 * 3. 段落切分：items 按 y 坐标聚类成行，再按行间距/缩进合并成段落，只取当前页文本。
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// file:// 协议下（例如直接双击单文件版 HTML）浏览器不允许加载 Worker，
// 此时把 workerSrc 置空，pdf.js 会自动退化为在主线程解析 PDF（功能不变，大文件渲染略慢）。
const isFileProtocol =
  typeof window !== 'undefined' && String(window.location?.protocol || '') === 'file:';

pdfjsLib.GlobalWorkerOptions.workerSrc = isFileProtocol ? '' : workerUrl;

export { pdfjsLib };

/** 缓存已解析过的页面文本，避免重复解析（键：docKey:pageNumber）。 */
const pageTextStore = new Map();

/**
 * 取得文档唯一键（用于文本缓存）。
 * @param {object} pdfDoc pdf.js 文档对象
 * @returns {string} 文档键
 */
export function getDocKey(pdfDoc) {
  if (!pdfDoc) return 'none';
  const fp = pdfDoc.fingerprint;
  if (Array.isArray(fp) && fp.length) return String(fp[0]);
  if (typeof fp === 'string' && fp) return fp;
  return 'doc';
}

/**
 * 加载 PDF 文档。
 * @param {ArrayBuffer|Uint8Array} source PDF 二进制数据（内部会复制一份，避免被 pdf.js detach）
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>} 文档对象
 */
export async function loadPdfDocument(source) {
  let data = source;
  if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source.slice(0));
  } else if (source instanceof Uint8Array) {
    data = new Uint8Array(source.slice(0));
  } else {
    throw new Error('loadPdfDocument 需要 ArrayBuffer 或 Uint8Array');
  }
  return pdfjsLib.getDocument({ data }).promise;
}

/**
 * 关闭并释放 PDF 文档。
 * @param {object|null} pdfDoc 文档对象
 * @returns {Promise<void>} 无返回值
 */
export async function destroyPdfDocument(pdfDoc) {
  if (!pdfDoc) return;
  try {
    await pdfDoc.destroy();
  } catch (err) {
    /* 销毁失败不影响主流程 */
  }
}

/**
 * 获取指定页对象，并对页码做安全裁剪。
 * @param {object} pdfDoc 文档对象
 * @param {number} pageNumber 页码（1 起）
 * @returns {Promise<object|null>} 页面对象
 */
export async function getPage(pdfDoc, pageNumber) {
  if (!pdfDoc) return null;
  const total = pdfDoc.numPages || 1;
  const safe = Math.min(Math.max(1, Math.floor(pageNumber || 1)), total);
  return pdfDoc.getPage(safe);
}

/**
 * 启动一页的 canvas 渲染（返回 renderTask，调用方可自行 cancel）。
 * @param {object} page 页面对象
 * @param {HTMLCanvasElement} canvas 画布元素
 * @param {number} scale 缩放比例
 * @param {number} dpr 设备像素比
 * @returns {{renderTask: object, viewport: object}} 渲染任务与视口
 */
export function startRenderPage(page, canvas, scale, dpr = 1) {
  const viewport = page.getViewport({ scale });
  const ratio = dpr || window.devicePixelRatio || 1;
  const cssWidth = Math.floor(viewport.width);
  const cssHeight = Math.floor(viewport.height);

  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const transform = ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null;
  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
    transform: transform || undefined,
  });
  return { renderTask, viewport, cssWidth, cssHeight };
}

/**
 * 把 item 的变换矩阵与视口矩阵相乘（等价于 pdf.js Util.transform）。
 * @param {Array<number>} m1 视口矩阵 [a,b,c,d,e,f]
 * @param {Array<number>} m2 item 矩阵 [a,b,c,d,e,f]
 * @returns {Array<number>} 合成后的 6 元素矩阵
 */
export function transformMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * 渲染文本层（把每个 text item 变成绝对定位 span，支持划词选中）。
 * @param {object} page 页面对象
 * @param {object} viewport 视口对象（render 时的 viewport）
 * @param {HTMLElement} container 文本层容器
 * @returns {Promise<number>} 渲染的 span 数量
 */
export async function renderTextLayer(page, viewport, container) {
  if (!container) return 0;
  container.innerHTML = '';
  const textContent = await page.getTextContent();
  const items = (textContent.items || []).filter((it) => it && typeof it.str === 'string' && it.str.length > 0);

  const fragment = document.createDocumentFragment();
  const spans = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const tx = transformMatrix(viewport.transform, item.transform);
    const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) || 10;
    const span = document.createElement('span');
    span.textContent = item.str;
    span.setAttribute('data-idx', String(i));
    span.style.fontSize = `${fontHeight}px`;
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    fragment.appendChild(span);
    spans.push({ span, item, fontHeight });
  }

  container.appendChild(fragment);

  // 第二遍：按 item 实际宽度做横向缩放，保证选中区域与字形对齐
  for (const entry of spans) {
    const { span, item } = entry;
    const measured = span.getBoundingClientRect().width;
    const target = (item.width || 0) * viewport.scale;
    if (measured > 0 && target > 0) {
      const ratio = target / measured;
      if (Math.abs(ratio - 1) > 0.01) {
        span.style.transform = `scaleX(${ratio.toFixed(4)})`;
      }
    }
  }
  return spans.length;
}

/**
 * 把 text items 聚类成行（按 y 坐标）。
 * @param {Array<object>} items getTextContent().items
 * @returns {Array<{text: string, x: number, right: number, y: number, height: number}>} 行数组（自上而下）
 */
export function buildLines(items) {
  const usable = (items || []).filter((it) => it && typeof it.str === 'string' && it.str.trim().length > 0);
  const sorted = usable.slice().sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 0.5) return dy;
    return a.transform[4] - b.transform[4];
  });

  const lines = [];
  for (const item of sorted) {
    const y = item.transform[5];
    const x = item.transform[4];
    const height = Math.abs(item.transform[3]) || item.height || 10;
    const width = item.width || 0;
    const last = lines[lines.length - 1];
    const tolerance = Math.max(height, last ? last.height : height) * 0.6;
    if (last && Math.abs(last.y - y) <= tolerance) {
      last.items.push({ item, x, width, height });
      last.count += 1;
      if (x < last.x) last.x = x;
      last.right = Math.max(last.right, x + width);
    } else {
      lines.push({
        y,
        x,
        right: x + width,
        height,
        items: [{ item, x, width, height }],
        count: 1,
      });
    }
  }

  const result = [];
  for (const line of lines) {
    const ordered = line.items.slice().sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < ordered.length; i += 1) {
      const cur = ordered[i];
      if (i === 0) {
        text += cur.item.str;
        continue;
      }
      const prev = ordered[i - 1];
      const gap = cur.x - (prev.x + prev.width);
      const needSpace = gap > Math.max(1.2, cur.height * 0.12);
      const prevEnd = text.charAt(text.length - 1);
      if (!needSpace && prevEnd && /[\s-]/.test(prevEnd)) {
        text += cur.item.str;
      } else if (needSpace) {
        text += ` ${cur.item.str}`;
      } else {
        text += cur.item.str;
      }
    }
    result.push({
      text: text.replace(/\s+/g, ' ').trim(),
      x: line.x,
      right: line.right,
      y: line.y,
      height: line.height,
    });
  }
  return result;
}

/** 中文/全角句末标点 */
const TERMINAL_PUNCT = /[。！？!?；;…]\s*["'）)】》」』]?$/;
/** ASCII 句点结尾（含右引号/右括号收尾） */
const ASCII_PERIOD = /\.\s*["'）)】》」』]?$/;
/** 常见缩写/编号前缀，遇到这些不应判定为句末 */
const ABBREV_TOKENS = new Set([
  'fig', 'figs', 'eq', 'eqs', 'ref', 'refs', 'sec', 'secs', 'vol', 'vols', 'no', 'nos',
  'pp', 'p', 'etc', 'vs', 'al', 'et', 'ie', 'eg', 'approx', 'cf', 'inc', 'ltd', 'co',
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'jr', 'sr', 'mt', 'fig.', 'e.g', 'i.e', 'e.g.',
  'i.e.', 'figs.', 'etc.', 'vs.', 'al.', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec',
]);

/**
 * 判断以 ASCII 句点结尾是否真的代表句子结束（排除 Fig. / et al. / 编号 等缩写）。
 * @param {string} text 当前累积文本
 * @returns {boolean} 是否是真正的句末
 */
function isSentencePeriod(text) {
  if (!ASCII_PERIOD.test(text)) return false;
  const match = text.match(/([^\s]+)\.\s*["'）)】》」』]?$/);
  const token = match ? match[1] : '';
  if (!token) return true;
  const lower = token.toLowerCase();
  // 纯数字结尾（"1." "12."）：编号/图表号，不是句末
  if (/^\d+$/.test(token)) return false;
  // 内部还有句点（e.g. / i.e. / U.S.）
  if (token.includes('.')) return false;
  // 已知缩写词
  if (ABBREV_TOKENS.has(lower)) return false;
  // 单个大写字母（人名首字母 J. Smith）
  if (/^[A-Z]$/.test(token)) return false;
  // 全大写的短词（IEEE / USA / PDF）
  if (token.length <= 4 && /^[A-Z]+$/.test(token)) return false;
  return true;
}

/**
 * 把一页的 text items 切分成段落。
 *
 * 断段判定（按优先级）：
 * 1. 行间距 > 0.55 倍字号：空行分隔（中英文通用）
 * 2. 字号明显变大：标题
 * 3. 行首缩进 > 0.9 em：首行缩进式段落（中文正文）
 * 4. 上一行以 ASCII 句点结尾（且不是缩写/编号）**且** 下一行行首大写 **且** 上一行右端明显短于版心
 *    —— 用于 IEEE 这类无空行无缩进的英文排版；三个信号必须同时成立才是真正的段边界
 *
 * 说明：中文句末标点（。！？）不单独作为断段信号——中文 1.4×/1.5× 行距下每行都以标点结尾，
 * 一旦允许它触发断段就会把整段切碎；真正的空行分段由规则 1 兜住。
 *
 * @param {Array<object>} items getTextContent().items
 * @returns {Array<{id: string, text: string}>} 段落数组
 */
export function splitParagraphs(items) {
  const lines = buildLines(items).filter((l) => l.text.length > 0);
  const paragraphs = [];
  let current = null;
  let prevLine = null;

  // 版心范围：用整页文本块的左右边界估算，用于判断"上一行是否提前结束"
  let textLeft = Number.POSITIVE_INFINITY;
  let textRight = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    if (line.x < textLeft) textLeft = line.x;
    if (line.right > textRight) textRight = line.right;
  }
  if (!Number.isFinite(textLeft)) textLeft = 0;
  if (!Number.isFinite(textRight)) textRight = 0;
  const textWidth = Math.max(1, textRight - textLeft);

  const flush = () => {
    if (current && current.text.trim()) {
      paragraphs.push({ id: `p${paragraphs.length + 1}`, text: current.text.trim() });
    }
    current = null;
  };

  for (const line of lines) {
    if (!current) {
      current = { text: line.text, x: line.x, right: line.right, height: line.height, y: line.y };
      prevLine = line;
      continue;
    }

    const gap = prevLine.y - (line.y + line.height);
    const emSize = prevLine.height || line.height || 10;
    const lineGapRatio = gap / Math.max(1e-3, emSize);
    const indentDelta = line.x - prevLine.x;
    const bigIndent = indentDelta > emSize * 0.9;
    const isHeading = line.height > prevLine.height * 1.35;

    // 上一行是否明显短于版心右边界（段落末行的典型特征）
    const shortThreshold = Math.max(emSize * 1.5, textWidth * 0.12);
    const prevShortLine = textRight - prevLine.right > shortThreshold;
    // 下一行是否以大写字母开头（英文新段落的典型特征）
    const nextStartsUpper = /^[“"'(（【《「『]?[A-Z]/.test(line.text);

    const endsAsciiSentence = isSentencePeriod(current.text);

    const startNew =
      lineGapRatio > 0.55 ||
      isHeading ||
      bigIndent ||
      (endsAsciiSentence && nextStartsUpper && prevShortLine && lineGapRatio > 0.05);

    if (startNew) {
      flush();
      current = { text: line.text, x: line.x, right: line.right, height: line.height, y: line.y };
    } else {
      // 处理英文断字换行：行尾为 '-' 时直接拼接
      if (/[—-]$/.test(current.text) && /^[a-zA-Z]/.test(line.text)) {
        current.text = `${current.text.slice(0, -1)}${line.text}`;
      } else {
        current.text += ` ${line.text}`;
      }
      current.right = Math.max(current.right, line.right);
    }
    prevLine = line;
  }
  flush();

  return paragraphs.filter((p) => p.text.length > 1);
}

/**
 * 获取某页的段落（带缓存）。
 * @param {object} pdfDoc 文档对象
 * @param {number} pageNumber 页码
 * @param {boolean} force 是否忽略缓存
 * @returns {Promise<Array<{id: string, text: string}>>} 段落数组
 */
export async function getPageParagraphs(pdfDoc, pageNumber, force = false) {
  if (!pdfDoc) return [];
  const key = `${getDocKey(pdfDoc)}:${pageNumber}`;
  if (!force && pageTextStore.has(key)) return pageTextStore.get(key);
  const page = await getPage(pdfDoc, pageNumber);
  if (!page) return [];
  const textContent = await page.getTextContent();
  const paragraphs = splitParagraphs(textContent.items || []);
  pageTextStore.set(key, paragraphs);
  return paragraphs;
}

/**
 * 获取某页纯文本（段落以空行分隔）。
 * @param {object} pdfDoc 文档对象
 * @param {number} pageNumber 页码
 * @param {number} maxChars 最大字符数（截断，避免 token 爆炸）
 * @returns {Promise<string>} 页面文本
 */
export async function getPagePlainText(pdfDoc, pageNumber, maxChars = 6000) {
  const paragraphs = await getPageParagraphs(pdfDoc, pageNumber);
  const text = paragraphs.map((p) => p.text).join('\n\n');
  if (maxChars > 0 && text.length > maxChars) return `${text.slice(0, maxChars)}…`;
  return text;
}

/* --------------------------- 页面截图（供视觉识别使用） --------------------------- */

/** 页面截图缓存（键：docKey:page:maxEdge）。只保留最近几页，避免 base64 占满内存。 */
const pageImageStore = new Map();
/** 截图缓存上限（页数） */
const MAX_IMAGE_CACHE = 6;

/**
 * 把某一页渲染成 JPEG 图片（base64），供视觉模型识别扫描版 / 图片型 PDF。
 * 说明：先铺白底再渲染，避免透明背景在 JPEG 压缩后变黑影响识别。
 *
 * @param {object} pdfDoc pdf.js 文档对象
 * @param {number} pageNumber 页码（1 起）
 * @param {object} options 选项
 * @param {number} [options.maxEdge] 最长边像素上限（默认 1600，兼顾识别率与 token 成本）
 * @param {number} [options.quality] JPEG 质量（默认 0.82）
 * @returns {Promise<{dataUrl: string, base64: string, mimeType: string, width: number, height: number}>} 图片数据
 */
export async function renderPageImage(pdfDoc, pageNumber, options = {}) {
  const { maxEdge = 1600, quality = 0.82 } = options;
  if (!pdfDoc) throw new Error('PDF 文档尚未就绪');

  const cacheKey = `${getDocKey(pdfDoc)}:${pageNumber}:${maxEdge}`;
  const hit = pageImageStore.get(cacheKey);
  if (hit) return hit;

  const page = await getPage(pdfDoc, pageNumber);
  if (!page) throw new Error(`第 ${pageNumber} 页不存在`);

  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height) || 1;
  // 小页适当放大有助于识别，大页则压缩到上限；限制在 [0.5, 3] 之间
  const scale = Math.max(0.5, Math.min(3, maxEdge / longest));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法生成页面截图');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const result = {
    dataUrl,
    base64,
    mimeType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
  };

  pageImageStore.set(cacheKey, result);
  if (pageImageStore.size > MAX_IMAGE_CACHE) {
    const oldest = pageImageStore.keys().next().value;
    if (oldest !== undefined) pageImageStore.delete(oldest);
  }
  return result;
}

/**
 * 清空页面文本缓存（切换文件时调用）。
 * @returns {void}
 */
export function clearPageTextStore() {
  pageTextStore.clear();
  pageImageStore.clear();
}

/**
 * 格式化文件体积。
 * @param {number} bytes 字节数
 * @returns {string} 可读体积
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
