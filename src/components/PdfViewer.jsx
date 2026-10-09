/**
 * 左侧 PDF 阅读区：pdf.js 渲染 canvas + 可选中文本层 + 缩放工具条 + 底部翻页栏。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { getPage, startRenderPage, renderTextLayer } from '../lib/pdf';
import Loader from './Loader';

/**
 * PDF 阅读器。
 * @param {object} props 属性
 * @param {import('react').RefObject<HTMLElement>} props.containerRef 文本层容器引用（供划词使用）
 * @returns {JSX.Element} 阅读区
 */
export default function PdfViewer({ containerRef }) {
  const {
    pdfDoc,
    page,
    numPages,
    setPage,
    prevPage,
    nextPage,
    scale,
    setScale,
    zoomMode,
    setZoomMode,
  } = useApp();

  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const tokenRef = useRef(0);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0, page: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  /* 监听容器宽度（适应宽度模式需要） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!baseSize.width || !containerWidth) return 1;
    const available = Math.max(240, containerWidth - 56);
    return Math.min(4, Math.max(0.25, available / baseSize.width));
  }, [baseSize.width, containerWidth]);

  const effectiveScale = zoomMode === 'fit' ? fitScale : scale;

  /* 渲染当前页 */
  useEffect(() => {
    if (!pdfDoc || !page || !effectiveScale) return undefined;
    let cancelled = false;
    const token = tokenRef.current + 1;
    tokenRef.current = token;

    setRendering(true);
    setRenderError(null);

    (async () => {
      try {
        const pageObj = await getPage(pdfDoc, page);
        if (!pageObj || cancelled || token !== tokenRef.current) return;

        const base = pageObj.getViewport({ scale: 1 });
        setBaseSize((prev) => {
          const same =
            prev.page === page &&
            Math.abs(prev.width - base.width) < 0.5 &&
            Math.abs(prev.height - base.height) < 0.5;
          return same ? prev : { width: base.width, height: base.height, page };
        });

        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch (err) {
            /* 忽略取消异常 */
          }
          renderTaskRef.current = null;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const { renderTask, viewport, cssWidth, cssHeight } = startRenderPage(
          pageObj,
          canvas,
          effectiveScale,
          window.devicePixelRatio || 1
        );
        renderTaskRef.current = renderTask;
        setSize({ w: cssWidth, h: cssHeight });

        await renderTask.promise;
        if (cancelled || token !== tokenRef.current) return;

        await renderTextLayer(pageObj, viewport, textLayerRef.current);
        if (cancelled || token !== tokenRef.current) return;
        setRendering(false);
      } catch (err) {
        if (cancelled || token !== tokenRef.current) return;
        if (err && err.name === 'RenderingCancelledException') return;
        setRendering(false);
        setRenderError(String(err?.message || err || '页面渲染失败'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page, effectiveScale]);

  /* 卸载时取消渲染 */
  useEffect(
    () => () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (err) {
          /* 忽略 */
        }
        renderTaskRef.current = null;
      }
    },
    []
  );

  /* 换页回到顶部 */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);

  const zoomIn = () => {
    setZoomMode('manual');
    setScale((s) => Math.min(4, Number((s * 1.2).toFixed(2))));
  };
  const zoomOut = () => {
    setZoomMode('manual');
    setScale((s) => Math.max(0.25, Number((s / 1.2).toFixed(2))));
  };
  const fitWidth = () => setZoomMode('fit');

  const commitPageInput = () => {
    const value = Number.parseInt(pageInput, 10);
    if (Number.isFinite(value)) setPage(value);
    else setPageInput(String(page));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      {/* 工具条 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2 text-xs" onClick={prevPage} disabled={page <= 1}>
            ← 上一页
          </button>
          <button
            type="button"
            className="btn-ghost px-2 text-xs"
            onClick={nextPage}
            disabled={page >= numPages}
          >
            下一页 →
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2 text-sm" onClick={zoomOut} title="缩小">
            －
          </button>
          <span className="w-14 text-center text-xs tabular-nums text-slate-500">
            {Math.round(effectiveScale * 100)}%
          </span>
          <button type="button" className="btn-ghost px-2 text-sm" onClick={zoomIn} title="放大">
            ＋
          </button>
          <button
            type="button"
            className={`btn-ghost px-2 text-xs ${zoomMode === 'fit' ? 'bg-slate-100 text-brand-600' : ''}`}
            onClick={fitWidth}
          >
            适应宽度
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
        <div
          ref={containerRef}
          className="pdf-page shadow-card"
          style={{ width: size.w || undefined, height: size.h || undefined }}
        >
          <canvas ref={canvasRef} className="absolute left-0 top-0 bg-white" />
          <div ref={textLayerRef} className="text-layer" />
          {rendering ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <Loader text="渲染中…" size="sm" />
            </div>
          ) : null}
          {renderError && !rendering ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 px-6 text-center text-xs text-rose-600">
              {renderError}
            </div>
          ) : null}
        </div>
      </div>

      {/* 底部翻页栏 */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 text-xs">
        <div className="flex items-center gap-2">
          <button type="button" className="btn px-2" onClick={prevPage} disabled={page <= 1}>
            ←
          </button>
          <input
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitPageInput();
                event.currentTarget.blur();
              }
            }}
            className="w-14 rounded-md border border-slate-200 px-2 py-1 text-center text-xs tabular-nums outline-none focus:border-brand-400"
            inputMode="numeric"
          />
          <span className="text-slate-500">/ {numPages || 0}</span>
          <button type="button" className="btn px-2" onClick={nextPage} disabled={page >= numPages}>
            →
          </button>
        </div>
        <div className="font-medium tabular-nums text-slate-600">
          第 {page} / {numPages || 0} 页
        </div>
        <div className="hidden text-slate-400 sm:block">方向键翻页 · 选中文字可问 AI</div>
      </div>
    </div>
  );
}
