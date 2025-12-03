
/**
 * Stable auto QZone message sender (CommonJS)
 * - retries on transient errors
 * - tries multiple endpoints (legacy/new)
 * - cookie expiry detection and DingTalk notification
 * - message source: content/messages.txt -> content/templates.json -> hitokoto fallback
 *
 * Environment variables (required):
 *   QQ_COOKIE     - full cookie string (single-line)
 *   TARGET_UIN    - target QQ space (the QQ number to post to)
 *
 * Optional:
 *   QQ_UIN        - your own QQ number (will be inferred from cookie if missing)
 *   DINGTALK_WEBHOOK - ding talk robot webhook url for failure notifications
 *   DINGTALK_KEYWORDS - optional prefix for ding message
 *   CHECK_ONLY    - if set, only check cookie validity then exit
 *   OFFLINE       - if set, use local messages only
 */

const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const dingtalk = require('./scripts/dingtalk');

function calcGtk(p_skey) {
  let h = 5381;
  for (let i = 0; i < p_skey.length; i++) {
    h = (h << 5) + h + p_skey.charCodeAt(i);
  }
  return h & 0x7fffffff;
}

function parseCookieValue(cookie, keys) {
  if (!cookie) return '';
  const parts = cookie.split(';').map(s => s.trim());
  for (const k of keys) {
    for (const p of parts) {
      if (p.startsWith(k + '=')) return p.substring(k.length + 1);
    }
  }
  return '';
}

function parseCookieByRegex(cookie, key) {
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)'));
  return m ? m[1] : '';
}

const cookie = process.env.QQ_COOKIE || process.env.QZONE_COOKIE;
const hostUin = process.env.TARGET_UIN;
let qqUin = process.env.QQ_UIN;

if (!cookie || !hostUin) {
  console.error('Missing required environment variables QQ_COOKIE and TARGET_UIN.');
  console.error('Example .env:');
  console.error('QQ_COOKIE=\"p_skey=...; p_uin=o12345; uin=o12345; skey=...;\"');
  console.error('TARGET_UIN=123456789');
  process.exit(1);
}

if (!qqUin) qqUin = (parseCookieValue(cookie, ['uin','p_uin']) || '').replace(/^o/, '');

const has = k => new RegExp('(?:^|;\\s*)' + k + '=').test(cookie);

let skey = parseCookieValue(cookie, ['p_skey']);
if (!skey) skey = parseCookieByRegex(cookie, 'p_skey');
if (!skey) skey = parseCookieValue(cookie, ['skey']);
if (!skey) skey = parseCookieByRegex(cookie, 'skey');

if (!skey) {
  console.error('Cannot extract p_skey/skey from cookie');
  process.exit(1);
}

const gtk = calcGtk(skey);

console.log(`[env] uin=${qqUin} hostUin=${hostUin} cookie.len=${(cookie||'').length} has_uin=${has('uin')} has_p_uin=${has('p_uin')} has_p_skey=${has('p_skey')} has_skey=${has('skey')} gtk=${gtk}`);

// message selection
function readLocalMessage() {
  const base = path.join(process.cwd(), 'content');
  const txt = path.join(base, 'messages.txt');
  const jsonf = path.join(base, 'templates.json');
  const now = new Date();
  const weekday = '日一二三四五六'[now.getDay()];
  const pad = n => String(n).padStart(2, '0');
  const ctx = { yyyy: now.getFullYear(), mm: pad(now.getMonth()+1), dd: pad(now.getDate()), HH: pad(now.getHours()), MM: pad(now.getMinutes()), ss: pad(now.getSeconds()), w: weekday };
  if (fs.existsSync(txt)) {
    const lines = fs.readFileSync(txt,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (lines.length) return lines[Math.floor(Math.random()*lines.length)].replace(/\{(yyyy|mm|dd|HH|MM|ss|w)\}/g, (_,k)=>ctx[k]);
  }
  if (fs.existsSync(jsonf)) {
    try {
      const list = JSON.parse(fs.readFileSync(jsonf,'utf8'));
      if (Array.isArray(list) && list.length) {
        const tpl = list[Math.floor(Math.random()*list.length)];
        return String(tpl).replace(/\{(yyyy|mm|dd|HH|MM|ss|w)\}/g, (_,k)=>ctx[k]);
      }
    } catch(e) {}
  }
  return `早安~ 今天是${ctx.yyyy}-${ctx.mm}-${ctx.dd} 星期${ctx.w}`;
}

function fetchOnlineMessage() {
  return new Promise((resolve) => {
    const url = 'https://v1.hitokoto.cn/?encode=json';
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j && j.hitokoto) {
            const a = j.from_who ? String(j.from_who).trim() : '';
            const s = j.from ? String(j.from).trim() : '';
            let suffix = '';
            if (a && s) suffix = ` —— ${a} · ${s}`;
            else if (a) suffix = ` —— ${a}`;
            else if (s) suffix = ` —— ${s}`;
            resolve(`${j.hitokoto}${suffix}`);
            return;
          }
        } catch(e) {}
        resolve('');
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); resolve(''); });
  });
}

function buildPostData(content) {
  const payload = {
    uin: qqUin,
    hostUin: hostUin,
    content: content,
    format: 'json',
    g_tk: gtk,
  };
  return querystring.stringify(payload);
}

function buildOptions(contentLength) {
  return {
    hostname: 'h5.qzone.qq.com',
    path: `/proxy/domain/m.qzone.qq.com/cgi-bin/new_msgboard/msg_add`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': contentLength,
      'Cookie': cookie,
      'Origin': 'https://h5.qzone.qq.com',
      'Referer': `https://user.qzone.qq.com/${hostUin}`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': 'Mozilla/5.0',
    },
  };
}

function buildLegacyPostData(content) {
  const payload = {
    content: content,
    hostUin: hostUin,
    uin: qqUin,
    format: 'fs',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    iNotice: 1,
    ref: 'qzone',
    json: 1,
    g_tk: gtk,
    qzreferrer: 'https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/msgboard/msgbcanvas.html#page=1',
  };
  return querystring.stringify(payload);
}

function buildLegacyOptions(contentLength) {
  return {
    hostname: 'h5.qzone.qq.com',
    path: `/proxy/domain/m.qzone.qq.com/cgi-bin/new/add_msgb?g_tk=${gtk}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': contentLength,
      'Cookie': cookie,
      'Origin': 'https://h5.qzone.qq.com',
      'Referer': 'https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/msgboard/msgbcanvas.html#page=1',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
  };
}

function buildUserProxyLegacyOptions(contentLength) {
  return {
    hostname: 'user.qzone.qq.com',
    path: `/proxy/domain/m.qzone.qq.com/cgi-bin/new/add_msgb?g_tk=${gtk}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': contentLength,
      'Cookie': cookie,
      'Origin': 'https://user.qzone.qq.com',
      'Referer': 'https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/msgboard/msgbcanvas.html#page=1',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
  };
}

function sendQzone(options, body, label, msg) {
  console.log(`[REQ](${label}) host=${options.hostname} path=${options.path} gtk=${gtk} msg.len=${msg.length} body.len=${Buffer.byteLength(body)}`);
  return new Promise((resolve) => {
    const req = https.request(options, res => {
      let data = '';
      console.log(`[RESP_HDR](${label}) status=${res.statusCode} type=${res.headers['content-type']||''} location=${res.headers['location']||''}`);
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const head = String(data).slice(0, 240).replace(/\s+/g,' ').trim();
        console.log(`[RESP_HEAD](${label}) ${head}`);
        const is2xx = res.statusCode >= 200 && res.statusCode < 300;
        function extractJson(s) {
          const patterns = [
            /frameElement\.callback\((\{[\s\S]*?\})\)/,
            /callback\((\{[\s\S]*?\})\)/,
            /\((\{[\s\S]*?\})\)/,
          ];
          for (const re of patterns) {
            const mm = s.match(re);
            if (mm) {
              try { return JSON.parse(mm[1]); } catch(e) {}
            }
          }
          try { return JSON.parse(s); } catch(e) {}
          return null;
        }
        function extractCodes(s) {
          let code = 'NA', sub = 'NA';
          const mc = s.match(/"code"\s*:\s*(-?\d+)/i) || s.match(/\bcode\b\s*[:=]\s*(-?\d+)/i);
          const ms = s.match(/"subcode"\s*:\s*(-?\d+)/i) || s.match(/\bsubcode\b\s*[:=]\s*(-?\d+)/i);
          if (mc) code = mc[1];
          if (ms) sub = ms[1];
          return { code, sub };
        }
        const result = extractJson(data);
        const { code: codeTxt, sub: subTxt } = extractCodes(data);
        const code = result ? (result.code ?? result.ret ?? result.result ?? codeTxt) : codeTxt;
        const sub = result ? (result.subcode ?? result.sub ?? subTxt) : subTxt;
        console.log(`[RESP_PARSE](${label}) code=${code} sub=${sub}`);
        const successByText = /留言成功|success|succ/i.test(data);
        const successByJson = !!(result && (result.code === 0 || result.subcode === 0 || result.ret === 0 || result.result === 0));
        if (is2xx && (successByJson || successByText)) {
          console.log('[SEND_OK]');
          resolve({ ok: true, data, code, sub });
        } else {
          resolve({ ok: false, data, code, sub });
        }
      });
    });
    req.on('error', err => { console.error(`[REQ_ERR](${label})`, String(err)); resolve({ ok:false, err: String(err) }); });
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); resolve({ ok:false, err: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

async function checkCookieOnce() {
  return new Promise((resolve) => {
    const s = Math.random();
    const params = querystring.stringify({ uin: qqUin, hostUin: hostUin, start: 0, s, format: 'jsonp', num: 1, inCharset: 'utf-8', outCharset: 'utf-8', g_tk: gtk });
    const path = `/proxy/domain/m.qzone.qq.com/cgi-bin/new/get_msgb?${params}`;
    const options = { hostname: 'h5.qzone.qq.com', path, method: 'GET', headers: { 'Cookie': cookie, 'Referer': `https://user.qzone.qq.com/${hostUin}`, 'User-Agent': 'Mozilla/5.0' } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        const is2xx = res.statusCode >=200 && res.statusCode < 300;
        const m = data.match(/frameElement\.callback\((\{[\s\S]*?\})\)/) || data.match(/\((\{[\s\S]*?\})\)/);
        let result = null;
        try { if (m) result = JSON.parse(m[1]); } catch(e) {}
        const ok = is2xx && result && (result.code === 0 || result.ret === 0);
        resolve(!!ok);
      });
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function main() {
  if (process.env.CHECK_ONLY) {
    const ok = await checkCookieOnce();
    if (ok) { console.log('[COOKIE_OK]'); process.exit(0); }
    console.error('[COOKIE_EXPIRED]'); process.exit(1);
  }

  const msg = process.env.OFFLINE ? readLocalMessage() : (await fetchOnlineMessage() || readLocalMessage());

  const legacyBody = buildLegacyPostData(msg);
  const legacyOptH5 = buildLegacyOptions(Buffer.byteLength(legacyBody));
  const legacyOptUser = buildUserProxyLegacyOptions(Buffer.byteLength(legacyBody));

  // Try user proxy legacy first
  try {
    const respUser = await sendQzone(legacyOptUser, legacyBody, 'add_msgb_user', msg);
    if (respUser.ok) { await notifySuccess(msg); process.exit(0); }
  } catch(e){}

  // Try legacy h5
  try {
    const respH5 = await sendQzone(legacyOptH5, legacyBody, 'add_msgb_h5', msg);
    if (respH5.ok) { await notifySuccess(msg); process.exit(0); }
  } catch(e){}

  // Try new API
  const postData = buildPostData(msg);
  const options = buildOptions(Buffer.byteLength(postData));

  const resp = await sendQzone(options, postData, 'msg_add', msg);
  if (resp.ok) { await notifySuccess(msg); process.exit(0); }

  // If we reach here, all attempts failed. Determine reason and notify.
  console.error('[ALL_ATTEMPTS_FAILED]');
  const reason = resp && resp.data ? resp.data.slice(0,800) : 'no-response';
  await notifyFailure(reason);
  process.exit(1);
}

async function notifyFailure(reason) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const kw = process.env.DINGTALK_KEYWORDS || 'QQ空间通知';
  if (webhook) {
    const text = `${kw}: QQ空间留言失败，目标:${hostUin}，原因（节选）:${String(reason).slice(0,600)}`;
    try { await dingtalk.sendText(webhook, text); console.log('[NOTIFIED]'); } catch(e){ console.error('[NOTIFY_ERR]', String(e)); }
  } else {
    console.error('[NO_WEBHOOK] DingTalk webhook not configured.');
  }
}

async function notifySuccess(msg) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const kw = process.env.DINGTALK_KEYWORDS || 'QQ空间通知';
  if (webhook) {
    const text = `${kw}: 成功在 ${hostUin} 留言，内容：${String(msg).slice(0,200)}`;
    try { await dingtalk.sendText(webhook, text); console.log('[NOTIFIED_OK]'); } catch(e){ console.error('[NOTIFY_ERR]', String(e)); }
  }
}

// run main
main().catch(async (e) => {
  console.error('[FATAL]', String(e));
  await notifyFailure(String(e));
  process.exit(1);
});
