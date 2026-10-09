/**
 * 上传区（首屏）：点击选择文件 + 拖拽上传 + 最近阅读列表。
 */
import { useCallback, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { formatBytes } from '../lib/pdf';
import Loader from './Loader';

/**
 * 上传图标。
 * @returns {JSX.Element} SVG
 */
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/**
 * 上传区。
 * @returns {JSX.Element} 上传区
 */
export default function UploadZone() {
  const { importFiles, files, openPdfById, removeFile, busy, docError } = useApp();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      const dropped = event.dataTransfer?.files;
      if (dropped && dropped.length) importFiles(dropped);
    },
    [importFiles]
  );

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-10">
      <div
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'
        }`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="text-brand-500">
          <UploadIcon />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">把 PDF 拖到这里</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          或者点击下面的按钮选择文件 · 支持一次上传多个 PDF
        </p>
        <button
          type="button"
          className="btn-primary mt-5 px-5 py-2"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? '处理中…' : '选择 PDF 文件'}
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
        <p className="mt-4 text-xs text-slate-400">
          文件保存在浏览器本地（IndexedDB），不会上传到任何服务器；原文仅在你配置的 AI 模型请求时按需发送。
        </p>
        {docError ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{docError}</p>
        ) : null}
        {busy ? <Loader className="mt-4" text="正在解析 PDF…" size="sm" /> : null}
      </div>

      {files.length > 0 ? (
        <section className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">最近阅读</h3>
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-600">
                  PDF
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openPdfById(file.id)}
                >
                  <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {formatBytes(file.size)}
                    {file.pageCount ? ` · ${file.pageCount} 页` : ''}
                    {file.lastPage && file.lastPage > 1 ? ` · 读到第 ${file.lastPage} 页` : ''}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs text-slate-400 hover:text-rose-600"
                  onClick={() => removeFile(file.id)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
