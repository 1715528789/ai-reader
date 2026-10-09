/**
 * 右侧「问答」视图：三级上下文（选中文本 > 当前页 > 整本检索）+ SSE 流式输出。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { buildChatMessages, chatStream } from '../lib/aiGateway';
import { getChat, setChat } from '../lib/storage';
import Loader from './Loader';
import { AiGuide } from './TranslationView';

/**
 * 生成消息 id。
 * @returns {string} id
 */
function mid() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 问答视图。
 * @param {object} props 属性
 * @param {{text: string}|null} props.selection 当前选中文本
 * @param {{text: string, id: number}|null} props.prefill 预填问题（来自「详细解释」）
 * @returns {JSX.Element} 问答视图
 */
export default function ChatView({ selection, prefill }) {
  const {
    currentId,
    currentMeta,
    page,
    pageContent,
    searchBook,
    settings,
    aiEnabled,
    setSettingsOpen,
  } = useApp();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [ctxInfo, setCtxInfo] = useState(null);
  const messagesRef = useRef([]);
  const currentIdRef = useRef(currentId);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  currentIdRef.current = currentId;

  /* 切换文件时载入对应聊天记录 */
  useEffect(() => {
    const loaded = currentId ? getChat(currentId) : [];
    messagesRef.current = loaded;
    setMessages(loaded);
    setCtxInfo(null);
  }, [currentId]);

  useEffect(() => {
    if (prefill && prefill.text) setInput(prefill.text);
  }, [prefill]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /**
   * 更新消息列表并持久化。
   * @param {Array<object>} next 新列表
   * @param {boolean} persist 是否写入 localStorage
   * @returns {void}
   */
  const commit = useCallback((next, persist = true) => {
    messagesRef.current = next;
    setMessages(next);
    if (persist && currentIdRef.current) setChat(currentIdRef.current, next);
  }, []);

  /**
   * 发送消息。
   * @returns {Promise<void>} 无返回值
   */
  const send = async () => {
    const question = input.trim();
    if (!question || sending || !aiEnabled) return;

    setInput('');
    setSending(true);

    const history = messagesRef.current
      .filter((m) => m && m.content)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    const userMsg = { id: mid(), role: 'user', content: question, createdAt: Date.now() };
    commit([...messagesRef.current, userMsg]);

    const assistantId = mid();
    commit([...messagesRef.current, { id: assistantId, role: 'assistant', content: '' }], false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const hits = await searchBook(question, { maxHits: 5, maxPages: 260 });
      setCtxInfo({
        selection: Boolean(selection?.text),
        page: Boolean(pageContent.text),
        hits: hits.length,
      });

      const built = buildChatMessages({
        question,
        selection: selection?.text || '',
        pageText: pageContent.text || '',
        bookHits: hits,
        targetLang: settings.targetLang,
        bookTitle: currentMeta?.name || '',
      });

      const payload = [built[0], ...history, built[1]];

      const onDelta = (delta) => {
        const list = messagesRef.current.slice();
        const last = list[list.length - 1];
        if (last && last.id === assistantId) {
          last.content += delta;
          commit(list, false);
        }
      };

      const answer = await chatStream(payload, {
        onDelta,
        signal: controller.signal,
        settings,
        temperature: 0.3,
      });

      const finalList = messagesRef.current.slice();
      const lastMsg = finalList[finalList.length - 1];
      if (lastMsg && lastMsg.id === assistantId) {
        lastMsg.content = answer || lastMsg.content || '（模型未返回内容）';
      }
      commit(finalList);
    } catch (err) {
      const list = messagesRef.current.slice();
      const lastMsg = list[list.length - 1];
      const message =
        err && err.name === 'AbortError' ? '（已取消）' : String(err?.message || err || '请求失败');
      if (lastMsg && lastMsg.id === assistantId) {
        lastMsg.content = message;
        lastMsg.error = message !== '（已取消）';
      }
      commit(list);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  if (!aiEnabled) return <AiGuide />;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-slate-100 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>上下文：</span>
          <span
            className={`chip ${selection?.text ? 'bg-brand-50 text-brand-700' : 'text-slate-400'}`}
          >
            ① 选中文本
          </span>
          <span className={`chip ${pageContent.text ? 'bg-brand-50 text-brand-700' : 'text-slate-400'}`}>
            ② 第 {page} 页
          </span>
          <span className={`chip ${ctxInfo?.hits ? 'bg-brand-50 text-brand-700' : 'text-slate-400'}`}>
            ③ 整本{ctxInfo?.hits ? ` ${ctxInfo.hits} 处命中` : '检索'}
          </span>
          <button
            type="button"
            className="ml-auto btn-ghost px-2 text-xs"
            onClick={() => setSettingsOpen(true)}
          >
            模型：{settings.model || '未设置'}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {!messages.length ? (
          <div className="py-8 text-center">
            <div className="text-sm font-medium text-slate-700">有什么不懂的，直接问</div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              优先基于你选中的文本回答；没有选中则看当前页；<br />
              还没有答案时会到整本书里检索相关片段。
            </p>
          </div>
        ) : null}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 ${
                msg.role === 'user'
                  ? 'bg-brand-500 text-white'
                  : msg.error
                    ? 'border border-rose-200 bg-rose-50 text-rose-600'
                    : 'border border-slate-100 bg-white text-slate-800'
              }`}
            >
              {msg.content ? (
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                  思考中…
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        {selection?.text ? (
          <div className="mb-2 truncate rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs text-brand-700">
            已附带选中文本：{selection.text.slice(0, 60)}
            {selection.text.length > 60 ? '…' : ''}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            className="field-input resize-none"
          />
          {sending ? (
            <button
              type="button"
              className="btn shrink-0 px-3 py-2"
              onClick={() => abortRef.current?.abort()}
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary shrink-0 px-4 py-2"
              onClick={send}
              disabled={!input.trim()}
            >
              发送
            </button>
          )}
        </div>
        {sending ? (
          <Loader className="mt-1.5 justify-start" text="AI 正在回答…" size="sm" />
        ) : null}
        {messages.length ? (
          <button
            type="button"
            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
            onClick={() => {
              commit([]);
              setCtxInfo(null);
            }}
          >
            清空对话
          </button>
        ) : null}
      </div>
    </div>
  );
}
