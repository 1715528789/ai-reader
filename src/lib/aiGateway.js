/**
 * AI Gateway：统一模型适配层。
 * - 对外只有一个出口 chat(messages, {onDelta, signal})，翻译/解读/划词解释/问答全部复用
 * - 支持 OpenAI / Gemini / Claude / 自定义 OpenAI 兼容 API
 * - 默认 SSE 流式输出，流式失败自动降级为非流式
 * - 翻译/解读/解释要求模型返回严格 JSON，前端用 extractJson() 容错解析
 */
import { getSettings } from './storage';

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  targetLang: 'zh-CN',
  /** 扫描页（无文本层）处理：auto=自动用视觉模型识别，off=关闭 */
  scanMode: 'auto',
  /** 视觉模型名（留空则用上面的模型；用于主模型不支持图片输入时单独指定） */
  visionModel: '',
};

/** 各服务商预设 */
export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    placeholderModel: 'gpt-4o-mini / gpt-4o',
    keyHint: 'sk-...',
  },
  gemini: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    placeholderModel: 'gemini-2.0-flash',
    keyHint: 'AIza...',
  },
  claude: {
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    placeholderModel: 'claude-3-5-sonnet-latest',
    keyHint: 'sk-ant-...',
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    defaultBaseUrl: 'https://your-endpoint/v1',
    defaultModel: 'your-model',
    placeholderModel: 'qwen2.5-72b-instruct 等',
    keyHint: 'your-api-key',
  },
};

/** 下拉列表顺序 */
export const PROVIDER_LIST = [
  { value: 'openai', label: PROVIDERS.openai.label },
  { value: 'gemini', label: PROVIDERS.gemini.label },
  { value: 'claude', label: PROVIDERS.claude.label },
  { value: 'custom', label: PROVIDERS.custom.label },
];

/** 目标语言选项 */
export const LANG_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
];

/**
 * 把语言代码转成提示词中的自然语言名。
 * @param {string} code 语言代码
 * @returns {string} 语言名
 */
export function langName(code) {
  const hit = LANG_OPTIONS.find((item) => item.value === code);
  return hit ? hit.label : '简体中文';
}

/**
 * 合并默认设置。
 * @param {object|null} settings 已存设置
 * @returns {object} 合并后的设置
 */
export function normalizeSettings(settings) {
  const base = { ...DEFAULT_SETTINGS };
  if (!settings || typeof settings !== 'object') return base;
  const merged = { ...base, ...settings };
  if (!merged.baseUrl) {
    merged.baseUrl = PROVIDERS[merged.provider]?.defaultBaseUrl || '';
  }
  return merged;
}

/**
 * 读取当前设置（含默认值补全）。
 * @returns {object} 设置对象
 */
export function loadSettings() {
  return normalizeSettings(getSettings());
}

/**
 * 判断模型是否已配置（只需要 API Key；model 会被 normalizeSettings 兜底，故不再校验）。
 * @param {object} settings 设置对象
 * @returns {boolean} 是否可用
 */
export function isConfigured(settings) {
  const s = normalizeSettings(settings);
  return Boolean(String(s.apiKey || '').trim());
}

/**
 * 去掉 URL 结尾的斜杠。
 * @param {string} url 原始地址
 * @returns {string} 规范化地址
 */
function normalizeBase(url = '') {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 读取 HTTP 错误详情。
 * @param {Response} response fetch 响应
 * @returns {Promise<string>} 错误文案
 */
async function readError(response) {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message || json?.message || json?.error || text;
    } catch (err) {
      detail = text;
    }
  } catch (err) {
    detail = '';
  }
  if (typeof detail !== 'string') detail = JSON.stringify(detail);
  return `AI 请求失败（HTTP ${response.status}）：${detail.slice(0, 400) || response.statusText}`;
}

/**
 * 消费 SSE 流，把每个 data 事件交给回调。
 * @param {Response} response fetch 响应
 * @param {(payload: string) => void} onEvent 事件回调
 * @returns {Promise<void>} 无返回值
 */
async function consumeSSE(response, onEvent) {
  if (!response.body) {
    throw new Error('该环境不支持流式读取（response.body 为空）');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let safelyClosed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload) onEvent(payload);
        }
      }
    }
    if (buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload) onEvent(payload);
      }
    }
    safelyClosed = true;
  } finally {
    if (!safelyClosed) {
      try {
        await reader.cancel();
      } catch (err) {
        /* 忽略 */
      }
    }
  }
}

/**
 * 拆分 system / 非 system 消息。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @returns {{system: string, rest: Array<{role: string, content: string}>}} 拆分结果
 */
function splitSystem(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const system = list
    .filter((m) => m && m.role === 'system')
    .map((m) => String(m.content || ''))
    .join('\n\n');
  const rest = list
    .filter((m) => m && m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }))
    .filter((m) => m.content.length > 0);
  return { system, rest: rest.length ? rest : [{ role: 'user', content: '你好' }] };
}

/**
 * 合并相邻同角色消息（Claude / Gemini 要求 user / assistant 交替）。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @returns {Array<{role: string, content: string}>} 合并结果
 */
function mergeAlternating(messages) {
  const out = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
}

/* ------------------------------- OpenAI 分支 ------------------------------- */

async function chatOpenAI({ settings, messages, onDelta, signal, temperature, maxTokens, stream }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.openai.defaultBaseUrl;
  const url = `${base}/chat/completions`;
  const body = {
    model: settings.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: Boolean(stream),
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));

  if (!stream) {
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (text && onDelta) onDelta(text);
    return text;
  }

  let full = '';
  await consumeSSE(response, (payload) => {
    if (payload === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch (err) {
      return;
    }
    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      full += delta;
      if (onDelta) onDelta(delta);
    }
  });
  return full;
}

/* -------------------------------- Claude 分支 ------------------------------ */

async function chatClaude({ settings, messages, onDelta, signal, temperature, maxTokens, stream }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.claude.defaultBaseUrl;
  const url = `${base}/messages`;
  const { system, rest } = splitSystem(messages);
  const body = {
    model: settings.model,
    max_tokens: maxTokens,
    temperature,
    stream: Boolean(stream),
    messages: mergeAlternating(rest),
  };
  if (system) body.system = system;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));

  if (!stream) {
    const data = await response.json();
    const parts = Array.isArray(data?.content) ? data.content : [];
    const text = parts
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text)
      .join('');
    if (text && onDelta) onDelta(text);
    return text;
  }

  let full = '';
  await consumeSSE(response, (payload) => {
    let json;
    try {
      json = JSON.parse(payload);
    } catch (err) {
      return;
    }
    if (json?.type === 'content_block_delta' && typeof json?.delta?.text === 'string') {
      full += json.delta.text;
      if (onDelta) onDelta(json.delta.text);
    } else if (json?.type === 'error') {
      throw new Error(json?.error?.message || 'Claude 流式返回错误');
    }
  });
  return full;
}

/* -------------------------------- Gemini 分支 ------------------------------ */

async function chatGemini({ settings, messages, onDelta, signal, temperature, maxTokens, stream }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.gemini.defaultBaseUrl;
  const model = encodeURIComponent(settings.model);
  const useStream = Boolean(stream);
  const suffix = useStream ? `streamGenerateContent?alt=sse&key=` : `generateContent?key=`;
  const url = `${base}/models/${model}:${suffix}${encodeURIComponent(settings.apiKey)}`;

  const { system, rest } = splitSystem(messages);
  const contents = mergeAlternating(rest).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));

  if (!useStream) {
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p) => p && typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
    if (text && onDelta) onDelta(text);
    return text;
  }

  let full = '';
  await consumeSSE(response, (payload) => {
    let json;
    try {
      json = JSON.parse(payload);
    } catch (err) {
      return;
    }
    const parts = json?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part && typeof part.text === 'string' && !part.thought) {
        full += part.text;
        if (onDelta) onDelta(part.text);
      }
    }
  });
  return full;
}

/* ------------------------------ 统一出口：chat ----------------------------- */

/**
 * 统一聊天出口（支持流式）。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @param {object} options 选项
 * @param {(delta: string) => void} [options.onDelta] 流式增量回调
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {number} [options.temperature] 温度
 * @param {number} [options.maxTokens] 最大 token
 * @param {boolean} [options.stream] 是否流式（默认 true）
 * @param {object} [options.settings] 模型设置（默认读取 localStorage）
 * @returns {Promise<string>} 完整回答
 */
export async function chat(messages, options = {}) {
  const {
    onDelta,
    signal,
    temperature = 0.3,
    maxTokens = 2048,
    stream = true,
    settings: inputSettings,
  } = options;

  const settings = normalizeSettings(inputSettings || loadSettings());
  if (!isConfigured(settings)) {
    throw new Error('尚未配置 AI 模型，请先在设置中填写 API Key 与模型名。');
  }

  const provider = settings.provider || 'openai';
  const runner = ({ useStream }) => {
    const args = {
      settings,
      messages,
      onDelta,
      signal,
      temperature,
      maxTokens,
      stream: useStream,
    };
    if (provider === 'gemini') return chatGemini(args);
    if (provider === 'claude') return chatClaude(args);
    return chatOpenAI(args);
  };

  const isAbort = (err) => Boolean(err && err.name === 'AbortError');

  try {
    return await runner({ useStream: stream });
  } catch (err) {
    if (isAbort(err)) throw err;
    if (stream) {
      // 流式失败自动降级为非流式
      try {
        return await runner({ useStream: false });
      } catch (err2) {
        if (isAbort(err2)) throw err2;
        throw new Error(normalizeNetError(err2) || normalizeNetError(err));
      }
    }
    throw new Error(normalizeNetError(err));
  }
}

/**
 * 把网络类错误翻译成中文提示。
 * @param {Error} err 原始错误
 * @returns {string} 错误文案
 */
function normalizeNetError(err) {
  const msg = String(err?.message || err || '未知错误');
  if (/Failed to fetch|NetworkError|Load failed|ERR_FAILED/i.test(msg)) {
    return '网络请求失败：请检查网络、API 地址，或该模型服务是否允许浏览器直连（CORS）。';
  }
  return msg;
}

/**
 * 非流式一次性获取完整回答。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @param {object} options 选项（同 chat）
 * @returns {Promise<string>} 完整回答
 */
export async function chatOnce(messages, options = {}) {
  return chat(messages, { ...options, stream: false });
}

/**
 * 流式对话（语义化别名，供 ChatView 使用）。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @param {object} options 选项（同 chat）
 * @returns {Promise<string>} 完整回答
 */
export async function chatStream(messages, options = {}) {
  return chat(messages, { ...options, stream: true });
}

/* --------------------------- 视觉识别（扫描版 / 图片型 PDF） --------------------------- */

/**
 * OpenAI 兼容分支的图片输入（custom 服务商同样走这里）。
 * @param {object} args 参数
 * @returns {Promise<string>} 模型输出文本
 */
async function visionOpenAI({ settings, messages, image, signal, temperature, maxTokens }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.openai.defaultBaseUrl;
  const { system, rest } = splitSystem(messages);
  const text = rest.map((m) => m.content).join('\n\n');
  const content = [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
  ];
  const body = {
    model: settings.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Claude 分支的图片输入。
 * @param {object} args 参数
 * @returns {Promise<string>} 模型输出文本
 */
async function visionClaude({ settings, messages, image, signal, temperature, maxTokens }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.claude.defaultBaseUrl;
  const { system, rest } = splitSystem(messages);
  const text = rest.map((m) => m.content).join('\n\n');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
    { type: 'text', text },
  ];
  const body = {
    model: settings.model,
    max_tokens: maxTokens,
    temperature,
    stream: false,
    messages: [{ role: 'user', content }],
  };
  if (system) body.system = system;

  const response = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts.filter((p) => p && p.type === 'text').map((p) => p.text).join('');
}

/**
 * Gemini 分支的图片输入。
 * @param {object} args 参数
 * @returns {Promise<string>} 模型输出文本
 */
async function visionGemini({ settings, messages, image, signal, temperature, maxTokens }) {
  const base = normalizeBase(settings.baseUrl) || PROVIDERS.gemini.defaultBaseUrl;
  const model = encodeURIComponent(settings.model);
  const url = `${base}/models/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const { system, rest } = splitSystem(messages);
  const text = rest.map((m) => m.content).join('\n\n');
  const contents = [
    {
      role: 'user',
      parts: [
        { text },
        { inlineData: { mimeType: image.mimeType, data: image.base64 } },
      ],
    },
  ];
  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

/**
 * 把"模型不支持图片"这类错误翻译成中文可行动的提示。
 * @param {Error} err 原始错误
 * @returns {string} 错误文案
 */
function normalizeVisionError(err) {
  const raw = normalizeNetError(err);
  if (/image|vision|multimodal|multi-modal|图片|图像|does not support|invalid_request/i.test(raw)) {
    return `${raw}（扫描页识别需要支持图片输入的模型。若当前模型不支持，可在设置里单独填写「视觉模型名」。）`;
  }
  return raw;
}

/**
 * 视觉请求统一出口（非流式）：把页面截图与提示词一起发给模型。
 * @param {object} options 选项
 * @param {Array<{role: string, content: string}>} options.messages 提示词消息
 * @param {{base64: string, mimeType: string}} options.image 页面截图
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {object} [options.settings] 模型设置
 * @param {number} [options.temperature] 温度
 * @param {number} [options.maxTokens] 最大 token
 * @returns {Promise<string>} 模型输出文本
 */
export async function chatWithImage(options) {
  const {
    messages,
    image,
    signal,
    settings: inputSettings,
    temperature = 0.1,
    maxTokens = 4096,
  } = options;

  const settings = normalizeSettings(inputSettings || loadSettings());
  if (!isConfigured(settings)) {
    throw new Error('尚未配置 AI 模型，请先在设置中填写 API Key 与模型名。');
  }
  if (!image || !image.base64) {
    throw new Error('页面截图生成失败，无法进行视觉识别。');
  }

  // 视觉模型可单独指定；未填写时回落到主模型
  const visionSettings = {
    ...settings,
    model: String(settings.visionModel || '').trim() || settings.model,
  };
  const args = {
    settings: visionSettings,
    messages,
    image,
    signal,
    temperature,
    maxTokens,
  };

  const provider = settings.provider || 'openai';
  try {
    if (provider === 'gemini') return await visionGemini(args);
    if (provider === 'claude') return await visionClaude(args);
    return await visionOpenAI(args);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new Error(normalizeVisionError(err));
  }
}

/* ------------------------------ JSON 容错解析 ------------------------------ */

/**
 * 从模型输出中容错提取 JSON（去围栏、截取首尾花括号、修复尾逗号）。
 * @param {string} text 模型原始输出
 * @returns {object} 解析出的对象
 */
export function extractJson(text) {
  if (!text || !String(text).trim()) {
    throw new Error('AI 返回内容为空');
  }
  let raw = String(text).trim();
  raw = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('AI 返回内容不是合法 JSON');
  }
  let candidate = raw.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const repaired = candidate.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch (err2) {
      throw new Error(`AI 返回 JSON 解析失败：${err2.message}`);
    }
  }
}

/**
 * 请求并解析 JSON（翻译/解读/解释统一走这里）。
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @param {object} options 选项（同 chat）
 * @returns {Promise<object>} 解析结果
 */
export async function requestJson(messages, options = {}) {
  const raw = await chat(messages, { ...options, temperature: options.temperature ?? 0.2 });
  return extractJson(raw);
}

/* ------------------------------- Prompt 构造 ------------------------------- */

const JSON_RULES = [
  '只输出 JSON，不要输出任何解释、不要加 Markdown 代码围栏。',
  'JSON 必须使用双引号，且可以被 JSON.parse 直接解析。',
].join('');

/**
 * 构造翻译请求的 messages。
 * @param {object} params 参数
 * @param {Array<{id: string, text: string}>} params.paragraphs 段落数组
 * @param {string} params.targetLang 目标语言代码
 * @param {string} params.bookTitle 书名（可为空）
 * @returns {Array<{role: string, content: string}>} messages
 */
export function buildTranslateMessages({ paragraphs, targetLang = 'zh-CN', bookTitle = '' }) {
  const lang = langName(targetLang);
  const payload = {
    target_language: lang,
    paragraphs: paragraphs.map((p) => ({ id: p.id, text: p.text })),
  };
  return [
    {
      role: 'system',
      content: [
        '你是资深学术文献翻译助手。',
        bookTitle ? `你正在翻译的书籍/文档标题为《${bookTitle}》。` : '',
        `请把用户给出的每个段落逐段翻译成${lang}。`,
        '要求：忠实原文、术语准确、保留段落编号与专有名词；不要遗漏段落，也不要新增段落。',
        `输出严格 JSON：{"paragraphs":[{"id":"p1","zh":"译文"}]}，id 必须与输入完全一致。`,
        JSON_RULES,
      ]
        .filter(Boolean)
        .join(''),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

/**
 * 构造重点解读请求的 messages。
 * @param {object} params 参数
 * @param {string} params.pageText 当前页文本
 * @param {string} params.targetLang 目标语言代码
 * @param {string} params.bookTitle 书名（可为空）
 * @returns {Array<{role: string, content: string}>} messages
 */
export function buildInsightMessages({ pageText, targetLang = 'zh-CN', bookTitle = '' }) {
  const lang = langName(targetLang);
  return [
    {
      role: 'system',
      content: [
        '你是善于讲解的老师，负责帮读者读懂一页书。',
        bookTitle ? `当前阅读的书籍/文档标题为《${bookTitle}》。` : '',
        `请基于用户给出的“当前页原文”输出${lang}的重点解读，包含：一句话总结、核心观点（2-4 条，每条 title 简短、text 展开说明，并说明“为什么”）、以及一个具体例子。`,
        `输出严格 JSON：{"summary":"...","points":[{"title":"核心观点","text":"..."}],"example":"..."}`,
        JSON_RULES,
      ]
        .filter(Boolean)
        .join(''),
    },
    {
      role: 'user',
      content: `【当前页原文】\n${pageText}`,
    },
  ];
}

/**
 * 构造划词解释请求的 messages。
 * @param {object} params 参数
 * @param {string} params.term 选中的文本
 * @param {string} params.context 上下文（所在段落）
 * @param {string} params.targetLang 目标语言代码
 * @returns {Array<{role: string, content: string}>} messages
 */
export function buildExplainMessages({ term, context = '', targetLang = 'zh-CN' }) {
  const lang = langName(targetLang);
  return [
    {
      role: 'system',
      content: [
        '你是帮助读者理解外文材料的语言与知识助手。',
        `请解释用户选中的文本，输出${lang}。`,
        '字段含义：term=原文术语；zh=中文释义；simple=结合上下文的简单理解（1-2 句）；related=2-4 个相关概念或同/近义词。',
        `输出严格 JSON：{"term":"...","zh":"...","simple":"...","related":["..."]}`,
        JSON_RULES,
      ].join(''),
    },
    {
      role: 'user',
      content: JSON.stringify({ term, context: context.slice(0, 1200) }),
    },
  ];
}

/**
 * 构造问答请求的 messages（三级上下文：选中文本 > 当前页 > 整本检索）。
 * @param {object} params 参数
 * @param {string} params.question 用户问题
 * @param {string} params.selection 当前选中文本（可为空）
 * @param {string} params.pageText 当前页文本
 * @param {Array<{page: number, snippet: string}>} params.bookHits 整本命中片段
 * @param {string} params.targetLang 目标语言代码
 * @param {string} params.bookTitle 书名
 * @returns {Array<{role: string, content: string}>} messages
 */
export function buildChatMessages({
  question,
  selection = '',
  pageText = '',
  bookHits = [],
  targetLang = 'zh-CN',
  bookTitle = '',
}) {
  const lang = langName(targetLang);
  const blocks = [];
  if (selection) {
    blocks.push(`【优先级 1｜用户当前选中的文本】\n${selection.slice(0, 2000)}`);
  }
  if (pageText) {
    blocks.push(`【优先级 2｜当前页原文】\n${pageText.slice(0, 4000)}`);
  }
  if (bookHits && bookHits.length) {
    const text = bookHits
      .map((h) => `- 第 ${h.page} 页：${String(h.snippet).replace(/\s+/g, ' ').slice(0, 320)}`)
      .join('\n');
    blocks.push(`【优先级 3｜整本检索到的相关片段】\n${text}`);
  }
  if (!blocks.length) {
    blocks.push('（当前没有可用上下文，请基于常识作答并说明依据不足。）');
  }

  return [
    {
      role: 'system',
      content: [
        '你是正在陪读者读书的 AI 助教。',
        bookTitle ? `当前阅读的书籍/文档标题为《${bookTitle}》。` : '',
        `请用${lang}作答，简洁、准确、直接回答；引用上下文时请注明“第 N 页”。`,
        '上下文按优先级使用：选中文本 > 当前页 > 整本检索片段。若上下文不足以回答，请明确说明。',
      ]
        .filter(Boolean)
        .join(''),
    },
    {
      role: 'user',
      content: `${blocks.join('\n\n')}\n\n【读者的问题】\n${question}`,
    },
  ];
}

/**
 * 构造扫描页视觉识别的 messages（一次拿到原文 + 译文）。
 * @param {object} params 参数
 * @param {string} params.targetLang 目标语言代码
 * @param {string} params.bookTitle 书名（可为空）
 * @returns {Array<{role: string, content: string}>} messages
 */
export function buildVisionPageMessages({ targetLang = 'zh-CN', bookTitle = '' } = {}) {
  const lang = langName(targetLang);
  return [
    {
      role: 'system',
      content: [
        '你是一个高精度的 OCR + 翻译引擎。用户会给你一张 PDF 页面截图。',
        '这份 PDF 没有文本层（扫描件或图片型 PDF），所以必须靠你识别图中的文字。',
        '请完成两件事：1）完整识别图片里的文字，按原文的自然段落切分；2）把每个段落翻译成' + lang + '。',
        '要求：',
        '- 保留原文语言原样输出，不要改写、不要纠错、不要遗漏；数字、公式、专有名词照抄。',
        '- 按阅读顺序自上而下输出；双栏排版请先左栏后右栏。',
        '- 忽略页眉、页脚、页码、水印等噪声，不要输出它们。',
        '- 如果图片里确实没有任何文字，返回 {"paragraphs":[]}。',
        '输出严格 JSON：{"paragraphs":[{"id":"p1","text":"原文段落","zh":"译文段落"}]}，id 从 p1 起连续编号。',
        JSON_RULES,
      ].join(''),
    },
    {
      role: 'user',
      content: bookTitle
        ? `请识别并翻译这张页面图片（出自《${bookTitle}》）。`
        : '请识别并翻译这张 PDF 页面图片。',
    },
  ];
}

/**
 * 请求视觉识别并解析 JSON。
 * @param {object} params 参数
 * @param {{base64: string, mimeType: string}} params.image 页面截图
 * @param {string} params.targetLang 目标语言
 * @param {string} params.bookTitle 书名
 * @param {object} options 选项（signal / settings）
 * @returns {Promise<object>} 解析结果
 */
export async function requestVisionJson(params, options = {}) {
  const { image, targetLang = 'zh-CN', bookTitle = '' } = params;
  const raw = await chatWithImage({
    messages: buildVisionPageMessages({ targetLang, bookTitle }),
    image,
    signal: options.signal,
    settings: options.settings,
  });
  return extractJson(raw);
}

/**
 * 测试模型连通性。
 * @param {object} settings 设置对象
 * @returns {Promise<{ok: boolean, message: string}>} 测试结果
 */
export async function testConnection(settings) {
  try {
    const text = await chatOnce(
      [{ role: 'user', content: '请只回复两个字：正常' }],
      { settings, maxTokens: 32, temperature: 0 }
    );
    return { ok: true, message: `连接成功：${String(text || '').trim().slice(0, 60) || '正常'}` };
  } catch (err) {
    return { ok: false, message: String(err?.message || err || '连接失败') };
  }
}
