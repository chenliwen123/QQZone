
const https = require('https');

function sendText(webhook, text) {
  return new Promise((resolve, reject) => {
    try {
      const payload = JSON.stringify({ msgtype: 'text', text: { content: text } });
      const url = new URL(webhook);
      const opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
          else reject(new Error('non-2xx status ' + res.statusCode + ' body:' + data));
        });
      });
      req.on('error', err => reject(err));
      req.write(payload);
      req.end();
    } catch(e) { reject(e); }
  });
}

module.exports = { sendText };
