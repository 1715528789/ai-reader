/**
 * 右侧「翻译」视图：原文段落 ↔ 中文翻译段落一一对照。
 */
import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import Loader, { Skeleton } from './Loader';

/**
 * 未配置 AI 时的引导卡片。
 * @returns {JSX.Element} 引导卡片
 */
export function AiGuide() {
  const { setSettingsOpen } = useApp();
  return (
    <div className="mx-4 mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <div className="text-sm font-medium text-slate-700">请先在设置中配置 AI 模型与 API Key</div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        PDF 阅读、翻页、划词等功能不受影响，照常可用。<br />
        配置后即可获得逐段翻译、重点解读与整本问答。
      </p>
      <button type="button" className="btn-primary mt-4 px-4 py-1.5" onClick={() => setSettingsOpen(true)}>
        去设置
      </button>
    </div>
  );
}

/**
 * 翻译视图。
 * @param {object} props 属性
 * @param {Array<{id: string, text: string}>} props.paragraphs 原文段落
 * @param {object|null} props.translation 翻译结果 {paragraphs:[{id,zh}]}
 * @param {boolean} props.loading 是否加载中
 * @param {string|null} props.error 错误信息
 * @param {boolean} props.fromCache 是否来自缓存
 * @param {() => void} props.onRefresh 重新生成
 * @returns {JSX.Element} 翻译视图
 */
export default function TranslationView({
  paragraphs,
  translation,
  loading,
  error,
  fromCache,
  ocr = false,
  onRefresh,
}) {
  const { aiEnabled, settings } = useApp();

  const zhMap = useMemo(() => {
    const map = new Map();
    const list = translation?.paragraphs || [];
    for (const item of list) {
      if (item && item.id) map.set(String(item.id), String(item.zh || ''));
    }
    return map;
  }, [translation]);

  if (!aiEnabled) return <AiGuide />;

  const hasResult = zhMap.size > 0;
  const showLoading = loading && !hasResult;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>逐段对照翻译</span>
          {hasResult ? (
            <span className="chip">
              {zhMap.size}/{paragraphs.length} 段
            </span>
          ) : null}
          {translation?.batches > 1 ? (
            <span className="chip">分 {translation.batches} 批翻译</span>
          ) : null}
          {ocr && hasResult ? <span className="chip text-brand-600">AI 视觉识别</span> : null}
          {fromCache && hasResult ? <span className="chip text-brand-600">已缓存</span> : null}
        </div>
        <button
          type="button"
          className="btn-ghost px-2 text-xs"
          onClick={onRefresh}
          disabled={loading || !paragraphs.length}
        >
          重新翻译
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && !hasResult ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600">
            <div className="font-medium">翻译失败</div>
            <div className="mt-1 leading-relaxed">{error}</div>
          </div>
        ) : null}

        {showLoading ? (
          <div className="space-y-4">
            <Loader
              text={paragraphs.length ? '正在翻译…' : '正在用 AI 识别这一页…'}
              size="sm"
              className="justify-start"
            />
            <Skeleton lines={6} />
          </div>
        ) : null}

        {!paragraphs.length && !showLoading ? (
          <div className="py-10 text-center text-xs text-slate-400">
            本页没有可选中的文本层（扫描件 / 图片型 PDF）
            <div className="mx-auto mt-1.5 max-w-[260px] leading-relaxed">
              {(settings?.scanMode || 'auto') === 'off'
                ? '可在设置中开启「扫描页视觉识别」，让 AI 直接读图识别文字。'
                : 'AI 未能从这张页面图中识别出文字。可尝试放大页面，或在设置里填一个支持图片输入的视觉模型。'}
            </div>
          </div>
        ) : null}

        <ol className="space-y-3.5">
          {paragraphs.map((para) => {
            const zh = zhMap.get(para.id);
            return (
              <li key={para.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                <div className="mb-1 text-[11px] font-medium text-slate-400">原文 {para.id}</div>
                <p className="prose-read text-[13px] leading-6 text-slate-500">{para.text}</p>
                <div className="mt-2 border-t border-dashed border-slate-100 pt-2">
                  {zh ? (
                    <p className="prose-read text-[14px] leading-7 text-slate-900">{zh}</p>
                  ) : (
                    <p className="text-[13px] text-slate-300">
                      {loading ? '翻译中…' : '暂无译文'}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
