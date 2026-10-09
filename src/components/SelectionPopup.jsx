/**
 * 划词浮层：选中 PDF 文本后弹出，给出中文释义 + 简单理解 + 相关概念，
 * 并提供「详细解释」「加入生词本」操作。
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { buildExplainMessages, requestJson } from '../lib/aiGateway';
import { cacheKey, getCached, setCached } from '../lib/cache';
import Loader from './Loader';

const POPUP_WIDTH = 340;

/**
 * 归一化划词文本（用于缓存键：trim + 小写 + 折叠空白）。
 * @param {string} text 原始文本
 * @returns {string} 归一化文本
 */
function normalizeTerm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 划词解释浮层。
 * @param {object} props 属性
 * @param {{text: string, rect: object}|null} props.selection 选中信息
 * @param {() => void} props.onClear 关闭浮层
 * @param {(term: string) => void} props.onAskDetail 请求详细解释（跳转问答）
 * @returns {JSX.Element|null} 浮层
 */
export default function SelectionPopup({ selection, onClear, onAskDetail }) {
  const { settings, aiEnabled, aiKey, pageContent, setSettingsOpen, addVocab, currentId, page } =
    useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const tokenRef = useRef(0);
  const abortRef = useRef(null);
  const [added, setAdded] = useState(false);

  const term = selection?.text || '';

  useEffect(() => {
    setAdded(false);
    // 切换选中词 / 关闭浮层时，取消上一个在途请求
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (!term) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    if (!aiEnabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setLoading(true);
    setError(null);
    setData(null);

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      const lang = settings.targetLang || 'zh-CN';
      const key = cacheKey(currentId || 'unknown', page || 0, 'explain', lang, normalizeTerm(term));
      try {
        const cached = await getCached(key);
        if (cached && token === tokenRef.current) {
          setData(cached);
          setLoading(false);
          return;
        }
        const messages = buildExplainMessages({
          term,
          context: pageContent.text || '',
          targetLang: lang,
        });
        const json = await requestJson(messages, {
          settings,
          signal: controller.signal,
        });
        if (token !== tokenRef.current) return;
        const parsed = {
          term: String(json?.term || term),
          zh: String(json?.zh || ''),
          simple: String(json?.simple || ''),
          related: Array.isArray(json?.related) ? json.related.filter(Boolean).slice(0, 6) : [],
        };
        await setCached(key, parsed);
        if (token !== tokenRef.current) return;
        setData(parsed);
      } catch (err) {
        if (token !== tokenRef.current) return;
        if (err && err.name === 'AbortError') return;
        setError(String(err?.message || err || '解释失败'));
      } finally {
        if (token === tokenRef.current) setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [term, aiEnabled, aiKey, pageContent.text, settings, currentId, page]);

  /* 浮层卸载时兜底取消在途请求 */
  useEffect(
    () => () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    },
    []
  );

  if (!selection || !term) return null;

  const rect = selection.rect || {};
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.min(Math.max(8, rect.left || 8), Math.max(8, viewportW - POPUP_WIDTH - 12));
  const placeAbove = (rect.bottom || 0) + 250 > viewportH;

  const style = {
    left,
    width: POPUP_WIDTH,
    top: placeAbove ? undefined : (rect.bottom || 0) + 8,
    bottom: placeAbove ? Math.max(8, viewportH - (rect.top || 0) + 8) : undefined,
  };

  return (
    <div
      data-selection-popup="true"
      style={style}
      className="fixed z-50 animate-fade-in rounded-xl border border-slate-200 bg-white p-3 shadow-pop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[13px] font-semibold leading-5 text-slate-900">{term}</div>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onClick={onClear}
          title="关闭"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto scroll-thin">
        {!aiEnabled ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            未配置 AI 模型，无法解释。
            <button
              type="button"
              className="ml-1 text-brand-600 hover:underline"
              onClick={() => setSettingsOpen(true)}
            >
              去设置
            </button>
          </div>
        ) : null}

        {aiEnabled && loading ? <Loader text="AI 正在解释…" size="sm" className="justify-start py-1" /> : null}

        {aiEnabled && error && !loading ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>
        ) : null}

        {aiEnabled && data && !loading ? (
          <div className="space-y-2">
            {data.zh ? (
              <div>
                <div className="text-[11px] font-medium text-slate-400">中文释义</div>
                <div className="text-[13.5px] leading-6 text-slate-900">{data.zh}</div>
              </div>
            ) : null}
            {data.simple ? (
              <div>
                <div className="text-[11px] font-medium text-slate-400">简单理解</div>
                <div className="text-[13px] leading-6 text-slate-600">{data.simple}</div>
              </div>
            ) : null}
            {data.related.length ? (
              <div>
                <div className="text-[11px] font-medium text-slate-400">相关概念</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.related.map((item, index) => (
                    <span key={`rel-${index}`} className="chip">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {aiEnabled ? (
        <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            className="btn px-2.5 py-1 text-xs"
            onClick={() => onAskDetail(term)}
          >
            详细解释
          </button>
          <button
            type="button"
            className={`btn px-2.5 py-1 text-xs ${added ? 'text-brand-600' : ''}`}
            disabled={!data || added}
            onClick={() => {
              if (addVocab({ term: data?.term || term, zh: data?.zh, simple: data?.simple })) {
                setAdded(true);
              }
            }}
          >
            {added ? '已加入' : '加入生词本'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
