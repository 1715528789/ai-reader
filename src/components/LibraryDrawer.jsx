/**
 * 最近阅读 / 多文件管理抽屉。
 */
import { useRef } from 'react';
import { useApp } from '../store/AppContext';
import { formatBytes } from '../lib/pdf';

/**
 * 文件库抽屉。
 * @returns {JSX.Element|null} 抽屉
 */
export default function LibraryDrawer() {
  const {
    libraryOpen,
    setLibraryOpen,
    files,
    currentId,
    openPdfById,
    removeFile,
    importFiles,
    busy,
  } = useApp();
  const inputRef = useRef(null);

  if (!libraryOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="flex-1 bg-slate-900/20"
        onClick={() => setLibraryOpen(false)}
        role="presentation"
      />
      <aside className="flex h-full w-[340px] animate-fade-in flex-col border-l border-slate-200 bg-white shadow-pop">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">最近阅读</div>
            <div className="text-xs text-slate-400">共 {files.length} 个文件</div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            onClick={() => setLibraryOpen(false)}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
          {!files.length ? (
            <p className="px-1 py-8 text-center text-xs text-slate-400">
              还没有文件，先上传一个 PDF 吧。
            </p>
          ) : (
            <ul className="space-y-2">
              {files.map((file) => {
                const active = file.id === currentId;
                return (
                  <li
                    key={file.id}
                    className={`rounded-xl border px-3 py-2.5 transition ${
                      active ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => openPdfById(file.id)}
                    >
                      <div className="truncate text-[13.5px] font-medium text-slate-800">
                        {file.name}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {formatBytes(file.size)}
                        {file.pageCount ? ` · ${file.pageCount} 页` : ''}
                        {file.lastPage && file.lastPage > 1 ? ` · 读到第 ${file.lastPage} 页` : ''}
                      </div>
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`chip ${active ? 'bg-white text-brand-600' : 'text-slate-500'}`}
                      >
                        {active ? '正在阅读' : '未打开'}
                      </span>
                      <button
                        type="button"
                        className="ml-auto btn-ghost px-1.5 text-xs text-slate-400 hover:text-rose-600"
                        onClick={() => removeFile(file.id)}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 p-3">
          <button
            type="button"
            className="btn-primary w-full py-2"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '处理中…' : '上传新 PDF'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files;
              if (picked && picked.length) importFiles(picked);
              event.target.value = '';
            }}
          />
        </div>
      </aside>
    </div>
  );
}
