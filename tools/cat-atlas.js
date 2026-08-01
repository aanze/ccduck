'use strict';
// Regenerates docs/cat-atlas.png: every cat pose, numbered, grouped by family,
// with the key it has in SPR_CAT printed underneath — so a pose can be discussed
// by number and then edited by name without hunting for it.
//
//   node tools/cat-atlas.js        (or: npm run atlas)
//
// Edit src/cat.js, run this, look at the result. That is the whole loop; the
// half-block terminal rendering is far too small to judge a drawing by.
const { writePng } = require('./png.js');
const { SPR_CAT } = require('../src/cat.js');
const { PAL } = require('../src/duck.js');

// 3x5 pixel font. Only the glyphs the sprite keys actually use, plus digits.
// Names print in upper case because no two keys differ only by case: reading
// STALKA off the sheet and searching cat.js for it finds exactly one entry.
const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  A: ['111', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'], P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'], R: ['111', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], W: ['101', '101', '111', '111', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};

// groups: [tint, names...] — the tint separates the families at a glance.
// sitBlink is appended last on purpose: it is the one pose not in the reference
// sheet, and putting it in place would shift every number the sheet is known by.
const GROUPS = [
  [0x161b22, ['stand', 'blink', 'walk1', 'walk2', 'walk3', 'walk4']],
  [0x1b1620, ['sit', 'sitUp', 'sitMeow', 'panicA', 'panicB']],
  [0x141d1a, ['wash1', 'wash2', 'wash3', 'lick1', 'lick2', 'lick3']],
  [0x1d1a14, ['sleep', 'quack', 'billUp', 'eat1', 'eat2']],
  [0x141a1d, ['stalkA', 'stalkB', 'wiggleA', 'wiggleB', 'leap', 'land']],
  [0x1a1414, ['front', 'frontBlink', 'frontQuack', 'begA', 'begB']],
  [0x181818, ['raidLow', 'raidFlapUp', 'raidFlapMid', 'raidFlapDown', 'sitBlink']],
];

const SCALE = 11, SW = 16, SH = 12, PADX = 2;
const NUM_S = 3, NAME_S = 2;                   // glyph scale, number and name
const COLS = 6;
const cellW = (SW + PADX * 2) * SCALE;
const cellH = (SH + 1) * SCALE + 6 + NUM_S * 5 + 5 + NAME_S * 5 + 7;

const cells = [];
let row = 0;
for (const [tint, names] of GROUPS) {
  names.forEach((n, i) => cells.push({ n, tint, col: i % COLS, row: row + Math.floor(i / COLS) }));
  row += Math.ceil(names.length / COLS);
}
for (const c of cells) if (!SPR_CAT[c.n]) throw new Error('unknown pose: ' + c.n);
// a glyph the font does not have would silently print as a blank, and the sheet
// would quietly lie about a key's name
for (const c of cells) {
  for (const ch of (c.n.toUpperCase() + String(cells.indexOf(c) + 1))) {
    if (!FONT[ch]) throw new Error('the label font has no glyph for "' + ch + '" (in ' + c.n + ')');
  }
}
const listed = new Set(cells.map((c) => c.n));
for (const k of Object.keys(SPR_CAT)) if (!listed.has(k)) throw new Error('pose missing from the sheet: ' + k);

const W = COLS * cellW, H = row * cellH;

// Is (bx, by) inside a glyph of `text`, drawn at scale s, centred on the cell?
function textPixel(text, bx, by, y0, s) {
  if (by < y0 || by >= y0 + s * 5) return false;
  const adv = 4 * s;                              // 3 px glyph + 1 px spacing
  const x0 = Math.floor((cellW - text.length * adv) / 2);
  if (bx < x0 || bx >= x0 + text.length * adv) return false;
  const k = Math.floor((bx - x0) / adv);
  const gx = Math.floor((bx - x0 - k * adv) / s);
  if (gx > 2) return false;                       // the spacing column
  const g = FONT[text[k]];
  return !!g && g[Math.floor((by - y0) / s)][gx] === '1';
}

const NUM_Y = (SH + 1) * SCALE + 6;
const NAME_Y = NUM_Y + NUM_S * 5 + 5;

writePng(require('path').join(__dirname, '..', 'docs', 'cat-atlas.png'), W, H, (x, y) => {
  const col = Math.floor(x / cellW), r = Math.floor(y / cellH);
  const cell = cells.find((c) => c.col === col && c.row === r);
  if (!cell) return 0x0d1117;
  const bx = x % cellW, by = y % cellH;
  const sx = Math.floor(bx / SCALE) - PADX, sy = Math.floor(by / SCALE) - 1;
  if (sx >= 0 && sx < SW && sy >= 0 && sy < SH) {
    const ch = SPR_CAT[cell.n][sy][sx];
    if (ch !== '.') return PAL[ch] ?? 0xFF00FF;
  }
  if (textPixel(String(cells.indexOf(cell) + 1), bx, by, NUM_Y, NUM_S)) return 0xC9CCD1;
  if (textPixel(cell.n.toUpperCase(), bx, by, NAME_Y, NAME_S)) return 0x8A949E;
  return cell.tint;
});
console.log('docs/cat-atlas.png: ' + cells.length + ' poses, ' + W + 'x' + H);
