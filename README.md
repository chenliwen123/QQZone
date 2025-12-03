
# auto-qzone-stable

稳定版 QQ 空间自动留言脚本（GitHub Actions）

## 特点
- 多接口尝试（legacy / new）
- Cookie 有效性检测
- 失败时推送钉钉通知
- 支持本地消息池（content/messages.txt / content/templates.json）
- 无外部依赖，Node.js 18 可直接运行

## 文件结构
```
auto-qzone-stable/
├─ index.js
├─ scripts/dingtalk.js
├─ package.json
├─ content/
│   ├ messages.txt
│   └ templates.json
└─ .github/workflows/auto.yml
```

## 环境变量（必须）
- `QQ_COOKIE` - 完整单行 Cookie 字符串（不要换行）
- `TARGET_UIN` - 目标 QQ 空间（目标 QQ 号）

可选：
- `QQ_UIN` - 你的 QQ 号（不必填写，脚本会从 cookie 自动解析）
- `DINGTALK_WEBHOOK` - 钉钉机器人 webhook（用于失败/成功通知）
- `DINGTALK_KEYWORDS` - 通知前缀（默认：`QQ空间通知`）
- `CHECK_ONLY` - 若设置，脚本只检查 cookie 是否有效并退出（用于调试）
- `OFFLINE` - 若设置，从本地 content/messages.txt 或 templates.json 中读取留言

## 使用方法（本地）
1. 创建 `content/messages.txt` (可选)，每行一句留言
2. 创建 `content/templates.json` (可选)，json 数组，支持模板变量 `{yyyy},{mm},{dd},{HH},{MM},{ss},{w}`
3. 设置环境变量后运行：

```bash
QQ_COOKIE="p_skey=...; p_uin=o12345; uin=o12345; skey=..." TARGET_UIN=123456 node index.js
```

## 在 GitHub Actions 上运行
1. 将仓库上传到 GitHub
2. 在仓库 Settings -> Secrets -> Actions 中添加：`QQ_COOKIE`, `TARGET_UIN`, `DINGTALK_WEBHOOK`（可选）等
3. Action 会每天按计划运行

## 说明与注意事项
- Cookie 必须包含 `p_skey` 与 `p_uin`，否则无法对留言接口进行授权
- p_skey 与 pt4_token 等字段通常会在数日后过期，需要在 Cookie 失效时重新抓取
- 若需要「自动刷新 Cookie（扫码/模拟登录）」或更复杂的轮换策略，可联系作者扩展

