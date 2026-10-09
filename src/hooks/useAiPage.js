/**
 * 当前页 AI 任务调度：翻译 + 解读。
 * 策略：
 * 1. 翻页时 PDF 立即渲染，AI 请求后台进行，右侧先显示"正在翻译…"
 * 2. 命中缓存则直接使用（不重复请求）
 * 3. 当前页完成后后台预取 page+1、page+2，用户翻过去时结果可能已就绪
 * 4. 翻页/切文件用 AbortController 取消当前页的在途请求
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageParagraphs, renderPageImage } from '../lib/pdf';
import {
  cacheKey,
  getCached,
  setCached,
  peekCached,
  removeCached,
  registerInflight,
  getInflight,
  releaseInflight,
  abortInflight,
} from '../lib/cache';
import {
  buildTranslateMessages,
  buildInsightMessages,
  requestJson,
  requestVisionJson,
  isConfigured,
} from '../lib/aiGateway';

/** 预取页数 */
const PREFETCH_AHEAD = 2;
/** 单批最多送模型翻译的段落数（超出则按批请求后合并，不再静默截断） */
const MAX_PARAGRAPHS = 40;
/** 单页最多送模型的字符数（解读用） */
const MAX_PAGE_CHARS = 6000;
/** 预取前的等待时间（让当前页先拿到带宽） */
const PREFETCH_DELAY = 400;

const EMPTY_STATE = {
  key: '',
  translation: null,
  insight: null,
  tLoading: false,
  iLoading: false,
  tError: null,
  iError: null,
  tFromCache: false,
  iFromCache: false,
};

/**
 * 睡眠指定毫秒。
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 无返回值
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 当前页 AI 调度。
 * @param {object} params 参数
 * @param {string} params.fileId 文件 id
 * @param {object} params.pdfDoc pdf.js 文档
 * @param {number} params.page 当前页码
 * @param {number} params.numPages 总页数
 * @param {object} params.settings AI 设置
 * @param {string} params.aiKey 设置指纹（变化时重新请求）
 * @param {string} params.bookTitle 书名
 * @returns {object} 状态与操作方法
 */
export function useAiPage({ fileId, pdfDoc, page, numPages, settings, aiKey, bookTitle = '' }) {
  const [state, setState] = useState(EMPTY_STATE);
  const [refreshToken, setRefreshToken] = useState(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pdfDocRef = useRef(pdfDoc);
  pdfDocRef.current = pdfDoc;
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;
  const pageRef = useRef(page);
  pageRef.current = page;
  const titleRef = useRef(bookTitle);
  titleRef.current = bookTitle;

  const enabled = Boolean(isConfigured(settings) && fileId && pdfDoc && page);

  /**
   * 确保某页某类任务有结果（缓存优先，其次在途复用，最后真正请求）。
   * @param {string} kind 任务类型 translate | insight
   * @param {number} pageNumber 页码
   * @param {object} options 选项
   * @param {boolean} [options.force] 忽略缓存
   * @returns {Promise<{value: object, fromCache: boolean}>} 结果
   */
  const ensure = useCallback(async (kind, pageNumber, options = {}) => {
    const { force = false } = options;
    const s = settingsRef.current || {};
    const lang = s.targetLang || 'zh-CN';
    const key = cacheKey(fileIdRef.current, pageNumber, kind, lang);

    if (!force) {
      const cached = await getCached(key);
      if (cached) return { value: cached, fromCache: true };
    }

    const existing = getInflight(key);
    if (existing) {
      const value = await existing;
      return { value, fromCache: false };
    }

    const controller = new AbortController();
    const doc = pdfDocRef.current;

    const task = (async () => {
      const paragraphs = await getPageParagraphs(doc, pageNumber);
      let pageText = paragraphs.map((p) => p.text).join('\n\n').slice(0, MAX_PAGE_CHARS);

      if (kind === 'ocr') {
        // 扫描版 / 图片型 PDF：把整页渲染成图片交给视觉模型识别
        if ((s.scanMode || 'auto') === 'off') {
          return { paragraphs: [], empty: true, scanOff: true };
        }
        const image = await renderPageImage(doc, pageNumber);
        const json = await requestVisionJson(
          { image, targetLang: lang, bookTitle: titleRef.current },
          { signal: controller.signal, settings: s }
        );
        const list = Array.isArray(json?.paragraphs) ? json.paragraphs : [];
        const paras = list
          .filter((p) => p && (String(p.text || '').trim() || String(p.zh || '').trim()))
          .map((p, i) => ({
            id: String(p.id || `p${i + 1}`),
            text: String(p.text || ''),
            zh: String(p.zh || ''),
          }));
        if (!paras.length) return { paragraphs: [], empty: true };
        return { paragraphs: paras, ocr: true };
      }

      if (kind === 'translate') {
        if (!paragraphs.length) {
          // 本页没有文本层：复用视觉识别结果（自带原文 + 译文）
          if ((s.scanMode || 'auto') === 'off') {
            return { paragraphs: [], empty: true, scanOff: true };
          }
          const ocrRes = await ensure('ocr', pageNumber);
          const ocrParas = ocrRes?.value?.paragraphs || [];
          if (!ocrParas.length) {
            return { paragraphs: [], empty: true, ocr: Boolean(ocrRes?.value?.ocr) };
          }
          return {
            paragraphs: ocrParas.map((p) => ({ id: p.id, zh: p.zh, text: p.text })),
            ocr: true,
            batches: 1,
          };
        }
        // 超过单批上限时按批请求并合并，避免静默截断（原实现只翻译前 40 段）
        const batches = [];
        for (let i = 0; i < paragraphs.length; i += MAX_PARAGRAPHS) {
          batches.push(paragraphs.slice(i, i + MAX_PARAGRAPHS));
        }
        const merged = [];
        for (const batch of batches) {
          // eslint-disable-next-line no-await-in-loop
          const json = await requestJson(
            buildTranslateMessages({
              paragraphs: batch,
              targetLang: lang,
              bookTitle: titleRef.current,
            }),
            { signal: controller.signal, settings: s }
          );
          const out = Array.isArray(json?.paragraphs) ? json.paragraphs : [];
          for (const item of out) {
            if (item && item.id) merged.push({ id: String(item.id), zh: String(item.zh || '') });
          }
        }
        return { paragraphs: merged, batches: batches.length };
      }

      if (kind === 'insight') {
        if (!pageText.trim()) {
          // 扫描页：先用视觉识别拿到原文，再做解读（OCR 结果有缓存，不会重复请求）
          if ((s.scanMode || 'auto') === 'off') {
            return { summary: '', points: [], example: '', empty: true, scanOff: true };
          }
          const ocrRes = await ensure('ocr', pageNumber);
          pageText = (ocrRes?.value?.paragraphs || [])
            .map((p) => p.text)
            .join('\n\n')
            .slice(0, MAX_PAGE_CHARS);
        }
        if (!pageText.trim()) return { summary: '', points: [], example: '', empty: true };
        const messages = buildInsightMessages({
          pageText,
          targetLang: lang,
          bookTitle: titleRef.current,
        });
        const json = await requestJson(messages, { signal: controller.signal, settings: s });
        return {
          summary: typeof json?.summary === 'string' ? json.summary : '',
          points: Array.isArray(json?.points)
            ? json.points
                .filter((p) => p && (p.title || p.text))
                .map((p) => ({ title: String(p.title || '观点'), text: String(p.text || '') }))
            : [],
          example: typeof json?.example === 'string' ? json.example : '',
        };
      }

      throw new Error(`未知 AI 任务类型：${kind}`);
    })();

    registerInflight(key, task, controller);
    try {
      const value = await task;
      // 空结果（如扫描版 PDF 无文本层）只写内存，不污染 IndexedDB 持久缓存
      await setCached(key, value, { persist: !value?.empty });
      return { value, fromCache: false };
    } finally {
      releaseInflight(key);
    }
  }, []);

  /* ------------------------- 当前页：翻译 + 解读 ------------------------- */
  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_STATE);
      return undefined;
    }
    const s = settingsRef.current || {};
    const lang = s.targetLang || 'zh-CN';
    let cancelled = false;

    const tKey = cacheKey(fileId, page, 'translate', lang);
    const iKey = cacheKey(fileId, page, 'insight', lang);

    setState({
      key: `${fileId}:${page}:${lang}`,
      translation: peekCached(tKey),
      insight: peekCached(iKey),
      tLoading: true,
      iLoading: true,
      tError: null,
      iError: null,
      tFromCache: false,
      iFromCache: false,
    });

    (async () => {
      const results = await Promise.allSettled([ensure('translate', page), ensure('insight', page)]);
      if (cancelled) return;
      const [tRes, iRes] = results;
      setState((prev) => ({
        ...prev,
        translation: tRes.status === 'fulfilled' ? tRes.value.value : prev.translation,
        tFromCache: tRes.status === 'fulfilled' ? tRes.value.fromCache : false,
        tLoading: false,
        tError: tRes.status === 'rejected' ? String(tRes.reason?.message || '翻译失败') : null,
        insight: iRes.status === 'fulfilled' ? iRes.value.value : prev.insight,
        iFromCache: iRes.status === 'fulfilled' ? iRes.value.fromCache : false,
        iLoading: false,
        iError: iRes.status === 'rejected' ? String(iRes.reason?.message || '解读失败') : null,
      }));
    })();

    return () => {
      cancelled = true;
      abortInflight(tKey);
      abortInflight(iKey);
    };
  }, [enabled, fileId, pdfDoc, page, aiKey, refreshToken, ensure]);

  /* ------------------------- 后台预取：page+1、page+2 ------------------------- */
  useEffect(() => {
    if (!enabled || !numPages) return undefined;
    let cancelled = false;

    (async () => {
      await sleep(PREFETCH_DELAY);
      if (cancelled) return;
      for (let delta = 1; delta <= PREFETCH_AHEAD; delta += 1) {
        const next = page + delta;
        if (next > numPages) break;
        if (cancelled) break;
        try {
          await ensure('translate', next);
        } catch (err) {
          /* 预取失败静默 */
        }
        if (cancelled) break;
        try {
          await ensure('insight', next);
        } catch (err) {
          /* 预取失败静默 */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, fileId, pdfDoc, page, numPages, aiKey, ensure]);

  /**
   * 强制重新生成当前页的翻译与解读。
   * @returns {Promise<void>} 无返回值
   */
  const refresh = useCallback(async () => {
    const lang = settingsRef.current?.targetLang || 'zh-CN';
    const p = pageRef.current;
    await Promise.all([
      removeCached(cacheKey(fileIdRef.current, p, 'translate', lang)),
      removeCached(cacheKey(fileIdRef.current, p, 'insight', lang)),
    ]);
    setRefreshToken((token) => token + 1);
  }, []);

  return { ...state, enabled, refresh };
}

export default useAiPage;
