try { require('dotenv').config({ override: true }); } catch (_) {}
const https = require('https');
const querystring = require('querystring');
const ding = require('./dingtalk');
const fs = require('fs');
const path = require('path');

function calcGtk(p_skey) {
  let h = 5381;
  for (let i = 0; i < p_skey.length; i++) {
    h = (h << 5) + h + p_skey.charCodeAt(i);
  }
  return h & 0x7fffffff;
}

function parseValue(cookie, keys) {
  const parts = cookie.split(';').map(s => s.trim());
  for (const k of keys) {
    for (const p of parts) {
      if (p.startsWith(k + '=')) return p.split('=', 1)[1];
    }
  }
  return '';
}

function parseByRegex(cookie, key) {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return m ? m[1] : '';
}

const cookie = process.env.QQ_COOKIE;
const hostUin = process.env.TARGET_UIN;
let qqUin = process.env.QQ_UIN;
if (!cookie || !hostUin) {
  console.error('缺少必要环境变量：QQ_COOKIE 或 TARGET_UIN');
  console.error('可在 .env 中设置，例如:\nQQ_COOKIE="<你的完整Cookie>"\nTARGET_UIN="<目标QQ号>"\nMESSAGE="每日自动留言"\nQQ_UIN="<自己QQ号-可选>"');
  process.exit(1);
}

if (!qqUin) qqUin = parseValue(cookie, ['uin', 'p_uin']).replace(/^o/, '');
console.log(`[env] uin=${qqUin} hostUin=${hostUin} cookie.len=${(cookie||'').length} has_p_skey=${/p_skey=/.test(cookie)} has_skey=${/[^p_]skey=/.test(cookie)} ding_kw=${process.env.DINGTALK_KEYWORD||''} ding_kws=${process.env.DINGTALK_KEYWORDS||''}`);
let skey = parseValue(cookie, ['p_skey']);
if (!skey) skey = parseByRegex(cookie, 'p_skey');
if (!skey) skey = parseValue(cookie, ['skey']);
if (!skey) skey = parseByRegex(cookie, 'skey');
if (!skey) {
  console.error('未能从 Cookie 中解析到 p_skey/skey');
  process.exit(1);
}
const gtk = calcGtk(skey);

function readLocalMessage() {
  const base = path.join(process.cwd(), 'content');
  const txt = path.join(base, 'messages.txt');
  const json = path.join(base, 'templates.json');
  const now = new Date();
  const weekday = '日一二三四五六'[now.getDay()];
  const pad = n => String(n).padStart(2, '0');
  const ctx = { yyyy: now.getFullYear(), mm: pad(now.getMonth() + 1), dd: pad(now.getDate()), HH: pad(now.getHours()), MM: pad(now.getMinutes()), ss: pad(now.getSeconds()), w: weekday };
  if (fs.existsSync(txt)) {
    const lines = fs.readFileSync(txt, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length) return lines[Math.floor(Math.random() * lines.length)];
  }
  if (fs.existsSync(json)) {
    try {
      const list = JSON.parse(fs.readFileSync(json, 'utf8'));
      if (Array.isArray(list) && list.length) {
        const tpl = list[Math.floor(Math.random() * list.length)];
        return String(tpl).replace(/\{(yyyy|mm|dd|HH|MM|ss|w)\}/g, (_, k) => ctx[k]);
      }
    } catch {}
  }
  return `早安~ 今天是{yyyy}-{mm}-{dd} 星期{w}`.replace(/\{(yyyy|mm|dd|w)\}/g, k => ctx[k]);
}

function fetchOnlineMessage() {
  return new Promise((resolve) => {
    const url = 'https://v1.hitokoto.cn/?encode=json';
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j && j.hitokoto) {
            const a = j.from_who && String(j.from_who).trim() ? String(j.from_who).trim() : '';
            const s = j.from && String(j.from).trim() ? String(j.from).trim() : '';
            let suffix = '';
            if (a && s) suffix = ` —— ${a} · ${s}`;
            else if (a) suffix = ` —— ${a}`;
            else if (s) suffix = ` —— ${s}`;
            resolve(`${j.hitokoto}${suffix}`);
          } else {
            resolve('');
          }
        } catch (e) {
          resolve('');
        }
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); resolve(''); });
  });
}

function buildPostData(content) {
  return querystring.stringify({
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
  });
}

function buildOptions(contentLength) {
  return {
    hostname: 'h5.qzone.qq.com',
    path: `/proxy/domain/m.qzone.qq.com/cgi-bin/new/add_msgb?g_tk=${gtk}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': contentLength,
      'Cookie': cookie,
      'Origin': 'https://user.qzone.qq.com',
      'Referer': `https://user.qzone.qq.com/${hostUin}`,
      'User-Agent': 'Mozilla/5.0',
    },
  };
}

async function main() {
  if (process.env.CHECK_ONLY) {
    await checkCookie();
    return;
  }
  const msg = process.env.OFFLINE ? readLocalMessage() : (await fetchOnlineMessage() || readLocalMessage());
  const postData = buildPostData(msg);
  const options = buildOptions(Buffer.byteLength(postData));
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => (data += chunk));
    res.on('end', async () => {
      function extractJson(s) {
        const patterns = [
          /frameElement\.callback\((\{[\s\S]*?\})\)/,
          /callback\((\{[\s\S]*?\})\)/,
          /\((\{[\s\S]*?\})\)/,
        ];
        for (const re of patterns) {
          const mm = s.match(re);
          if (mm) {
            try { return JSON.parse(mm[1]); } catch {}
          }
        }
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
      const is2xx = res.statusCode >= 200 && res.statusCode < 300;
      if (is2xx) {
        console.log(data);
        process.exit(0);
      }
      const result = extractJson(data);
      const { code: codeTxt, sub: subTxt } = extractCodes(data);
      const code = result ? (result.code ?? result.ret ?? result.result ?? codeTxt) : codeTxt;
      const sub = result ? (result.subcode ?? result.sub ?? subTxt) : subTxt;
      console.error(`[COOKIE_EXPIRED] uin=${qqUin} hostUin=${hostUin} code=${code} sub=${sub}`);
      process.exit(1);
    });
  });
  req.on('error', err => { console.error(String(err)); process.exit(1); });
  req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
  req.write(postData);
  req.end();
}

main();

// dingtalk notifier moved to scripts/dingtalk.js
async function checkCookie() {
  const s = Math.random();
  const params = querystring.stringify({ uin: qqUin, hostUin: hostUin, start: 0, s, format: 'jsonp', num: 1, inCharset: 'utf-8', outCharset: 'utf-8', g_tk: gtk });
  const path = `/proxy/domain/m.qzone.qq.com/cgi-bin/new/get_msgb?${params}`;
  const options = { hostname: 'user.qzone.qq.com', path, method: 'GET', headers: { 'Cookie': cookie, 'Referer': `https://user.qzone.qq.com/${hostUin}`, 'User-Agent': 'Mozilla/5.0' } };
  await new Promise((resolve) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', async () => {
        const is2xx = res.statusCode >= 200 && res.statusCode < 300;
        const m = data.match(/frameElement\.callback\((\{[\s\S]*?\})\)/) || data.match(/\((\{[\s\S]*?\})\)/);
        let result = null;
        try { if (m) result = JSON.parse(m[1]); } catch {}
        const ok = is2xx && result && (result.code === 0 || result.ret === 0);
        if (ok) {
          console.log('[COOKIE_OK]');
          resolve();
          return;
        }
        const code = result ? (result.code ?? result.ret) : 'NA';
        const sub = result ? (result.subcode ?? result.sub) : 'NA';
      console.error(`[COOKIE_EXPIRED] uin=${qqUin} hostUin=${hostUin} code=${code} sub=${sub}`);
      process.exit(1);
      });
    });
    req.on('error', () => { console.error('[COOKIE_CHECK_ERROR]'); process.exit(1); });
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
        const is2xx = res.statusCode >= 200 && res.statusCode < 300;
        const m = data.match(/frameElement\.callback\((\{[\s\S]*?\})\)/) || data.match(/\((\{[\s\S]*?\})\)/);
        let result = null;
        try { if (m) result = JSON.parse(m[1]); } catch {}
        const ok = is2xx && result && (result.code === 0 || result.ret === 0);
        resolve(!!ok);
      });
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}
