const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const WEBP_WASM = path.join(__dirname, '..', 'node_modules', '@jsquash', 'webp', 'codec', 'dec', 'webp_dec.wasm');

let webpDecode = null;
let webpReady = false;

async function ensureWebp() {
  if (webpReady) return;
  const wasmBinary = fs.readFileSync(WEBP_WASM);
  const mod = await import('@jsquash/webp/decode.js');
  await mod.init({ wasmBinary });
  webpDecode = mod.default;
  webpReady = true;
}

function extOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

async function decode(buffer, name) {
  if (extOf(name) === '.webp') {
    await ensureWebp();
    const decoded = await webpDecode(buffer);
    return new Jimp({
      data: Buffer.from(decoded.data),
      width: decoded.width,
      height: decoded.height,
    });
  }
  return Jimp.read(buffer);
}

function cornerDist(x, y, cx, cy) {
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  return Math.sqrt(dx * dx + dy * dy);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function maskAlpha(x, y, w, h, r) {
  if (r <= 0) return 255;
  const tl = x < r && y < r;
  const tr = x >= w - r && y < r;
  const bl = x < r && y >= h - r;
  const br = x >= w - r && y >= h - r;
  if (!tl && !tr && !bl && !br) return 255;
  let cx;
  let cy;
  if (tl) { cx = r; cy = r; }
  else if (tr) { cx = w - r - 1; cy = r; }
  else if (bl) { cx = r; cy = h - r - 1; }
  else { cx = w - r - 1; cy = h - r - 1; }
  const d = cornerDist(x, y, cx, cy);
  const inner = r - 0.5;
  const outer = r + 0.5;
  if (d <= inner) return 255;
  if (d >= outer) return 0;
  return Math.round(255 * (1 - smoothstep(inner, outer, d)));
}

function applyRoundedCorners(image, radius) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const r = Math.max(0, Math.min(parseInt(radius, 10) || 0, Math.floor(Math.min(w, h) / 2)));
  if (r > 0) {
    const mask = new Jimp(w, h, 0x00000000);
    mask.scan(0, 0, w, h, (x, y, idx) => {
      const a = maskAlpha(x, y, w, h, r);
      if (a > 0) {
        mask.bitmap.data[idx] = a;
        mask.bitmap.data[idx + 1] = 255;
        mask.bitmap.data[idx + 2] = 255;
        mask.bitmap.data[idx + 3] = 255;
      }
    });
    image.mask(mask, 0, 0);
  }
  return r;
}

async function render(buffer, name, settings) {
  const image = await decode(buffer, name);
  const applied = applyRoundedCorners(image, (settings || {}).radius);
  const out = await image.getBufferAsync(Jimp.MIME_PNG);
  return { buffer: out, radius: applied };
}

async function validate(buffer, name) {
  try {
    await decode(buffer, name);
    return true;
  } catch {
    return false;
  }
}

module.exports = { render, validate, decode };
