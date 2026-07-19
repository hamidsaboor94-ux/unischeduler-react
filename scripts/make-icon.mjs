/**
 * Generates build/icon.ico (256x256, PNG-compressed ICO — valid since Windows
 * Vista) without any image libraries: pixels are drawn in a raw RGBA buffer,
 * PNG-encoded with node:zlib, then wrapped in an ICO container.
 *
 * The icon is a calendar glyph on an indigo→violet gradient tile. Replace
 * build/icon.ico with a designed one any time — this just guarantees the
 * installer and window have a real icon out of the box.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const px = new Uint8Array(SIZE * SIZE * 4); // transparent black

// --- drawing helpers -------------------------------------------------------

/** Signed-distance of point to a rounded rectangle; <=0 means inside. */
function roundedRectDist(pxX, pxY, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const dx = Math.abs(pxX - cx) - (w / 2 - r);
  const dy = Math.abs(pxY - cy) - (h / 2 - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Paints a rounded rect with 1px antialiased edge. color: fn(x,y) -> [r,g,b,a] or static array. */
function fillRoundedRect(x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x) - 1), x1 = Math.min(SIZE - 1, Math.ceil(x + w) + 1);
  const y0 = Math.max(0, Math.floor(y) - 1), y1 = Math.min(SIZE - 1, Math.ceil(y + h) + 1);
  for (let py = y0; py <= y1; py++) {
    for (let pxX = x0; pxX <= x1; pxX++) {
      const d = roundedRectDist(pxX + 0.5, py + 0.5, x, y, w, h, r);
      if (d > 0.5) continue;
      const cov = Math.min(1, 0.5 - d); // 0..1 edge coverage
      const [r8, g8, b8, a8] = typeof color === 'function' ? color(pxX, py) : color;
      blend(pxX, py, r8, g8, b8, (a8 / 255) * cov);
    }
  }
}

function blend(x, y, r, g, b, alpha) {
  const i = (y * SIZE + x) * 4;
  const a0 = px[i + 3] / 255;
  const outA = alpha + a0 * (1 - alpha);
  if (outA <= 0) return;
  px[i]     = Math.round((r * alpha + px[i]     * a0 * (1 - alpha)) / outA);
  px[i + 1] = Math.round((g * alpha + px[i + 1] * a0 * (1 - alpha)) / outA);
  px[i + 2] = Math.round((b * alpha + px[i + 2] * a0 * (1 - alpha)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

const lerp = (a, b, t) => a + (b - a) * t;
/** Background gradient: indigo (top) -> violet (bottom). */
function bgGradient(_x, y) {
  const t = y / SIZE;
  return [Math.round(lerp(0x4f, 0x8b, t)), Math.round(lerp(0x46, 0x3c, t)), Math.round(lerp(0xe5, 0xf6, t)), 255];
}
/** Same gradient darkened — used for the calendar header so it reads as "cut into" the tile. */
function bgGradientDark(_x, y) {
  const [r, g, b] = bgGradient(_x, y);
  return [Math.round(r * 0.72), Math.round(g * 0.72), Math.round(b * 0.72), 255];
}

// --- compose the icon -------------------------------------------------------

fillRoundedRect(8, 8, 240, 240, 56, bgGradient);            // app tile
fillRoundedRect(56, 76, 144, 130, 16, [255, 255, 255, 255]); // calendar body
fillRoundedRect(56, 76, 144, 34, 16, bgGradientDark);        // header band
fillRoundedRect(56, 96, 144, 14, 0, bgGradientDark);         // square off header's bottom corners
// binder rings poking above the header
fillRoundedRect(88, 60, 12, 30, 6, [255, 255, 255, 255]);
fillRoundedRect(156, 60, 12, 30, 6, [255, 255, 255, 255]);
// 3x3 grid of day cells in the gradient color
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    fillRoundedRect(71 + col * 42, 124 + row * 26, 30, 18, 5, bgGradient);
  }
}

// --- PNG encoding ------------------------------------------------------------

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // each scanline prefixed by filter byte 0
for (let y = 0; y < SIZE; y++) {
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// --- ICO wrapper --------------------------------------------------------------

const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(1, 2);          // type: icon
ico.writeUInt16LE(1, 4);          // one image
ico[6] = 0; ico[7] = 0;           // width/height 0 = 256
ico.writeUInt16LE(1, 10);         // color planes
ico.writeUInt16LE(32, 12);        // bits per pixel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);        // image data offset
png.copy(ico, 22);

const outDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(outDir, 'icon.png'), png); // handy for previewing / other targets
console.log(`Wrote ${path.join(outDir, 'icon.ico')} (${ico.length} bytes)`);
