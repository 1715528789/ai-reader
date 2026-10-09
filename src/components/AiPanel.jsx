/**
 * 右侧 AI 区域容器：Tabs（翻译 / 解读 / 问答 / 笔记）。
 * 内部调度当前页 AI 任务（翻译 + 解读）与相邻页预取。
 */
import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAiPage } from '../hooks/useAiPage';
import TranslationView from './TranslationView';
import InsightView from './InsightView';
import ChatView from './ChatView';
import Loader from './Loader';

const TABS = [
  { key: 'translate', label: '翻译' },
  { key: 'insight', label: '解读' },
  { key: 'chat', label: '问答' },
  { key: 'notes', label: '笔记' },
];

/**
 * 笔记与生词本视图。
 * @returns {JSX.Element} 笔记视图
 */
function NotesView() {
  const { notes, removeNote, vocab, removeVocab, page, currentId, setPage, addNote } = useApp();
  const [draft, setDraft] = useState('');

  const myNotes = useMemo(
    () => notes.filter((n) => !currentId || n.fileId === currentId),
    [notes, currentId]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        <section>
          <h4 className="mb-2 text-xs font-semibold text-slate-500">生词本（{vocab.length}）</h4>
          {!vocab.length ? (
            <p className="text-xs text-slate-400">选中 PDF 中的词句后，点击「加入生词本」即可收藏。</p>
          ) : (
            <ul className="space-y-2">
              {vocab.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-slate-900">{item.term}</div>
                      {item.zh ? (
                        <div className="mt-0.5 text-[13px] text-slate-600">{item.zh}</div>
                      ) : null}
                      {item.simple ? (
                        <div className="mt-1 text-xs leading-relaxed text-slate-500">{item.simple}</div>
                      ) : null}
                      <div className="mt-1 text-[11px] text-slate-400">
                        {item.fileName ? `${item.fileName} · ` : ''}第 {item.page} 页
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost px-1.5 text-xs text-slate-400 hover:text-rose-600"
                      onClick={() => removeVocab(item.id)}
                    >
                      移除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold text-slate-500">阅读笔记（{myNotes.length}）</h4>
          <div className="mb-2 rounded-lg border border-slate-200 bg-white p-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder={`记下第 ${page} 页的想法…`}
              className="w-full resize-none border-0 text-[13px] outline-none placeholder:text-slate-400"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">保存在本地浏览器</span>
              <button
                type="button"
                className="btn-primary px-3 py-1 text-xs"
                disabled={!draft.trim()}
                onClick={() => {
                  if (addNote(draft)) setDraft('');
                }}
              >
                保存
              </button>
            </div>
          </div>
          {!myNotes.length ? (
            <p className="text-xs text-slate-400">还没有笔记。</p>
          ) : (
            <ul className="space-y-2">
              {myNotes.map((note) => (
                <li key={note.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                      {note.text}
                    </p>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-1.5 text-xs text-slate-400 hover:text-rose-600"
                      onClick={() => removeNote(note.id)}
                    >
                      删除
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span>第 {note.page} 页</span>
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={() => setPage(note.page)}
                    >
                      跳转
                    </button>
                    <span>{new Date(note.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * AI 面板。
 * @param {object} props 属性
 * @param {{text: string, rect: object}|null} props.selection 当前选中文本
 * @param {string} props.prefill 问答预填内容
 * @returns {JSX.Element} 右侧面板
 */
export default function AiPanel({ selection, prefill }) {
  const {
    currentId,
    currentMeta,
    pdfDoc,
    page,
    numPages,
    pageContent,
    settings,
    aiKey,
    activeTab,
    setActiveTab,
    docLoading,
  } = useApp();

  const ai = useAiPage({
    fileId: currentId,
    pdfDoc,
    page,
    numPages,
    settings,
    aiKey,
    bookTitle: currentMeta?.name || '',
  });

  // 扫描页没有文本层时，翻译结果自带视觉识别出的原文，用它做左右对照
  const paragraphs = useMemo(() => {
    const ocrParas = ai.translation?.ocr ? ai.translation.paragraphs || [] : [];
    if (ocrParas.length) return ocrParas.map((p) => ({ id: p.id, text: p.text || '' }));
    return pageContent.paragraphs || [];
  }, [ai.translation, pageContent.paragraphs]);

  return (
    <div className="flex min-h-0 w-full flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1 text-[13px] font-medium transition ${
              activeTab === tab.key
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {tab.label}
            {tab.key === 'translate' && ai.tLoading ? (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            ) : null}
            {tab.key === 'insight' && ai.iLoading ? (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            ) : null}
          </button>
        ))}
        <div className="ml-auto pr-1">
          {docLoading ? <Loader text="解析 PDF…" size="sm" /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'translate' ? (
          <TranslationView
            paragraphs={paragraphs}
            translation={ai.translation}
            loading={ai.tLoading || pageContent.loading}
            error={ai.tError}
            fromCache={ai.tFromCache}
            ocr={Boolean(ai.translation?.ocr)}
            onRefresh={ai.refresh}
          />
        ) : null}
        {activeTab === 'insight' ? (
          <InsightView
            insight={ai.insight}
            loading={ai.iLoading || pageContent.loading}
            error={ai.iError}
            fromCache={ai.iFromCache}
            onRefresh={ai.refresh}
          />
        ) : null}
        {activeTab === 'chat' ? <ChatView selection={selection} prefill={prefill} /> : null}
        {activeTab === 'notes' ? <NotesView /> : null}
      </div>
    </div>
  );
}
