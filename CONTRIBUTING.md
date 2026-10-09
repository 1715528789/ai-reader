# 贡献指南

感谢你愿意为 AI Read 出力。

## 开发环境

```bash
git clone <your-repo-url>
cd ai-reader
npm install
npm run dev        # http://localhost:5173
```

要求 Node.js 18+（推荐 20 / 22）。

## 提交前自检

```bash
npm run build      # 必须零错误通过
```

改动 PDF 渲染、段落切分等核心逻辑时，建议手动验证这几条：

- 上传一份**有文本层**的 PDF → 左侧能划词、右侧逐段对照翻译
- 上传一份**扫描件**（无文本层）→ 右侧出现「AI 视觉识别」并给出原文与译文
- 翻页流畅，PDF 立即渲染，AI 结果稍后出现
- 未配置 API Key 时不白屏，PDF 阅读功能照常可用

## 绝对不能提交的内容

- **任何 API Key、Token、密码**。所有密钥只存在于浏览器 `localStorage`，源码里不该出现。
- `node_modules/`、`dist/`（已在 `.gitignore` 中）
- 受版权保护的 PDF 样本文件

如果不小心提交了密钥，请立刻在服务商后台吊销该 Key，并清理 git 历史。

## 代码风格

- 沿用现有风格：函数带 JSDoc 注释，注释与 UI 文案使用中文
- 组件放 `src/components/`，数据逻辑放 `src/lib/`，可复用状态逻辑放 `src/hooks/`
- 不引入重型依赖（如 UI 组件库）—— 项目刻意保持轻量，UI 用 Tailwind 手写
- 新增 AI 能力统一走 `src/lib/aiGateway.js` 出口，不要在组件里直接 `fetch` 模型接口

## 提 PR

1. Fork 并从 `main` 切出分支，命名如 `feat/xxx`、`fix/xxx`
2. 一个 PR 只做一件事，描述里写清楚**改了什么、为什么、怎么验证**
3. 确认 `npm run build` 通过
4. 提 PR 并简述验证步骤

## 报 Bug

请附上：复现步骤、期望行为、实际行为、浏览器版本，以及控制台报错信息。

涉及 PDF 排版问题的，说明该 PDF 是文本型还是扫描型、单栏还是双栏 —— 段落切分对排版敏感。

涉及模型请求失败的，请说明用的是哪家服务商（**不要贴 API Key**）。
