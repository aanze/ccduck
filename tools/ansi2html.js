'use strict';
// Converts an ANSI (SGR) stream to HTML, to preview ccduck renderings.
// Usage: node tools/ansi2html.js < capture.txt > preview.html

const CUBE = [0, 95, 135, 175, 215, 255];
function xterm256(n) {
  if (n < 16) return ['#000','#c33','#3c3','#cc3','#33c','#c3c','#3cc','#ccc','#666','#f66','#6f6','#ff6','#66f','#f6f','#6ff','#fff'][n];
  if (n < 232) { const i = n - 16; const r = CUBE[Math.floor(i / 36)], g = CUBE[Math.floor(i / 6) % 6], b = CUBE[i % 6]; return rgb(r, g, b); }
  const v = 8 + (n - 232) * 10; return rgb(v, v, v);
}
function rgb(r, g, b) { return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const DEF_FG = '#d6d9de', DEF_BG = '#0e1116';

function convert(input) {
  let out = '';
  let fg = null, bg = null, bold = false, dim = false, rev = false;
  const flushOpen = () => {
    let f = fg || DEF_FG, b = bg;
    if (rev) { const t = f; f = b || DEF_BG; b = t; }
    let style = 'color:' + f;
    if (b) style += ';background:' + b;
    if (bold) style += ';font-weight:bold';
    if (dim) style += ';opacity:.55';
    return '<span style="' + style + '">';
  };
  let open = flushOpen();
  out += open;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '\x1b' && input[i + 1] === '[') {
      let j = i + 2;
      while (j < input.length && !/[a-zA-Z]/.test(input[j])) j++;
      const body = input.slice(i + 2, j), cmd = input[j];
      i = j + 1;
      if (cmd !== 'm') continue; // ignore positioning/erasing
      const ps = body.split(';').map(Number);
      for (let k = 0; k < ps.length; k++) {
        const p = ps[k] || 0;
        if (p === 0) { fg = null; bg = null; bold = false; dim = false; rev = false; }
        else if (p === 1) bold = true;
        else if (p === 2) dim = true;
        else if (p === 7) rev = true;
        else if (p === 38 || p === 48) {
          let col = null;
          if (ps[k + 1] === 5) { col = xterm256(ps[k + 2]); k += 2; }
          else if (ps[k + 1] === 2) { col = rgb(ps[k + 2], ps[k + 3], ps[k + 4]); k += 4; }
          if (p === 38) fg = col; else bg = col;
        }
      }
      out += '</span>' + flushOpen();
      continue;
    }
    out += esc(c);
    i++;
  }
  out += '</span>';
  return '<!doctype html><meta charset="utf-8"><title>ccduck preview</title><body style="background:' + DEF_BG +
    ';margin:14px"><pre style="font-family:Cascadia Mono,Consolas,monospace;font-size:13px;line-height:1.15;color:' +
    DEF_FG + '">' + out + '</pre></body>';
}

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => process.stdout.write(convert(buf)));
