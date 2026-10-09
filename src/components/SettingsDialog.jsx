/**
 * 设置面板：选择 AI 服务商、填写 API Key / Base URL / 模型名、选择目标语言。
 * 配置保存在 localStorage（key: aireader.provider）。
 */
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import {
  PROVIDERS,
  PROVIDER_LIST,
  LANG_OPTIONS,
  normalizeSettings,
  testConnection,
} from '../lib/aiGateway';

/**
 * 设置弹窗。
 * @returns {JSX.Element|null} 弹窗
 */
export default function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, settings, updateSettings } = useApp();
  const [form, setForm] = useState(() => normalizeSettings(settings));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (settingsOpen) {
      setForm(normalizeSettings(settings));
      setResult(null);
    }
  }, [settingsOpen, settings]);

  if (!settingsOpen) return null;

  const preset = PROVIDERS[form.provider] || PROVIDERS.openai;

  const patch = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const switchProvider = (provider) => {
    const next = PROVIDERS[provider] || PROVIDERS.openai;
    setForm((prev) => ({
      ...prev,
      provider,
      baseUrl: next.defaultBaseUrl,
      model: next.defaultModel,
    }));
  };

  const save = () => {
    updateSettings(form);
    setSettingsOpen(false);
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    const res = await testConnection(form);
    setResult(res);
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4">
      <div className="w-full max-w-lg animate-fade-in rounded-2xl bg-white p-5 shadow-pop">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">AI 模型设置</h3>
            <p className="mt-1 text-xs text-slate-500">
              密钥只保存在本机浏览器 localStorage，不会上传任何服务器。
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            onClick={() => setSettingsOpen(false)}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="field-label" htmlFor="ai-provider">
              服务商
            </label>
            <select
              id="ai-provider"
              className="field-input"
              value={form.provider}
              onChange={(event) => switchProvider(event.target.value)}
            >
              {PROVIDER_LIST.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="ai-key">
              API Key
            </label>
            <input
              id="ai-key"
              type="password"
              className="field-input"
              placeholder={preset.keyHint}
              value={form.apiKey}
              onChange={(event) => patch('apiKey', event.target.value)}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="ai-base">
              Base URL
            </label>
            <input
              id="ai-base"
              type="text"
              className="field-input"
              placeholder={preset.defaultBaseUrl}
              value={form.baseUrl}
              onChange={(event) => patch('baseUrl', event.target.value)}
              spellCheck="false"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="ai-model">
              模型名
            </label>
            <input
              id="ai-model"
              type="text"
              className="field-input"
              placeholder={preset.placeholderModel}
              value={form.model}
              onChange={(event) => patch('model', event.target.value)}
              spellCheck="false"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="ai-lang">
              翻译 / 回答语言
            </label>
            <select
              id="ai-lang"
              className="field-input"
              value={form.targetLang}
              onChange={(event) => patch('targetLang', event.target.value)}
            >
              {LANG_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="ai-scan">
              扫描页识别（图片型 PDF）
            </label>
            <select
              id="ai-scan"
              className="field-input"
              value={form.scanMode || 'auto'}
              onChange={(event) => patch('scanMode', event.target.value)}
            >
              <option value="auto">无文本层时自动用视觉模型识别</option>
              <option value="off">关闭（只处理有文本层的页面）</option>
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              扫描件、图片型 PDF 没有文字层，只能让 AI 直接读图。识别结果会缓存，同一页不会重复计费。
            </p>
          </div>

          {form.scanMode !== 'off' ? (
            <div>
              <label className="field-label" htmlFor="ai-vision">
                视觉模型名（可选）
              </label>
              <input
                id="ai-vision"
                type="text"
                className="field-input"
                placeholder="留空则使用上面的模型"
                value={form.visionModel || ''}
                onChange={(event) => patch('visionModel', event.target.value)}
                spellCheck="false"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                只有支持图片输入的模型才能识别扫描页（如 gpt-4o、gemini-2.0-flash、claude-3-5-sonnet、
                qwen-vl-max 等）。若主模型不支持图片，可在这里单独指定一个视觉模型。
              </p>
            </div>
          ) : null}
        </div>

        {result ? (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            {result.message}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" className="btn" onClick={runTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary px-4" onClick={save}>
              保存
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          提示：浏览器会直连模型服务，部分服务商可能受 CORS 限制。若请求失败，可改用支持跨域的
          OpenAI 兼容网关（如自建代理 / 第三方中转）。
        </p>
      </div>
    </div>
  );
}
