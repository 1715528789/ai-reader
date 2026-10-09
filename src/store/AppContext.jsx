/**
 * 全局状态：React Context + hooks（不引入 Redux）。
 * 管理：文件库、当前文档、页码、缩放、AI 设置、笔记、生词本、Toast。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { splitParagraphs, getPage, clearPageTextStore } from '../lib/pdf';
import { abortFileInflight, clearFileCache } from '../lib/cache';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  isConfigured,
} from '../lib/aiGateway';
import {
  listPdfFiles as dbListFiles,
  savePdfFile as dbSaveFile,
  getPdfFile as dbGetFile,
  deletePdfFile as dbDeleteFile,
  clearCacheForFile as dbClearCache,
  getSettings as lsGetSettings,
  setSettings as lsSetSettings,
  setProgress as lsSetProgress,
  removeProgress as lsRemoveProgress,
  getNotes as lsGetNotes,
  setNotes as lsSetNotes,
  getVocab as lsGetVocab,
  setVocab as lsSetVocab,
} from '../lib/storage';

const AppContext = createContext(null);

/** 页码裁剪 */
const clamp = (value, min, max) => Math.min(Math.max(Math.floor(value || 1), min), max);

/**
 * 生成文件 id。
 * @returns {string} id
 */
function createId() {
  return `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 读取全局状态。
 * @returns {object} 上下文
 */
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}

/**
 * 全局状态提供者。
 * @param {{children: React.ReactNode}} props 属性
 * @returns {JSX.Element} Provider
 */
export function AppProvider({ children }) {
  const [files, setFiles] = useState([]);
  const [source, setSource] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [currentMeta, setCurrentMeta] = useState(null);
  const [page, setPageRaw] = useState(1);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState('fit');
  const [settings, setSettingsState] = useState(() => normalizeSettings(lsGetSettings() || DEFAULT_SETTINGS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('translate');
  const [pageContent, setPageContent] = useState({ paragraphs: [], text: '', loading: false });
  const [notes, setNotesState] = useState(() => lsGetNotes());
  const [vocab, setVocabState] = useState(() => lsGetVocab());
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const { pdfDoc, numPages, loading: docLoading, error: docError } = usePdfDocument(source);
  const pageTextRef = useRef(new Map());
  const pageInputRef = useRef(null);

  /* --------------------------------- Toast -------------------------------- */
  const notify = useCallback((msg, type = 'info') => {
    setToast({ msg, type, id: Date.now() + Math.random() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  /* --------------------------------- 文件库 -------------------------------- */
  const refreshFiles = useCallback(async () => {
    try {
      const list = await dbListFiles();
      setFiles(list);
    } catch (err) {
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  /**
   * 导入本地 PDF 文件（支持多选）。
   * @param {FileList|Array<File>} fileList 文件列表
   * @returns {Promise<void>} 无返回值
   */
  const importFiles = useCallback(
    async (fileList) => {
      const list = Array.from(fileList || []).filter(
        (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''))
      );
      if (!list.length) {
        notify('请选择 PDF 文件', 'error');
        return;
      }
      setBusy(true);
      try {
        let lastId = null;
        for (const file of list) {
          const id = createId();
          await dbSaveFile({
            id,
            name: file.name,
            size: file.size,
            type: file.type || 'application/pdf',
            blob: file,
            addedAt: Date.now(),
            lastPage: 1,
            pageCount: 0,
          });
          lastId = id;
        }
        await refreshFiles();
        if (lastId) await openPdfById(lastId);
      } catch (err) {
        notify(`导入失败：${String(err?.message || err)}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshFiles, notify]
  );

  /**
   * 打开文件库中的某个 PDF。
   * @param {string} id 文件 id
   * @returns {Promise<void>} 无返回值
   */
  const openPdfById = useCallback(
    async (id) => {
      setBusy(true);
      try {
        const record = await dbGetFile(id);
        if (!record) {
          notify('文件不存在或已被删除', 'error');
          return;
        }
        abortFileInflight(id);
        clearPageTextStore();
        pageTextRef.current = new Map();
        setCurrentId(id);
        setCurrentMeta({ id, name: record.name, size: record.size });
        setZoomMode('fit');
        setScale(1);
        setPageRaw(1);
        setActiveTab('translate');
        setSource({
          id,
          blob: record.blob,
          name: record.name,
          size: record.size,
          lastPage: record.lastPage || 1,
        });
        setLibraryOpen(false);
      } catch (err) {
        notify(`打开失败：${String(err?.message || err)}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  /**
   * 关闭当前文件，回到上传区。
   * @returns {void}
   */
  const closeFile = useCallback(() => {
    if (currentId) abortFileInflight(currentId);
    clearPageTextStore();
    pageTextRef.current = new Map();
    setSource(null);
    setCurrentId(null);
    setCurrentMeta(null);
    setPageRaw(1);
    setPageContent({ paragraphs: [], text: '', loading: false });
  }, [currentId]);

  /**
   * 从文件库中删除某个 PDF（含缓存与进度）。
   * @param {string} id 文件 id
   * @returns {Promise<void>} 无返回值
   */
  const removeFile = useCallback(
    async (id) => {
      try {
        abortFileInflight(id);
        await dbClearCache(id);
        await clearFileCache(id);
        await dbDeleteFile(id);
        lsRemoveProgress(id);
        if (id === currentId) closeFile();
        await refreshFiles();
        notify('已删除文件', 'success');
      } catch (err) {
        notify(`删除失败：${String(err?.message || err)}`, 'error');
      }
    },
    [currentId, closeFile, refreshFiles, notify]
  );

  /* ------------------------------ 文档就绪后同步 ----------------------------- */
  useEffect(() => {
    if (!pdfDoc || !source) return;
    const last = clamp(source.lastPage || 1, 1, Math.max(1, numPages));
    setPageRaw(last);
  }, [pdfDoc, source, numPages]);

  useEffect(() => {
    if (!source || !numPages) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const record = await dbGetFile(source.id);
        if (cancelled || !record) return;
        if (record.pageCount !== numPages) {
          await dbSaveFile({ ...record, pageCount: numPages });
          await refreshFiles();
        }
      } catch (err) {
        /* 忽略页数同步失败 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, numPages, refreshFiles]);

  /* -------------------------------- 阅读进度 -------------------------------- */
  useEffect(() => {
    if (!currentId || !page) return undefined;
    const timer = setTimeout(() => {
      lsSetProgress(currentId, page);
      setFiles((prev) =>
        prev.map((f) => (f.id === currentId ? { ...f, lastPage: page } : f))
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [currentId, page]);

  /* -------------------------------- 页面文本 -------------------------------- */
  useEffect(() => {
    if (!pdfDoc || !page) {
      setPageContent({ paragraphs: [], text: '', loading: false });
      return undefined;
    }
    let cancelled = false;
    setPageContent((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const pageObj = await getPage(pdfDoc, page);
        if (!pageObj) throw new Error('页面不存在');
        const content = await pageObj.getTextContent();
        if (cancelled) return;
        const paragraphs = splitParagraphs(content.items || []);
        const text = paragraphs.map((p) => p.text).join('\n\n');
        pageTextRef.current.set(page, text);
        setPageContent({ paragraphs, text, loading: false });
      } catch (err) {
        if (cancelled) return;
        setPageContent({ paragraphs: [], text: '', loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page]);

  /* --------------------------------- 翻页 --------------------------------- */
  const setPage = useCallback(
    (value) => {
      setPageRaw((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        return clamp(next, 1, Math.max(1, numPages));
      });
    },
    [numPages]
  );

  const nextPage = useCallback(() => setPage((p) => p + 1), [setPage]);
  const prevPage = useCallback(() => setPage((p) => p - 1), [setPage]);

  /* --------------------------------- 设置 --------------------------------- */
  const updateSettings = useCallback((next) => {
    const merged = normalizeSettings({ ...next });
    setSettingsState(merged);
    lsSetSettings(merged);
  }, []);

  const aiKey = useMemo(
    () =>
      JSON.stringify({
        provider: settings.provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        targetLang: settings.targetLang,
        scanMode: settings.scanMode,
        visionModel: settings.visionModel,
      }),
    [settings]
  );

  const aiEnabled = useMemo(() => isConfigured(settings), [settings]);

  /* --------------------------------- 笔记 --------------------------------- */
  const addNote = useCallback(
    (text) => {
      const content = String(text || '').trim();
      if (!content) return false;
      const item = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fileId: currentId,
        fileName: currentMeta?.name || '',
        page,
        text: content,
        createdAt: Date.now(),
      };
      const next = [item, ...notes];
      setNotesState(next);
      lsSetNotes(next);
      notify('已保存笔记', 'success');
      return true;
    },
    [currentId, currentMeta, page, notes, notify]
  );

  const removeNote = useCallback(
    (id) => {
      const next = notes.filter((n) => n.id !== id);
      setNotesState(next);
      lsSetNotes(next);
    },
    [notes]
  );

  /* -------------------------------- 生词本 -------------------------------- */
  const addVocab = useCallback(
    (entry) => {
      if (!entry || !entry.term) return false;
      const term = String(entry.term).trim();
      if (!term) return false;
      if (vocab.some((v) => v.term.toLowerCase() === term.toLowerCase())) {
        notify('该词条已在生词本中', 'info');
        return false;
      }
      const item = {
        id: `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        term,
        zh: String(entry.zh || '').trim(),
        simple: String(entry.simple || '').trim(),
        fileId: currentId,
        fileName: currentMeta?.name || '',
        page,
        createdAt: Date.now(),
      };
      const next = [item, ...vocab];
      setVocabState(next);
      lsSetVocab(next);
      notify('已加入生词本', 'success');
      return true;
    },
    [vocab, currentId, currentMeta, page, notify]
  );

  const removeVocab = useCallback(
    (id) => {
      const next = vocab.filter((v) => v.id !== id);
      setVocabState(next);
      lsSetVocab(next);
    },
    [vocab]
  );

  /* ------------------------------ 整本关键词检索 ----------------------------- */
  /**
   * 在整本 PDF 中做轻量关键词检索（MVP 用关键词代替向量库）。
   * @param {string} keyword 关键词
   * @param {object} options 选项
   * @param {number} [options.maxHits] 最多命中数
   * @param {number} [options.maxPages] 最多扫描页数
   * @returns {Promise<Array<{page: number, snippet: string}>>} 命中片段
   */
  const searchBook = useCallback(
    async (keyword, options = {}) => {
      const { maxHits = 6, maxPages = 260 } = options;
      const kw = String(keyword || '').trim().toLowerCase();
      if (!pdfDoc || !kw) return [];
      const hits = [];
      const limit = Math.min(numPages || 0, maxPages);
      for (let p = 1; p <= limit; p += 1) {
        let text = pageTextRef.current.get(p);
        if (text === undefined) {
          // eslint-disable-next-line no-await-in-loop
          const pageObj = await getPage(pdfDoc, p);
          if (!pageObj) continue;
          // eslint-disable-next-line no-await-in-loop
          const content = await pageObj.getTextContent();
          text = splitParagraphs(content.items || [])
            .map((x) => x.text)
            .join('\n\n');
          pageTextRef.current.set(p, text);
        }
        const idx = text.toLowerCase().indexOf(kw);
        if (idx !== -1) {
          const start = Math.max(0, idx - 140);
          const end = Math.min(text.length, idx + 260);
          hits.push({ page: p, snippet: text.slice(start, end) });
          if (hits.length >= maxHits) break;
        }
      }
      return hits;
    },
    [pdfDoc, numPages]
  );

  const pageInputRefExposed = pageInputRef;

  const value = useMemo(
    () => ({
      files,
      refreshFiles,
      importFiles,
      openPdfById,
      removeFile,
      closeFile,
      currentId,
      currentMeta,
      pdfDoc,
      numPages,
      docLoading,
      docError,
      page,
      setPage,
      nextPage,
      prevPage,
      scale,
      setScale,
      zoomMode,
      setZoomMode,
      pageContent,
      settings,
      updateSettings,
      aiKey,
      aiEnabled,
      settingsOpen,
      setSettingsOpen,
      libraryOpen,
      setLibraryOpen,
      activeTab,
      setActiveTab,
      notes,
      addNote,
      removeNote,
      vocab,
      addVocab,
      removeVocab,
      searchBook,
      toast,
      notify,
      busy,
      pageInputRef: pageInputRefExposed,
    }),
    [
      files,
      refreshFiles,
      importFiles,
      openPdfById,
      removeFile,
      closeFile,
      currentId,
      currentMeta,
      pdfDoc,
      numPages,
      docLoading,
      docError,
      page,
      setPage,
      nextPage,
      prevPage,
      scale,
      zoomMode,
      pageContent,
      settings,
      updateSettings,
      aiKey,
      aiEnabled,
      settingsOpen,
      libraryOpen,
      activeTab,
      notes,
      addNote,
      removeNote,
      vocab,
      addVocab,
      removeVocab,
      searchBook,
      toast,
      notify,
      busy,
      pageInputRefExposed,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export default AppContext;
