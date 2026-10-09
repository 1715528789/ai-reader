/**
 * 通用加载指示组件。
 */

/**
 * 转圈 + 文案的加载指示。
 * @param {object} props 属性
 * @param {string} [props.text] 文案
 * @param {'sm'|'md'|'lg'} [props.size] 尺寸
 * @param {string} [props.className] 追加类名
 * @returns {JSX.Element} 加载指示
 */
export default function Loader({ text = '加载中…', size = 'md', className = '' }) {
  const sizeMap = {
    sm: 'h-3.5 w-3.5 border-2',
    md: 'h-5 w-5 border-2',
    lg: 'h-8 w-8 border-[3px]',
  };
  const textMap = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };
  return (
    <div className={`flex items-center justify-center gap-2 text-slate-500 ${textMap[size] || textMap.md} ${className}`}>
      <span
        className={`inline-block animate-spin rounded-full border-brand-500 border-t-transparent ${sizeMap[size] || sizeMap.md}`}
        role="status"
        aria-label="loading"
      />
      <span>{text}</span>
    </div>
  );
}

/**
 * 骨架占位块（用于 AI 结果加载中的排版占位）。
 * @param {object} props 属性
 * @param {number} [props.lines] 行数
 * @returns {JSX.Element} 骨架
 */
export function Skeleton({ lines = 3 }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={`skeleton-${index}`}
          className="h-3.5 animate-pulse-soft rounded bg-slate-200"
          style={{ width: `${100 - (index % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}
