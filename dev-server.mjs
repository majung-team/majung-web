// Loopback development server. Production uses an HTTPS reverse proxy.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const apiPort = Number(process.env.MAJUNG_API_PORT || 8080);
const webPort = Number(process.env.MAJUNG_WEB_PORT || 4173);
if (![apiPort, webPort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid local port');
const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'api.js', 'model.js', 'push.js', 'proposal.js', 'stream.js', 'map.js', 'account.js', 'account-api.js'].map(f => ['/' + f, [f, 'text/javascript; charset=utf-8']]),
  ['/account', ['account.html', 'text/html; charset=utf-8']],
  ['/privacy', ['privacy.html', 'text/html; charset=utf-8']],
  ['/account.css', ['account.css', 'text/css; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ...['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'].map(f => ['/' + f, [f, 'image/png']]),
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
]);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (['/preview/account','/preview/pickup'].includes(path)) {
    const source = path.endsWith('/account') ? '/account' : '/';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>마중 · 모바일 화면 확인</title><style>body{margin:0;background:#e9edf0;font:14px sans-serif;color:#626d75}p{text-align:center;margin:16px}iframe{display:block;width:390px;height:844px;border:0;margin:0 auto;background:white;box-shadow:0 12px 40px #20282e18}</style><p>390 × 844 · 로컬 화면 검사 · 실제 휴대전화 시험과 별도</p><iframe title="마중 모바일 화면" src="${source}"></iframe></html>`);
    return;
  }
  if (path.startsWith('/api/')) {
    const upstream = http.request({hostname: '127.0.0.1', port: apiPort, path: req.url,
      method: req.method, headers: {...req.headers, host: '127.0.0.1:8080'}}, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.setTimeout(path.endsWith('/events') ? 45000 : 10000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  if (path === '/account.html' || path === '/account/') {
    res.writeHead(308, {Location: '/account' + url.search});
    res.end(); return;
  }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end(); return; }
  try {
    const bytes = await readFile(join(root, file[0]));
    res.setHeader('Content-Type', file[1]);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(500); res.end(); }
});
server.listen(webPort, '127.0.0.1', () => console.log(`웹: http://127.0.0.1:${webPort} · API: 127.0.0.1:${apiPort}`));
