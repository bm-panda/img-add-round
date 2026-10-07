const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { render, validate } = require('./renderer');
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('./config');
const { resolveOutputPath } = require('./output');
const { pickImages, pickOutputDir } = require('./dialog');

const WINDOW_W = 840;
const WINDOW_H = 512;
const ROOT = path.join(__dirname, '..');

let images = [];
let idSeq = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function listImages() {
  return images.map((i) => ({ id: i.id, name: i.name, path: i.path }));
}

async function addImage(name, filePath, buffer) {
  if (!buffer || !buffer.length) return null;
  if (!(await validate(buffer, name))) return null;
  const item = { id: String(++idSeq), name, path: filePath || null, buffer };
  images.push(item);
  return item;
}

function resolveOutput(item, config) {
  return resolveOutputPath(item.path, item.name, config);
}

function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getCenterArgs() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output ($b.Width); Write-Output ($b.Height)"',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true }
    );
    const lines = out.trim().split(/\r?\n/).map((s) => parseInt(s.trim(), 10));
    const sw = lines[0];
    const sh = lines[1];
    if (!sw || !sh) return [];
    const left = Math.max(0, Math.round((sw - WINDOW_W) / 2));
    const top = Math.max(0, Math.round((sh - WINDOW_H) / 2));
    return [`--window-position=${left},${top}`, `--window-size=${WINDOW_W},${WINDOW_H}`];
  } catch {
    return [];
  }
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/images' && req.method === 'GET') {
    sendJson(res, 200, { images: listImages() });
    return;
  }

  if (pathname === '/api/images' && req.method === 'DELETE') {
    images = [];
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/images/pick' && req.method === 'POST') {
    try {
      const paths = await pickImages();
      for (const p of paths) {
        try { await addImage(path.basename(p), p, fs.readFileSync(p)); } catch {}
      }
      sendJson(res, 200, { ok: true, images: listImages() });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/images/upload' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const rawName = req.headers['x-filename'] || 'image.png';
      const name = path.basename(decodeURIComponent(rawName));
      const item = await addImage(name, null, body);
      if (!item) { sendJson(res, 400, { ok: false, error: '不是有效的图片' }); return; }
      sendJson(res, 200, { ok: true, images: listImages() });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname.startsWith('/api/image/') && req.method === 'GET') {
    const id = pathname.slice('/api/image/'.length);
    const item = images.find((i) => i.id === id);
    if (!item) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(item.buffer);
    return;
  }

  if (pathname.startsWith('/api/image/') && req.method === 'DELETE') {
    const id = pathname.slice('/api/image/'.length);
    images = images.filter((i) => i.id !== id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/output/pick' && req.method === 'POST') {
    try {
      const dir = await pickOutputDir();
      sendJson(res, 200, { ok: true, path: dir });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, loadConfig());
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      saveConfig(JSON.parse(body.toString('utf8') || '{}'));
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/apply' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString('utf8') || '{}');
      const item = images.find((i) => i.id === payload.id);
      if (!item) { sendJson(res, 404, { ok: false, error: '图片不存在' }); return; }
      const config = { ...DEFAULT_CONFIG, ...(payload.config || {}) };
      const target = resolveOutput(item, config);
      if (target.error) { sendJson(res, 400, { ok: false, error: target.error }); return; }
      const result = await render(item.buffer, item.name, config);
      fs.mkdirSync(path.dirname(target.output), { recursive: true });
      fs.writeFileSync(target.output, result.buffer);
      saveConfig(config);
      sendJson(res, 200, { ok: true, output: target.output, radius: result.radius });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveFile(res, filePath);
}

function openBrowser(url, onClose) {
  const browser = findBrowser();
  if (!browser) {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return null;
  }
  const userDataDir = path.join(os.homedir(), '.image-round-browser-profile');
  const args = [
    '--app=' + url,
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + userDataDir,
    ...getCenterArgs(),
  ];
  const proc = spawn(browser, args);
  proc.on('exit', onClose);
  return proc;
}

function openWindow(url, onClose) {
  const startedAt = Date.now();
  let webview;
  try {
    webview = spawn(
      'webview-cli',
      [url, '--title', '图片加圆角', '--width', String(WINDOW_W), '--height', String(WINDOW_H)],
      { stdio: 'ignore', windowsHide: false }
    );
  } catch {
    openBrowser(url, onClose);
    return;
  }
  let settled = false;
  webview.on('error', () => {
    if (settled) return;
    settled = true;
    openBrowser(url, onClose);
  });
  webview.on('exit', (code) => {
    if (settled) return;
    settled = true;
    const early = Date.now() - startedAt < 3000;
    if (code !== 0 && code !== 2 && early) {
      openBrowser(url, onClose);
      return;
    }
    onClose();
  });
}

function start(files) {
  images = [];
  idSeq = 0;
  for (const p of files || []) {
    try {
      const buffer = fs.readFileSync(p);
      images.push({ id: String(++idSeq), name: path.basename(p), path: p, buffer });
    } catch {}
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      try { sendJson(res, 500, { ok: false, error: e.message }); } catch {}
    });
  });

  const shutdown = () => {
    try { server.close(); } catch {}
    process.exit(0);
  };

  server.on('error', (err) => {
    console.error('服务启动失败:', err.message);
    process.exit(1);
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const url = 'http://127.0.0.1:' + port + '/';
    openWindow(url, shutdown);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { start, handleRequest };
