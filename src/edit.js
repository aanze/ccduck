'use strict';
// The sprite editor: `ccduck --edit`, or `cccat --edit` to open straight on the
// cat. Two panels side by side — the drawing as the app renders it, and the same
// drawing as the 16x12 grid of palette letters, with a cursor. Every keystroke
// redraws both, so the preview is the edit.
//
// Nothing here writes to src/. Saving stores the pose in ~/.ccduck-sprites.json
// (see sprites.js), which the app applies over its built-in table at startup.
// That is what makes `d` and `D` — back to default, for this pose or for all of
// them — always available, whatever state the file is in.
const { Screen, colorMode, term, A_BOLD, A_REV, A_DIM } = require('./ansi');
const { SPR, PAL } = require('./duck');
const { SPR_CAT } = require('./cat');
const sprites = require('./sprites');

const W = sprites.W, H = sprites.H;
const C = {
  title: 0xE6EDF3, dim: 0x8A949E, key: 0x7FD4F5, ok: 0x7BC96F,
  warn: 0xF2C744, bad: 0xFF5555, frame: 0x3A4048, cursor: 0xFFD21E,
};
// The letters worth offering, in the order they are useful. Everything else in
// PAL stays legal — it just is not on the palette bar.
const KEYS_CAT = ['M', 'm', 'T', 'W', 'P', 'p', 'K', 'N', 'n'];
const KEYS_DUCK = ['Y', 'H', 'y', 'O', 'o', 'K', 'W', 'w', 'R'];

function panel(scr, x, y, w, h, title) {
  const line = (yy, l, mid, r) => {
    scr.set(x, yy, l, C.frame);
    for (let i = 1; i < w - 1; i++) scr.set(x + i, yy, mid, C.frame);
    scr.set(x + w - 1, yy, r, C.frame);
  };
  line(y, '┌', '─', '┐');
  line(y + h - 1, '└', '─', '┘');
  for (let i = 1; i < h - 1; i++) { scr.set(x, y + i, '│', C.frame); scr.set(x + w - 1, y + i, '│', C.frame); }
  if (title) scr.text(x + 2, y, ' ' + title + ' ', C.dim);
}

function run(opts) {
  if (!process.stdin.isTTY) {
    console.error('ccduck --edit needs an interactive terminal.');
    process.exit(1);
  }
  const tables = { duck: SPR, cat: SPR_CAT };
  // captured BEFORE the overrides are applied: this is what "default" means
  const DEFAULTS = sprites.snapshot(tables);
  const applied = sprites.apply(tables, PAL);

  let pet = opts && opts.pet === 'cat' ? 'cat' : 'duck';
  let names = Object.keys(tables[pet]);
  let idx = 0, cx = 0, cy = 0;
  let msg = applied.rejected.length
    ? { text: applied.rejected.length + ' stored pose(s) rejected: ' + applied.rejected[0], col: C.bad }
    : (applied.applied.length ? { text: applied.applied.length + ' pose(s) loaded from ' + sprites.overridePath(), col: C.ok } : null);

  const mode = colorMode(process.env, null);
  let cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  let scr = new Screen(cols, Math.max(20, rows), mode);

  const cur = () => tables[pet][names[idx]];
  const def = () => DEFAULTS[pet][names[idx]];
  // What is on disk for this pose: the stored override, or the built-in drawing
  // when there is none. "Unsaved" means differing from THAT — comparing against
  // the default instead said "changed, unsaved" about a pose that had just been
  // saved, and went on saying it after a restart, since the override is applied
  // over the table at startup and so always differs from the default.
  const saved = () => { const all = sprites.load(); return (all[pet] && all[pet][name()]) || null; };
  const name = () => names[idx];
  const onDisk = () => saved() || def();
  const dirty = () => cur().join('|') !== onDisk().join('|');

  function draw() {
    scr.clear();
    const nm = name();
    const stored = saved();
    scr.text(1, 0, 'ccduck sprite editor', C.title, null, A_BOLD);
    scr.text(23, 0, '· ' + pet + ' · ' + nm + '  (' + (idx + 1) + '/' + names.length + ')', C.title);
    if (dirty()) scr.text(cols - 22, 0, '● changed, unsaved', C.warn);
    else if (stored) scr.text(cols - 22, 0, '● saved', C.ok);
    else scr.text(cols - 22, 0, '○ default', C.dim);

    // ---- left: the drawing, at the exact proportion the app renders it ----
    // One sprite pixel is one column wide and half a row tall, so 16x12 becomes
    // 16 columns by 6 rows. Widening it to two columns per pixel made a roomier
    // panel and a lie: the cat came out twice as wide as it will ever look.
    const px = 1;
    const pw = W * px + 4, ph = H / 2 + 2;
    panel(scr, 1, 2, pw, ph, 'preview');
    for (let r = 0; r < H; r += 2) {
      for (let c = 0; c < W; c++) {
        const top = cur()[r][c], bot = cur()[r + 1][c];
        const tc = top === '.' ? -1 : PAL[top], bc = bot === '.' ? -1 : PAL[bot];
        let ch = ' ', fg = null, bg = null;
        if (tc >= 0 && bc >= 0) { ch = tc === bc ? '█' : '▀'; fg = tc; bg = tc === bc ? null : bc; }
        else if (tc >= 0) { ch = '▀'; fg = tc; }
        else if (bc >= 0) { ch = '▄'; fg = bc; }
        for (let k = 0; k < px; k++) scr.set(3 + c * px + k, 3 + r / 2, ch, fg, bg);
      }
    }

    // ---- right: the grid of letters, with the cursor ----
    const disk = onDisk();
    const gx = pw + 3;
    panel(scr, gx, 2, W + 8, H + 2, 'pixels');
    for (let r = 0; r < H; r++) {
      scr.text(gx + 1, 3 + r, String(r).padStart(2), C.dim, null, A_DIM);
      for (let c = 0; c < W; c++) {
        const ch = cur()[r][c];
        const here = r === cy && c === cx;
        scr.set(gx + 4 + c, 3 + r, ch, here ? 0x111111 : (ch === '.' ? C.frame : PAL[ch]),
          here ? C.cursor : null, here ? A_BOLD : 0);
      }
      // a mark beside every row not yet written to disk
      if (cur()[r] !== disk[r]) scr.set(gx + 4 + W + 1, 3 + r, '·', C.warn);
    }

    // ---- palette ----
    const keys = pet === 'cat' ? KEYS_CAT : KEYS_DUCK;
    let y = 2 + Math.max(ph, H + 2) + 1;
    scr.text(1, y, 'palette', C.dim);
    let x = 9;
    scr.text(x, y, '.', C.frame); scr.text(x + 1, y, '=empty', C.dim, null, A_DIM); x += 9;
    for (const k of keys) {
      scr.set(x, y, '█', PAL[k]);
      scr.set(x + 1, y, k, C.title);
      x += 3;
    }
    y += 2;
    const help = [
      ['←↑→↓ / hjkl', 'move'], ['letter', 'paint'], ['. or space', 'erase'],
      ['tab / ⇧tab', 'pose'], ['x', 'duck ⇄ cat'],
    ];
    const help2 = [
      ['s', 'save this pose'], ['d', 'this pose back to default'],
      ['D', 'EVERYTHING back to default'], ['q', 'quit'],
    ];
    let hx = 1;
    for (const [ks, what] of help) { scr.text(hx, y, ks, C.key); scr.text(hx + ks.length + 1, y, what, C.dim); hx += ks.length + what.length + 3; }
    hx = 1; y += 1;
    for (const [ks, what] of help2) { scr.text(hx, y, ks, C.key); scr.text(hx + ks.length + 1, y, what, C.dim); hx += ks.length + what.length + 3; }
    y += 2;
    scr.text(1, y, 'edits are stored in ' + sprites.overridePath() + ' — src/ is never touched', C.dim, null, A_DIM);
    if (msg) scr.text(1, y + 1, msg.text, msg.col);
    process.stdout.write(scr.render());
  }

  const cleanup = () => {
    try { process.stdin.setRawMode(false); } catch (e) { /* ignore */ }
    process.stdin.pause();
    process.stdout.write(term.altOff);
  };
  process.stdout.write(term.altOn);
  process.on('exit', cleanup);
  process.stdout.on('resize', () => {
    cols = process.stdout.columns || cols; rows = process.stdout.rows || rows;
    scr = new Screen(cols, Math.max(20, rows), mode);
    draw();
  });

  const setPixel = (ch) => {
    const rowsNow = cur();
    rowsNow[cy] = rowsNow[cy].slice(0, cx) + ch + rowsNow[cy].slice(cx + 1);
    cx = (cx + 1) % W;
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString('utf8');
    msg = null;
    if (k === 'q' || k === 'Q' || k === '\x03') { cleanup(); process.exit(0); }
    else if (k === '\x1b[A' || k === 'k') cy = (cy + H - 1) % H;
    else if (k === '\x1b[B' || k === 'j') cy = (cy + 1) % H;
    else if (k === '\x1b[D' || k === 'h') cx = (cx + W - 1) % W;
    else if (k === '\x1b[C' || k === 'l') cx = (cx + 1) % W;
    else if (k === '\t') { idx = (idx + 1) % names.length; cx = cy = 0; }
    else if (k === '\x1b[Z') { idx = (idx + names.length - 1) % names.length; cx = cy = 0; }
    else if (k === 'x' || k === 'X') {
      pet = pet === 'cat' ? 'duck' : 'cat';
      names = Object.keys(tables[pet]); idx = 0; cx = cy = 0;
    }
    else if (k === '.' || k === ' ') setPixel('.');
    else if (k === 's') {
      // Storing is decided against the DEFAULT, not against what is on disk: a
      // pose that matches the built-in drawing needs no override at all, and one
      // that does not gets written whether or not it already had one.
      if (cur().join('|') === def().join('|')) {
        sprites.clearOverride(pet, name());
        msg = { text: 'identical to the built-in drawing: no override needed', col: C.dim };
      } else {
        sprites.setOverride(pet, name(), cur());
        msg = { text: 'saved — ' + pet + '.' + name() + ' is used from the next launch', col: C.ok };
      }
    }
    else if (k === 'd') {
      cur().splice(0, H, ...def());
      sprites.clearOverride(pet, names[idx]);
      msg = { text: names[idx] + ' back to its default drawing', col: C.ok };
    }
    else if (k === 'D') {
      for (const p of Object.keys(tables)) for (const n of Object.keys(tables[p])) tables[p][n].splice(0, H, ...DEFAULTS[p][n]);
      sprites.clearAll();
      msg = { text: 'every pose of both animals restored, override file deleted', col: C.ok };
    }
    else if (k.length === 1 && k in PAL) setPixel(k);
    else if (k.length === 1 && /[A-Za-z]/.test(k)) msg = { text: '"' + k + '" is not in the palette', col: C.bad };
    draw();
  });
  draw();
}

module.exports = { run };
