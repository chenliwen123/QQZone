const https = require('https');
const crypto = require('crypto');

function signUrl(webhook, secret) {
  if (!secret) return webhook;
  const ts = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
  const url = `${webhook}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  return url;
}

function postJSON(url, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let resp = '';
      res.on('data', c => (resp += c));
      res.on('end', () => {
        try { resolve(JSON.parse(resp)); } catch { resolve({ statusCode: res.statusCode, body: resp }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getKeywords() {
  const raw = (process.env.DINGTALK_KEYWORDS || process.env.DINGTALK_KEYWORD || '').trim();
  if (!raw) return [''];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function sendMarkdown({ title, text }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) { console.warn('[DINGTALK_DISABLED] webhook not set'); return false; }
  const secret = process.env.DINGTALK_SECRET || '';
  const url = signUrl(webhook, secret);
  const keywords = getKeywords();
  console.log(`[DING_ENV] keywords=${keywords.join('|')} webhook_len=${(process.env.DINGTALK_WEBHOOK||'').length} secret_set=${!!process.env.DINGTALK_SECRET}`);
  for (const kw of keywords) {
    const content = kw ? `${kw} \n${text}` : text;
    const body = { msgtype: 'markdown', markdown: { title, text: content } };
    const res = await postJSON(url, body);
    if (res && res.errcode === 0) { console.log('[DINGTALK_SENT] ok'); return true; }
    console.error('[DINGTALK_FAILED]', typeof res === 'object' ? JSON.stringify(res) : String(res), 'kw=', kw);
    if (!(res && res.errcode === 310000)) return false;
  }
  // all markdown attempts failed with keyword mismatch, try text
  return await sendText({ text, keywords });
}

async function sendText({ text, keywords = getKeywords() }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) return false;
  const secret = process.env.DINGTALK_SECRET || '';
  const url = signUrl(webhook, secret);
  console.log(`[DING_ENV(text)] keywords=${keywords.join('|')} webhook_len=${(process.env.DINGTALK_WEBHOOK||'').length} secret_set=${!!process.env.DINGTALK_SECRET}`);
  for (const kw of keywords) {
    const content = kw ? `${kw} ${text}` : text;
    const body = { msgtype: 'text', text: { content } };
    const res = await postJSON(url, body);
    if (res && res.errcode === 0) { console.log('[DINGTALK_SENT] ok(text)'); return true; }
    console.error('[DINGTALK_FAILED(text)]', typeof res === 'object' ? JSON.stringify(res) : String(res), 'kw=', kw);
    if (!(res && res.errcode === 310000)) return false;
  }
  return false;
}

function formatTime(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function notifyCookieExpired({ uin, hostUin, code, subcode, env = 'local', when = formatTime() }) {
  const title = 'QQZone Cookie 过期告警';
  const md = [
    `### ${title}`,
    '',
    `- 时间：${when}`,
    `- 环境：${env}`,
    `- 自己QQ：${uin}`,
    `- 目标QQ：${hostUin}`,
    `- 返回码：code=${code} subcode=${subcode}`,
    '',
    '请尽快在浏览器登录QQ空间并复制新的 Cookie 到 `.env` 或仓库 Secrets 的 `QQ_COOKIE`。',
  ].join('\n');
  return await sendMarkdown({ title, text: md });
}

module.exports = { notifyCookieExpired };
