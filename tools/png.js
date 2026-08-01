'use strict';
// Minimal PNG writer, so the sprites can actually be LOOKED at instead of
// guessed from half-block art. No dependencies: zlib is built into node.
const zlib = require('zlib');

const TBL = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// pixels: (x, y) -> 0xRRGGBB or null for the background
function writePng(file, w, h, pixel, bg = 0x101418) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      const v = c == null ? bg : c;
      raw[p++] = (v >> 16) & 255; raw[p++] = (v >> 8) & 255; raw[p++] = v & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  require('fs').writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// Renders named sprites side by side, scaled up, on a dark background.
function sheet(file, table, pal, names, scale = 9, cols = 6) {
  const SW = 16, SH = 12, GAP = 2;
  const n = names.length;
  const perRow = Math.min(cols, n);
  const rowsN = Math.ceil(n / perRow);
  const cellW = (SW + GAP) * scale, cellH = (SH + GAP) * scale;
  const W = perRow * cellW, H = rowsN * cellH;
  writePng(file, W, H, (x, y) => {
    const ci = Math.floor(x / cellW), ri = Math.floor(y / cellH);
    const idx = ri * perRow + ci;
    if (idx >= n) return null;
    const sx = Math.floor((x % cellW) / scale) - 1;
    const sy = Math.floor((y % cellH) / scale) - 1;
    if (sx < 0 || sx >= SW || sy < 0 || sy >= SH) return null;
    const ch = table[names[idx]][sy][sx];
    return ch === '.' ? null : (pal[ch] ?? 0xFF00FF);
  });
}
module.exports = { writePng, sheet };
