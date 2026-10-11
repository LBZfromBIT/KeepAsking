# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

## [0.1.0] - 2026-10-11

### 新增
- Electron 桌面应用（Windows / macOS / Linux），React + Vite + TypeScript 渲染进程。
- 划词展开分支：选中任意消息中的文字即可开启分支对话，支持附带追问、多层嵌套。
- 原文中的分支片段高亮，可点击跳转；分支内可「返回原文」并定位高亮。
- 右侧实时对话树（SVG），高亮当前节点与路径，流式生成中节点有指示。
- BYOK：OpenAI 兼容 `/chat/completions` 与 Anthropic `/messages`，均为流式；请求由主进程发出（无 CORS 限制）。
- API Key 通过 Electron `safeStorage` 加密保存，渲染进程永远拿不到明文 Key。
- 对话数据保存在用户数据目录的 `data.json`；支持通过系统对话框导出 / 导入 JSON。
- 安全默认：`contextIsolation`、`sandbox`、禁用 `nodeIntegration`、严格 CSP、外部链接用系统浏览器打开。
- GitHub Actions：CI（类型检查 / 单元测试 / 构建 / E2E）与打 tag 自动发布。
