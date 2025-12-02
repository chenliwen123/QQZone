# Cookie过期处理方案

**目标**
- 明确 QQ 空间留言所需 Cookie 的组成与失效表现
- 提供本地与 GitHub Actions 的刷新与回滚流程
- 给出检测与告警建议，降低任务中断概率

**Cookie要点**
- 关键字段：`p_skey`（计算 `g_tk`）、`skey`、`uin/p_uin`
- 失效周期：不固定，常见为数天至一周；任何重新登录或安全策略变化都会导致旧 Cookie 失效
- 存储位置：
  - 本地：`.env` 中的 `QQ_COOKIE`
  - 云端：仓库 `Secrets → QQ_COOKIE`

**失效表现**
- 接口返回 HTML 带 JSON 回调，`code/subcode` 非零或出现“请先登录”等提示
- 返回“bad request”或业务错误码（如权限限制）
- 依然是 `200 OK`，但正文提示失败（因此仅凭状态码不足，需要解析响应内容）

**检测策略**
- 运行时检测（推荐）：在发送留言后解析响应内容，若 `code != 0` 或 `subcode != 0`，判定 Cookie 失效，打印明确日志关键字（如 `COOKIE_EXPIRED`），并以非零退出码结束以触发 Actions 告警
- 轻量健康检查（可选）：每日先调用留言板查询接口 `get_msgb`（返回较快、只读），如果返回失败或要求登录，则跳过当日留言并告警
- 本地预检：运行前检查 `.env` 中是否含 `p_skey`，长度是否合理；空值直接阻止运行并打印引导

**本地刷新流程**
- 在浏览器登录 QQ 空间后，复制最新完整 `Cookie`
- 打开项目根目录 `.env`，更新 `QQ_COOKIE=` 的值
- 本地验证：
  - 正常运行：`npm run qzone`
  - 仅查看生成文案（不发送）：设置 `DRY_RUN=1`（如需此能力，可增设脚本开关）

**GitHub Actions刷新流程**
- 进入仓库 `Settings → Secrets and variables → Actions`
- 更新 `QQ_COOKIE` 的值为最新 Cookie；其他变量无需变更
- 在 `Actions` 页面手动触发一次工作流，查看日志是否包含“留言成功”，确认恢复

**告警与回滚建议**
- 利用 GitHub Actions 的失败通知：当脚本以非零退出码结束，GitHub 会自动在你的通知渠道提示失败
- 在日志中输出明确标识：如 `COOKIE_EXPIRED`、`MISSING_P_SKEY`，便于快速定位
- 重试策略：工作流中已设置 3 次重试（每次间隔 5 秒），主要应对临时网络问题；Cookie 失效不会因重试修复

**安全与合规**
- Cookie 仅存放在 `.env` 与 GitHub Secrets，不要提交到仓库或打印到日志
- 避免将 Cookie 透传到第三方接口；脚本仅用其生成 `g_tk` 与请求头

**维护建议**
- 周期性刷新：建议每 7～14 天手动更新一次 Cookie（视你的使用情况与失效频率而定）
- 变更记录：每次刷新后在提交信息里标注“更新 Secrets: QQ_COOKIE”，便于团队协作时追踪
- 版本锁定：保留当前可用脚本版本，遇到失效时优先更新 Cookie 而非改动脚本逻辑

**可选增强（如需我可代为实现）**
- 失效检测落地：在 `scripts/qzone_msg.js` 中增加响应解析，检测 `code/subcode` 非零时打印 `COOKIE_EXPIRED` 并退出
- DRY_RUN 模式：支持 `DRY_RUN=1` 时只生成文案并输出，不发请求，便于核验内容来源（接口或本地）
- 多源文案轮询：配置多个在线文案源并带失败回退与短期去重缓存

**故障排查速查**
- 403 或负数错误码：Cookie 失效或 `g_tk` 计算错误，重新复制 Cookie
- 权限错误：目标空间留言权限受限，换目标或调整权限
- 日志显示“未能解析 p_skey/skey”：从 Cookie 中缺失关键字段，需重新获取

**钉钉机器人告警方案**
- 目的：当判断 Cookie 失效时，立刻向你的钉钉群机器人发送提醒
- 判断条件：解析留言接口响应中的 JSON，若 `code != 0` 或 `subcode != 0` 则判定失效

**环境变量/Secrets**
- `DINGTALK_WEBHOOK`: 钉钉机器人 Webhook（必填）
- `DINGTALK_SECRET`: 机器人安全签名 Secret（开启“加签”时必填）

**实现步骤**
- 响应解析：QQ 空间返回的是 HTML 包裹的 `frameElement.callback(<JSON>)`，可通过正则提取括号内的 JSON 字符串并解析
- 失败时调用钉钉接口：向 `DINGTALK_WEBHOOK` 发送 `POST` 请求，消息类型为 `text`
- Node 代码片段（示例）：
```
// 从响应中提取 JSON（伪代码）
const m = html.match(/frameElement\.callback\((\{[\s\S]*?\})\)/);
const result = m ? JSON.parse(m[1]) : null;
if (!result || result.code !== 0 || result.subcode !== 0) {
  await notifyDingTalk(`[COOKIE_EXPIRED] uin=${qqUin} hostUin=${hostUin} code=${result?.code} sub=${result?.subcode}`);
  process.exit(1);
}

// 发送钉钉通知
const https = require('https');
const crypto = require('crypto');
async function notifyDingTalk(text) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET;
  let url = webhook;
  if (secret) {
    const ts = Date.now();
    const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
    url += `&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  }
  const body = JSON.stringify({ msgtype: 'text', text: { content: text } });
  await new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      res.on('data', () => {}); res.on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
```

**GitHub Actions集成**
- 在仓库 Secrets 添加：`DINGTALK_WEBHOOK`、`DINGTALK_SECRET`
- 工作流 `.github/workflows/qqzone.yml` 的 `Run` 步骤中通过 `env:` 注入上述变量
- 运行失败将触发钉钉通知和 GitHub 失败提醒双通道告警

**本地验证**
- 在 PowerShell 设置：
```
$env:DINGTALK_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=...'
$env:DINGTALK_SECRET  = '<可选的加签secret>'
```
- 模拟失效：暂时把 `.env` 中的 `QQ_COOKIE` 改为不含 `p_skey` 的值，运行 `npm run qzone`，应收到钉钉提醒

**注意事项**
- 控制消息频率：避免频繁失败导致刷屏；可在通知文本中加入执行时间、运行环境（本地/Actions）与日志定位指引
- 隐私安全：Webhook 与 Secret 必须通过 `.env` 或 Secrets 注入，避免写入代码或日志
