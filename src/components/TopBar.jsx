/**
 * 顶部栏：产品名、当前文件名、资料库入口、设置入口。
 */
import { useApp } from '../store/AppContext';

/**
 * 齿轮图标。
 * @returns {JSX.Element} SVG
 */
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * 书架图标。
 * @returns {JSX.Element} SVG
 */
function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 7h7M9 11h5" />
    </svg>
  );
}

/**
 * 顶部栏。
 * @returns {JSX.Element} 顶部栏
 */
export default function TopBar() {
  const {
    currentMeta,
    numPages,
    setSettingsOpen,
    setLibraryOpen,
    libraryOpen,
    closeFile,
    aiEnabled,
  } = useApp();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          AI
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight text-slate-900">AI Reader</div>
          <div className="truncate text-xs leading-tight text-slate-500">
            {currentMeta ? currentMeta.name : '阅读原文 · 实时翻译 · 重点解读 · AI 问答'}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {currentMeta && numPages > 0 ? (
          <span className="hidden text-xs text-slate-400 sm:inline">共 {numPages} 页</span>
        ) : null}
        <button
          type="button"
          className={`btn ${libraryOpen ? 'bg-slate-100' : ''}`}
          onClick={() => setLibraryOpen(!libraryOpen)}
        >
          <BookIcon />
          最近阅读
        </button>
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
          <GearIcon />
          <span className="hidden sm:inline">设置</span>
          {!aiEnabled ? (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" title="尚未配置 API Key" />
          ) : null}
        </button>
        {currentMeta ? (
          <button type="button" className="btn-ghost" onClick={closeFile} title="关闭当前文件">
            关闭
          </button>
        ) : null}
      </div>
    </header>
  );
}

export { GearIcon, BookIcon };
