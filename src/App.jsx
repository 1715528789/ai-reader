/**
 * 应用外壳：顶部栏 + 左侧 PDF（55%）/ 右侧 AI（45%）+ 划词浮层 + 弹层。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import { useSelection } from './hooks/useSelection';
import TopBar from './components/TopBar';
import UploadZone from './components/UploadZone';
import PdfViewer from './components/PdfViewer';
import AiPanel from './components/AiPanel';
import SelectionPopup from './components/SelectionPopup';
import SettingsDialog from './components/SettingsDialog';
import LibraryDrawer from './components/LibraryDrawer';
import Loader from './components/Loader';

/**
 * 主界面。
 * @returns {JSX.Element} 应用
 */
function AppShell() {
  const { pdfDoc, numPages, prevPage, nextPage, setPage, setActiveTab, docLoading, toast } =
    useApp();
  const viewerRef = useRef(null);
  const { selection, clear } = useSelection(viewerRef);
  const [prefill, setPrefill] = useState(null);

  /* 键盘翻页 */
  useEffect(() => {
    if (!pdfDoc) return undefined;
    /**
     * 键盘处理。
     * @param {KeyboardEvent} event 事件
     * @returns {void}
     */
    const onKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        prevPage();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        nextPage();
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        setPage(numPages);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfDoc, prevPage, nextPage, numPages, setPage]);

  const askDetail = useCallback(
    (term) => {
      setActiveTab('chat');
      setPrefill({ text: `请详细解释：${term}`, id: Date.now() });
      clear();
    },
    [setActiveTab, clear]
  );

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <TopBar />

      {!pdfDoc ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {docLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader text="正在打开 PDF…" />
            </div>
          ) : (
            <UploadZone />
          )}
        </div>
      ) : (
        <main className="flex min-h-0 flex-1">
          <section className="flex min-h-0 min-w-0 basis-[55%] flex-col border-r border-slate-200">
            <PdfViewer containerRef={viewerRef} />
          </section>
          <section className="flex min-h-0 min-w-0 basis-[45%] flex-col">
            <AiPanel selection={selection} prefill={prefill} />
          </section>
        </main>
      )}

      <SelectionPopup selection={selection} onClear={clear} onAskDetail={askDetail} />
      <SettingsDialog />
      <LibraryDrawer />

      {toast ? (
        <div
          className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-fade-in rounded-lg px-4 py-2 text-sm text-white shadow-pop ${
            toast.type === 'error'
              ? 'bg-rose-600'
              : toast.type === 'success'
                ? 'bg-emerald-600'
                : 'bg-slate-800'
          }`}
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 应用根组件。
 * @returns {JSX.Element} Provider 包裹的应用
 */
export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
