/**
 * 右侧「解读」视图：一句话总结 / 核心观点 / 为什么 / 举例。
 */
import { useApp } from '../store/AppContext';
import Loader, { Skeleton } from './Loader';
import { AiGuide } from './TranslationView';

/**
 * 解读视图。
 * @param {object} props 属性
 * @param {object|null} props.insight 解读结果 {summary, points, example}
 * @param {boolean} props.loading 是否加载中
 * @param {string|null} props.error 错误信息
 * @param {boolean} props.fromCache 是否来自缓存
 * @param {() => void} props.onRefresh 重新生成
 * @returns {JSX.Element} 解读视图
 */
export default function InsightView({ insight, loading, error, fromCache, onRefresh }) {
  const { aiEnabled } = useApp();

  if (!aiEnabled) return <AiGuide />;

  const hasResult = Boolean(insight && (insight.summary || insight.points?.length));
  const showLoading = loading && !hasResult;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>本页重点解读</span>
          {fromCache && hasResult ? <span className="chip text-brand-600">已缓存</span> : null}
        </div>
        <button type="button" className="btn-ghost px-2 text-xs" onClick={onRefresh} disabled={loading}>
          重新解读
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && !hasResult ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600">
            <div className="font-medium">解读失败</div>
            <div className="mt-1 leading-relaxed">{error}</div>
          </div>
        ) : null}

        {showLoading ? (
          <div className="space-y-4">
            <Loader text="正在解读这一页…" size="sm" className="justify-start" />
            <Skeleton lines={7} />
          </div>
        ) : null}

        {!hasResult && !showLoading && !error ? (
          <div className="py-10 text-center text-xs text-slate-400">本页暂时没有可解读的内容</div>
        ) : null}

        {hasResult ? (
          <div className="space-y-4">
            {insight.summary ? (
              <section className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
                <h4 className="mb-1.5 text-xs font-semibold text-brand-700">一句话总结</h4>
                <p className="prose-read text-[14px] leading-7 text-slate-800">{insight.summary}</p>
              </section>
            ) : null}

            {insight.points?.length ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold text-slate-500">核心观点 · 为什么</h4>
                <ul className="space-y-2.5">
                  {insight.points.map((point, index) => (
                    <li key={`point-${index}`} className="rounded-xl border border-slate-100 bg-white px-4 py-3">
                      <div className="mb-1 flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                          {index + 1}
                        </span>
                        <span className="text-[13.5px] font-semibold leading-6 text-slate-900">
                          {point.title}
                        </span>
                      </div>
                      <p className="prose-read pl-7 text-[13.5px] leading-6 text-slate-600">
                        {point.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {insight.example ? (
              <section className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <h4 className="mb-1.5 text-xs font-semibold text-slate-500">举个例子</h4>
                <p className="prose-read text-[13.5px] leading-6 text-slate-700">{insight.example}</p>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
