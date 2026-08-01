'use strict';
// Framebuffer + ANSI serialisation (truecolor, with a 256-colour fallback).

const ESC = '\x1b[';

function colorMode(env, forced) {
  if (forced) return forced;
  if (env.NO_COLOR) return '256';
  const ct = String(env.COLORTERM || '').toLowerCase();
  if (ct.includes('truecolor') || ct.includes('24bit')) return 'tc';
  if (env.WT_SESSION || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'iTerm.app') return 'tc';
  return '256';
}

// 0xRRGGBB -> xterm 256 index (6x6x6 cube + grey ramp)
function to256(rgb) {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const q = (v) => v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.round((v - 35) / 40));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

const A_BOLD = 1, A_REV = 2, A_DIM = 4;

class Screen {
  constructor(cols, rows, mode) {
    this.resize(cols, rows);
    this.mode = mode || 'tc';
  }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n);
    this.fg = new Int32Array(n);
    this.bg = new Int32Array(n);
    this.at = new Uint8Array(n);
    this.clear();
  }
  clear() {
    this.ch.fill(' ');
    this.fg.fill(-1);
    this.bg.fill(-1);
    this.at.fill(0);
  }
  set(x, y, c, fg, bg, at) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.ch[i] = c;
    this.fg[i] = fg === undefined || fg === null ? -1 : fg;
    this.bg[i] = bg === undefined || bg === null ? -1 : bg;
    this.at[i] = at || 0;
  }
  text(x, y, str, fg, bg, at) {
    for (let k = 0; k < str.length; k++) {
      if (x + k >= this.cols) break;
      this.set(x + k, y, str[k], fg, bg, at);
    }
  }
  hline(y, x0, x1, c, fg) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c, fg);
  }
  // Serialise the whole screen (cursor addressing per line, colour runs).
  render() {
    const tc = this.mode === 'tc';
    let out = ESC + '?2026h' + ESC + 'H';
    let cfg = -2, cbg = -2, cat = -1;
    for (let y = 0; y < this.rows; y++) {
      out += ESC + (y + 1) + ';1H';
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const f = this.fg[i], b = this.bg[i], a = this.at[i];
        if (f !== cfg || b !== cbg || a !== cat) {
          let sgr = '0';
          if (a & A_BOLD) sgr += ';1';
          if (a & A_DIM) sgr += ';2';
          if (a & A_REV) sgr += ';7';
          if (f >= 0) sgr += tc ? `;38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255}` : `;38;5;${to256(f)}`;
          if (b >= 0) sgr += tc ? `;48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}` : `;48;5;${to256(b)}`;
          out += ESC + sgr + 'm';
          cfg = f; cbg = b; cat = a;
        }
        out += this.ch[i];
      }
      out += ESC + '0m' + ESC + 'K';
      cfg = -2; cbg = -2; cat = -1;
    }
    out += ESC + '?2026l';
    return out;
  }
  // Stream rendering: lines separated by \n, no cursor addressing (for --once).
  renderLines() {
    const tc = this.mode === 'tc';
    const lines = [];
    for (let y = 0; y < this.rows; y++) {
      let line = '';
      let cfg = -2, cbg = -2, cat = -1;
      let lastInk = -1;
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        if (this.ch[i] !== ' ' || this.bg[i] >= 0 || (this.at[i] & A_REV)) lastInk = x;
      }
      for (let x = 0; x <= lastInk; x++) {
        const i = y * this.cols + x;
        const f = this.fg[i], b = this.bg[i], a = this.at[i];
        if (f !== cfg || b !== cbg || a !== cat) {
          let sgr = '0';
          if (a & A_BOLD) sgr += ';1';
          if (a & A_DIM) sgr += ';2';
          if (a & A_REV) sgr += ';7';
          if (f >= 0) sgr += tc ? `;38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255}` : `;38;5;${to256(f)}`;
          if (b >= 0) sgr += tc ? `;48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}` : `;48;5;${to256(b)}`;
          line += ESC + sgr + 'm';
          cfg = f; cbg = b; cat = a;
        }
        line += this.ch[i];
      }
      lines.push(line + ESC + '0m');
    }
    while (lines.length && lines[lines.length - 1] === ESC + '0m') lines.pop();
    return lines.join('\n');
  }
}

const term = {
  altOn: ESC + '?1049h' + ESC + '?25l' + ESC + '2J',
  altOff: ESC + '?2026l' + ESC + '0m' + ESC + '?25h' + ESC + '?1049l',
  reset: ESC + '0m',
};

module.exports = { Screen, colorMode, to256, term, A_BOLD, A_REV, A_DIM };
