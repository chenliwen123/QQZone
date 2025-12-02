# QQ空间自动留言项目文档

**目标**
- 使用浏览器登录后获取的Cookie进行认证，无需逆向协议
- 通过GitHub Actions每天定时在指定QQ空间留言一条

**架构概览**
- 触发器: GitHub Actions `schedule` 定时触发
- 运行环境: `ubuntu-latest` + Python
- 认证: 使用Cookie中的`p_skey`计算`g_tk`，附带完整`Cookie`
- 留言接口: `m.qzone.qq.com`留言板`msg_add`

**准备工作**
- 获取Cookie: 在已登录QQ空间的浏览器开发者工具中复制`Cookie`，需要包含`p_skey`、`uin`或`p_uin`
- 确认QQ号: 目标QQ号`hostUin`与自己QQ号`uin`
- 消息内容: 准备每日留言文本

**参数与令牌**
- `p_skey`: 从Cookie读取，用于计算`g_tk`
- `g_tk`: 由`p_skey`通过DJB散列计算得到
- `uin`: 自己QQ号，可从Cookie的`uin=oXXXXXXXXX`或`p_uin=oXXXXXXXXX`解析
- `hostUin`: 目标QQ空间QQ号

**接口说明**
- URL: `https://h5.qzone.qq.com/proxy/domain/m.qzone.qq.com/cgi-bin/new_msgboard/msg_add`
- 方法: `POST`
- 表单参数: `uin`, `hostUin`, `content`, `format=json`, `g_tk`
- 关键请求头: `Cookie`, `Referer=https://user.qzone.qq.com/<hostUin>`, `Origin=https://user.qzone.qq.com`

**Python脚本示例**

```python
import os
import requests

def calc_gtk(p_skey):
    h = 5381
    for c in p_skey:
        h = (h << 5) + h + ord(c)
    return h & 0x7fffffff

def parse_value(cookie, keys):
    parts = [p.strip() for p in cookie.split(';')]
    for k in keys:
        for p in parts:
            if p.startswith(k + '='):
                return p.split('=', 1)[1]
    return ''

cookie = os.environ['QQ_COOKIE']
host_uin = os.environ['TARGET_UIN']
msg = os.environ.get('MESSAGE', '每日自动留言')
qq_uin = os.environ.get('QQ_UIN')
if not qq_uin:
    qq_uin = parse_value(cookie, ['uin', 'p_uin']).lstrip('o')
gtk = calc_gtk(parse_value(cookie, ['p_skey']))

url = 'https://h5.qzone.qq.com/proxy/domain/m.qzone.qq.com/cgi-bin/new_msgboard/msg_add'
data = {
    'uin': qq_uin,
    'hostUin': host_uin,
    'content': msg,
    'format': 'json',
    'g_tk': gtk,
}
headers = {
    'Cookie': cookie,
    'Origin': 'https://user.qzone.qq.com',
    'Referer': f'https://user.qzone.qq.com/{host_uin}',
    'User-Agent': 'Mozilla/5.0'
}
r = requests.post(url, data=data, headers=headers, timeout=30)
print(r.text)
```

**GitHub Actions配置**

```yaml
name: QQZone Daily Message

on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch:

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install
        run: pip install requests
      - name: Run
        env:
          QQ_COOKIE: ${{ secrets.QQ_COOKIE }}
          TARGET_UIN: ${{ secrets.TARGET_UIN }}
          MESSAGE: ${{ secrets.MESSAGE }}
          QQ_UIN: ${{ secrets.QQ_UIN }}
        run: python scripts/qzone_msg.py
```

**Secrets约定**
- `QQ_COOKIE`: 完整Cookie字符串
- `TARGET_UIN`: 目标QQ号
- `QQ_UIN`: 可选，自己QQ号；不提供则从Cookie中解析
- `MESSAGE`: 可选，留言内容，未设置时为默认文本

**操作步骤**
- 在浏览器复制登录QQ空间后的`Cookie`
- 在GitHub仓库设置`Secrets`为上述变量
- 将脚本放置于`scripts/qzone_msg.py`并提交
- 添加工作流文件并提交到默认分支
- 在Actions页面手动触发一次验证是否成功

**常见问题**
- 返回`403`或`-3000`: Cookie失效或`g_tk`错误，重新获取`p_skey`
- 返回`-1001`或权限错误: 目标空间留言权限受限
- 没有任何响应: 检查`Referer`与`Origin`是否正确，以及`User-Agent`
- 时间不符合预期: `cron`使用UTC，需按需调整

**拓展**
- 随机留言: 在脚本中从文本列表随机选择
- 多目标支持: 循环`hostUin`列表逐个发送

**Node脚本示例**

```javascript
const https = require('https');
const querystring = require('querystring');

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

const cookie = process.env.QQ_COOKIE;
const hostUin = process.env.TARGET_UIN;
const msg = process.env.MESSAGE || '每日自动留言';
let qqUin = process.env.QQ_UIN;
if (!qqUin) qqUin = parseValue(cookie || '', ['uin', 'p_uin']).replace(/^o/, '');
const p_skey = parseValue(cookie || '', ['p_skey']);
const gtk = calcGtk(p_skey);

const postData = querystring.stringify({
  uin: qqUin,
  hostUin: hostUin,
  content: msg,
  format: 'json',
  g_tk: gtk,
});

const options = {
  hostname: 'h5.qzone.qq.com',
  path: '/proxy/domain/m.qzone.qq.com/cgi-bin/new_msgboard/msg_add',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
    'Cookie': cookie,
    'Origin': 'https://user.qzone.qq.com',
    'Referer': `https://user.qzone.qq.com/${hostUin}`,
    'User-Agent': 'Mozilla/5.0',
  },
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => (data += chunk));
  res.on('end', () => {
    console.log(data);
    if (res.statusCode < 200 || res.statusCode >= 300) process.exit(1);
  });
});

req.on('error', err => {
  console.error(String(err));
  process.exit(1);
});

req.setTimeout(30000, () => {
  req.destroy(new Error('timeout'));
});

req.write(querystring.stringify({
  uin: qqUin,
  hostUin: hostUin,
  content: msg,
  format: 'json',
  g_tk: gtk,
}));
req.end();
```

**GitHub Actions配置(Node)**

```yaml
name: QQZone Daily Message (Node)

on:
  schedule:
    - cron: '0 23 * * *'
  workflow_dispatch:

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run
        env:
          QQ_COOKIE: ${{ secrets.QQ_COOKIE }}
          TARGET_UIN: ${{ secrets.TARGET_UIN }}
          QQ_UIN: ${{ secrets.QQ_UIN }}
        run: node scripts/qzone_msg.js
```

**部署到GitHub步骤**

- 在仓库 Settings → Secrets and variables → Actions 中添加：
  - `QQ_COOKIE`
  - `TARGET_UIN`
  - `MESSAGE`（可选）
  - `QQ_UIN`（可选）
- 将工作流文件保存为 `.github/workflows/qqzone.yml`
- 默认每天 `07:00` (北京时间，UTC+8) 执行（`cron: 0 23 * * *`），按需调整
- 可在 Actions 页面通过手动触发进行验证

**本地运行(Node)**

```powershell
# 在 PowerShell 里设置环境变量
$env:QQ_COOKIE = '<你的完整Cookie>'
$env:TARGET_UIN = '<目标QQ号>'
$env:MESSAGE   = '每日自动留言'
# 可选：自己QQ号，不设置则从Cookie解析
$env:QQ_UIN    = '<自己QQ号>'

# 运行脚本
node scripts/qzone_msg.js
```

- 成功时输出接口返回JSON；失败时进程退出码为1
- 若提示`403`或错误码为负数，请重新获取Cookie并确保包含`p_skey`
- 若权限错误，请检查目标空间是否允许你的账号留言

**本地运行(.env 方式)**

```ini
# 新建 .env 文件并填入：
QQ_COOKIE=<你的完整Cookie>
TARGET_UIN=<目标QQ号>
MESSAGE=每日自动留言
# 可选：自己QQ号，不设置则从Cookie解析
QQ_UIN=<自己QQ号>
```

```powershell
# 运行（已安装dotenv）
npm run qzone
```
