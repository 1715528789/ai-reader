# GitHub 发布清单

本文档记录首次发布到 GitHub 时需要填写的元信息与执行步骤。

## 一、仓库基本信息

**Repository name**

```
ai-reader
```

**Description**（建议直接用这段）

```
把「阅读原文 · 实时翻译 · 重点解读 · AI 问答」放进同一个界面的智能 PDF 阅读器。左读原文，右看翻译，划词即解释。支持扫描版 PDF 视觉识别，纯前端零后端。
```

**Topics**（在仓库首页右侧 ⚙ 里添加）

```
pdf-reader  ai  translation  react  vite  tailwindcss  pdfjs  llm  openai  gemini
claude  rag  ocr  vision  study-tools  chinese
```

## 二、首次推送

在项目根目录 `I:/PDF阅读器` 执行（把 `<你的用户名>` 换成实际值）：

```bash
# 如尚未初始化
git init
git branch -M main

# 首次提交
git add .
git commit -m "feat: AI Read - 智能 PDF 阅读器 MVP"

# 关联远程（先在 GitHub 网页端创建一个空仓库，不要勾选 README/gitignore）
git remote add origin https://github.com/<你的用户名>/ai-reader.git
git push -u origin main
```

> **推送前务必确认** `git status` 里没有 `node_modules/`、`dist/`、以及任何含 API Key 的文件。

## 三、仓库设置建议

| 位置 | 建议 |
|------|------|
| Settings → General → License | 显示 MIT |
| Settings → Pages | 如需在线 Demo，选 `GitHub Actions` 或从 `gh-pages` 分支发布（注意：本项目 `vite.config.js` 已设 `base: './'`，可直接部署到子路径） |
| Settings → Actions | 默认的 CI workflow（`.github/workflows/ci.yml`）会自动跑构建 |
| Issues | 保持开启，欢迎反馈 |

## 四、需要打码 / 移除的内容（检查清单）

- [ ] 源码与文档中没有任何真实 API Key
- [ ] GitHub 用户名、邮箱等个人信息按你的偏好处理（`LICENSE` 中的版权行可改成你的名字）
- [ ] 没有提交受版权保护的 PDF 样本
- [ ] `docs/screenshot.png` 不含个人文件信息（当前截图是干净的首屏）

## 五、可选：在线 Demo 部署

因为是纯静态站点，可直接部署到任意静态托管：

```bash
npm run build
# 把 dist/ 目录上传到 Netlify / Vercel / Cloudflare Pages / GitHub Pages
```

**重要**：部署后访问者仍需**自备 API Key**（在页面右上角设置里填）。请勿在部署环境中内置任何密钥 —— 前端代码是公开的，密钥会立刻泄露。

---

## 附：本项目已包含的发布文件

| 文件 | 用途 |
|------|------|
| `README.md` | 项目主文档（含徽章、截图、功能表、快速开始、配置说明） |
| `LICENSE` | MIT 许可证 |
| `CONTRIBUTING.md` | 贡献指南 |
| `.gitignore` | 已排除 `node_modules`、`dist`、`.env`、密钥类文件 |
| `.github/workflows/ci.yml` | 推送到 `main` / 提 PR 时自动构建校验 |
| `docs/screenshot.png` | README 中引用的界面截图 |
| `启动.bat` | Windows 一键启动脚本 |
