'use strict';
// Layout and rendering: header, gauges, duck area (half-block pixels), burn
// rate, per-model table, footer. Built for a narrow panel (>= 56 col).

const { A_BOLD, A_REV, A_DIM } = require('./ansi');
const { SPR_W, SPR_H, PAL, SEED, PILL_A, PILL_B, POOP, POOP_TOP, POOP_OLD, POOP_LIFE, CURRENT, BITE_REGEN } = require('./duck');
const { TOWER_W, towerBaseX, towerPx } = require('./cat');
const { fmtMetric, fmtTok, fmtDur, fmtClock, fmtPct, clip, padR, padL, fmtCost } = require('./format');

const C = {
  title: 0xFFD21E,
  text: 0xD6D9DE,
  dim: 0x8A8F98,
  faint: 0x565B63,
  green: 0x4CC38A,
  yellow: 0xE7C000,
  orange: 0xFF8A00,
  red: 0xFF5555,
  barEmpty: 0x3A3F47,
  water1: 0x2AA9DB,
  water2: 0x18719C,
  cyan: 0x7FD4F5,
};

const PARTIALS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function pctColor(pct, cfg) {
  if (pct >= cfg.panic) return C.red;
  if (pct >= cfg.alert) return C.orange;
  if (pct >= 50) return C.yellow;
  return C.green;
}

// WEEK and the premium family fill over seven days; the session block resets
// within hours. The same percentage is not the same news, so they get their own,
// higher thresholds. Called without a key (the exported helper), it answers for
// the session — the strictest reading.
const WEEKLY = new Set(['week', 'premium']);
function levelOf(worstPct, cfg, key) {
  const weekly = WEEKLY.has(key);
  const panic = weekly && cfg.weeklyPanic != null ? cfg.weeklyPanic : cfg.panic;
  const alert = weekly && cfg.weeklyAlert != null ? cfg.weeklyAlert : cfg.alert;
  if (worstPct >= panic) return 'panic';
  if (worstPct >= alert) return 'alert';
  if (worstPct < 30) return 'zen';
  return 'calm';
}

// Geometry of a gauge line, depending on the width.
function meterLayout(cols) {
  const labelW = cols < 62 ? 5 : 11;
  let figsW = 0;
  if (cols >= 88) figsW = 20;
  else if (cols >= 70) figsW = 12;
  const resetW = 10;
  const barW = Math.max(8, cols - labelW - 5 - (figsW ? figsW + 1 : 0) - resetW - 4);
  return { labelW, figsW, resetW, barW, barX0: labelW + 1 };
}

// Gauge tip positions + the gauge that drives the duck's mood.
// The premium gauge (fable/opus) never triggers real panic: the other models
// stay usable, so its severity is capped at (soft) alert.
const RANK = { zen: 0, calm: 1, alert: 2, panic: 3 };
function metersGeometry(snap, cols, cfg) {
  const L = meterLayout(cols);
  let worst = null;
  const alerts = [];
  const tips = snap.meters.map((m, idx) => {
    const pct = Math.max(0, m.pct == null ? 0 : m.pct);
    const fill = Math.min(1, pct / 100) * L.barW;
    const tip = L.barX0 + Math.max(0, Math.min(L.barW - 1, Math.floor(fill)));
    let eff = levelOf(pct, cfg, m.key);
    if (m.key === 'premium' && eff === 'panic') eff = 'alert';
    const e = { pct, tip, label: m.label, idx, eff, key: m.key };
    if (RANK[eff] >= RANK.alert) alerts.push(e);
    // At equal severity a premium gauge steps aside: its panic is deliberately
    // softened (the other models stay usable), so it must not mask a global
    // limit, which will block everything.
    const better = !worst || RANK[eff] > RANK[worst.eff]
      || (RANK[eff] === RANK[worst.eff] && worst.key === 'premium' && m.key !== 'premium')
      || (RANK[eff] === RANK[worst.eff] && (worst.key === 'premium') === (m.key === 'premium') && pct > worst.pct);
    if (better) worst = e;
    return tip;
  });
  // most severe first: that is the order the duck handles them in
  alerts.sort((a, b) => (RANK[b.eff] - RANK[a.eff]) || (b.pct - a.pct));
  // Alerts switched off: it simply never notices. Its mood is capped at calm —
  // zen still applies when everything really is green, since being relaxed
  // about low usage is not the same thing as reacting to a threshold — and with
  // no worst gauge there is nothing to point at and no marker to draw. Every
  // other behaviour is untouched, and the gauges are still read and coloured.
  if (cfg.alerts === false) {
    const quiet = worst && RANK[worst.eff] <= RANK.calm ? worst.eff : 'calm';
    return { L, tips, worst: null, alerts: [], level: quiet, soft: false };
  }
  return {
    L, tips, worst, alerts,
    level: worst ? worst.eff : 'calm',
    // A weekly gauge short of its panic threshold points in short bursts with
    // long breaks, rather than monopolising the animal: there are days left to
    // do something about it. Premium was already softened this way, and stays
    // so at every level since its panic is capped to alert above.
    soft: !!(worst && WEEKLY.has(worst.key) && worst.eff !== 'panic'),
  };
}

// A bite in a bar: a clean hole first, then a very gradual refill (░ ▒ ▓) —
// the swiss cheese has to stay visible for a good while.
function biteChar(age) {
  const k = age / BITE_REGEN;
  if (k < 0.3) return null;
  if (k < 0.55) return '░';
  if (k < 0.8) return '▒';
  return '▓';
}

function drawMeter(scr, y, m, L, cfg, blinkOn, isWorst, bites, t) {
  const lbl = L.labelW <= 5 ? clip(m.label, 4) : m.label;
  // pct null = we do not know: empty bar and "—", never a made-up figure
  if (m.pct == null) {
    scr.text(1, y, padR(lbl, L.labelW - 1), C.dim);
    for (let i = 0; i < L.barW; i++) scr.set(L.barX0 + i, y, '·', C.barEmpty);
    scr.text(L.barX0 + L.barW + 1, y, '  —', C.dim);
    let x = L.barX0 + L.barW + 6;
    if (L.figsW) {
      scr.text(x, y, padR(clip('no official data', L.figsW), L.figsW), C.faint);
      x += L.figsW + 1;
    }
    const rst = m.resetSec != null ? (m.resetEst ? '≈ ' : '↺ ') + fmtDur(m.resetSec) : '';
    scr.text(x, y, padR(clip(rst, L.resetW), L.resetW), C.faint);
    return;
  }
  const pct = Math.max(0, m.pct);
  const lblColor = isWorst && pct >= cfg.alert ? pctColor(pct, cfg) : C.text;
  const lblAt = isWorst && pct >= cfg.alert ? A_BOLD : 0;
  scr.text(1, y, padR(lbl, L.labelW - 1), lblColor, null, lblAt);

  // bar with a sub-cell fraction
  const color = pctColor(pct, cfg);
  const fill = Math.min(1, pct / 100) * L.barW;
  const full = Math.floor(fill);
  const frac = Math.round((fill - full) * 8);
  for (let i = 0; i < L.barW; i++) {
    const x = L.barX0 + i;
    const born = bites && bites.get(i);
    if (i < full && born !== undefined) {
      // the duck has been here
      const ch = biteChar((t || 0) - born);
      if (ch === null) scr.set(x, y, '·', C.barEmpty);
      else scr.set(x, y, ch, color, null, A_DIM);
    }
    else if (i < full) scr.set(x, y, '█', color);
    else if (i === full && frac > 0) scr.set(x, y, PARTIALS[Math.min(6, frac - 1)], color);
    else scr.set(x, y, '·', C.barEmpty);
  }
  let x = L.barX0 + L.barW + 1;
  const pctAt = pct >= cfg.panic && !blinkOn ? A_DIM : A_BOLD;
  scr.text(x, y, fmtPct(pct), color, null, pctAt);
  x += 5;
  if (L.figsW) {
    // % always canonical (weighted cost); the metric only changes these figures
    let figs;
    if (m.official) figs = '• ' + fmtMetric(m.used, snapMetric); // official %, estimated spend next to it
    else if (m.limit == null || snapMetric !== 'cost') figs = (m.auto ? '≈ ' : '') + fmtMetric(m.used, snapMetric);
    else figs = fmtCost(m.used) + '/' + (m.auto ? '≈' : '') + fmtCost(m.limit);
    if (L.figsW >= 20 && snapMetric === 'cost') figs += ' · ' + fmtTok(m.tokens);
    scr.text(x, y, padR(clip(figs, L.figsW), L.figsW), C.dim);
    x += L.figsW + 1;
  }
  // ↺ = the reset time Anthropic gave us, ≈ = derived from the active block here
  const reset = m.resetText != null ? m.resetText
    : (m.resetSec != null ? (m.resetEst ? '≈ ' : '↺ ') + fmtDur(m.resetSec) : '');
  scr.text(x, y, padR(clip(reset, L.resetW), L.resetW), C.faint);
  if (isWorst && pct >= cfg.panic && blinkOn) scr.text(Math.min(scr.cols - 2, x + L.resetW), y, '◀', C.red, null, A_BOLD);
}

let snapMetric = 'cost'; // current unit for fmtMetric (saves passing it everywhere)

// Composes the duck pixels + particles into the cells [top .. top+rowsN-1].
// `lift` = how many rows ABOVE the pond the duck is allowed to occupy (it only
// uses that to go and strike a bar). The pixel buffer grows upwards by that
// much; the waterline itself does not move.
function drawCanvas(scr, top, rowsN, duckInfo, t, lift) {
  const W = scr.cols;
  const extra = Math.max(0, lift || 0);
  const rowsTotal = rowsN + extra;
  const yTop = top - extra;
  const H = rowsTotal * 2;
  const px = new Int32Array(W * H).fill(-1);
  const baseY = H - SPR_H;
  const { rows, mirror, x, yOff } = duckInfo;
  const innerH = rowsN * 2;   // height of the pond itself, without the lift rows
  // cat mode: the tower stands as scenery on the right — drawn first, so the
  // cat and everything else passes in front of it
  if (duckInfo.pet === 'cat') {
    const tp = towerPx(innerH);
    const tx = towerBaseX(W);
    const y0 = H - tp;
    const put = (X, Y, c) => { if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = c; };
    // top platform (2 px thick), central post, feet
    for (let X = tx; X < tx + TOWER_W; X++) { put(X, y0, PAL.N); put(X, y0 + 1, PAL.n); }
    for (let Y = y0 + 2; Y < H; Y++) { put(tx + 4, Y, PAL.n); put(tx + 5, Y, PAL.n); }
    for (let X = tx + 2; X < tx + TOWER_W - 2; X++) put(X, H - 1, PAL.N);
  }
  // the fly, one grey pixel buzzing about (its jitter is its wings)
  if (duckInfo.fly) {
    const fx = Math.round(duckInfo.fly.x), fy = baseY + Math.round(duckInfo.fly.y);
    if (fx >= 0 && fx < W && fy >= 0 && fy < H) px[fy * W + fx] = 0xB9BEC7;
  }
  // seeds (under the duck: it swims over them and pecks them)
  for (const s of duckInfo.seeds || []) {
    const sx = Math.round(s.x), sy = baseY + Math.round(s.y);
    if (sx >= 0 && sx < W && sy >= 0 && sy < H) px[sy * W + sx] = SEED;
  }
  // two-tone pills (2 px: red + white)
  for (const p of duckInfo.pills || []) {
    const sx = Math.round(p.x), sy = baseY + Math.round(p.y);
    if (sy >= 0 && sy < H) {
      if (sx >= 0 && sx < W) px[sy * W + sx] = PILL_A;
      if (sx + 1 >= 0 && sx + 1 < W) px[sy * W + sx + 1] = PILL_B;
    }
  }
  // drifting droppings: a small mound 2 px wide, lighter on top;
  // half-sunk (a single darker row) just before going under
  for (const p of duckInfo.poops || []) {
    const sx = Math.round(p.x), sy = baseY + SPR_H - 1;
    const old = (duckInfo.t - p.born) > POOP_LIFE - 12;
    const put = (X, Y, c) => { if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = c; };
    if (old) {
      put(sx, sy, POOP_OLD); put(sx + 1, sy, POOP_OLD);
    } else {
      put(sx, sy, POOP); put(sx + 1, sy, POOP);
      put(sx, sy - 1, POOP_TOP);
    }
  }
  for (let r = 0; r < SPR_H; r++) {
    const line = rows[r];
    for (let c = 0; c < SPR_W; c++) {
      const ch = line[mirror ? SPR_W - 1 - c : c];
      if (ch === '.') continue;
      const col = PAL[ch];
      const pxX = x + c, pxY = baseY + yOff + r;
      if (pxX < 0 || pxX >= W || pxY < 0 || pxY >= H) continue;
      px[pxY * W + pxX] = col;
    }
  }
  for (let ry = 0; ry < rowsTotal; ry++) {
    for (let cx = 0; cx < W; cx++) {
      const topC = px[(ry * 2) * W + cx];
      const botC = px[(ry * 2 + 1) * W + cx];
      if (topC < 0 && botC < 0) continue;
      if (topC >= 0 && botC >= 0) {
        if (topC === botC) scr.set(cx, yTop + ry, '█', topC);
        else scr.set(cx, yTop + ry, '▀', topC, botC);
      } else if (topC >= 0) scr.set(cx, yTop + ry, '▀', topC);
      else scr.set(cx, yTop + ry, '▄', botC);
    }
  }
  // particles on top (rel:false = anchored to the water, not to the bobbing duck)
  for (const p of duckInfo.particles) {
    const pxY = baseY + (p.rel === false ? 0 : yOff) + p.y;
    const cy = yTop + Math.floor(pxY / 2);
    const cx = Math.round(p.x);
    if (cy >= yTop && cy < top + rowsN && cx >= 0 && cx < W) scr.set(cx, cy, p.ch, p.fg);
  }
}

// Shower: procedural drops, the same way the water works — no state to store,
// everything derives from the drop index and time. Drawn last: the rain passes
// in front of the duck, and drops reaching the water splash.
function rainHash(i) {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15; x = (x * 2246822519) >>> 0; x ^= x >>> 13;
  return x >>> 0;
}
function drawRain(scr, top, rowsN, waterY, strength, t) {
  if (!(strength > 0)) return;
  const W = scr.cols;
  const span = rowsN + 1;                       // from the top of the pond down to the waterline
  const n = Math.round(W * 0.2 * strength);
  for (let i = 0; i < n; i++) {
    const x0 = rainHash(i) % W;
    const speed = 9 + (rainHash(i + 101) % 7);  // lignes/s
    const phase = (rainHash(i + 7919) % 997) / 997;
    const y = Math.floor(((t * speed / span + phase) % 1) * span);
    if (y >= span - 1) { scr.set(x0, waterY, '∘', C.cyan); continue; }
    const x = ((x0 - (y >> 1)) % W + W) % W;    // the path follows the slope of the glyph
    scr.set(x, top + y, '╱', i % 3 === 0 ? C.cyan : C.water1, null, i % 2 ? A_DIM : 0);
  }
}

function drawWater(scr, y, t, duckX, pet) {
  // The cat lives on dry land: a plain floor instead of the pond. The glyph is
  // top-aligned (▔, not ▁) because the paws end at the bottom of the row above:
  // a bottom-aligned floor left a whole empty cell under them, and the cat — and
  // its tower, which stands on the same line — read as floating one row up.
  if (pet === 'cat') {
    for (let x = 0; x < scr.cols; x++) {
      scr.set(x, y, '▔', (x % 7 === 3) ? 0x7A8B5A : 0x565B63, null, A_DIM);
    }
    return;
  }
  for (let x = 0; x < scr.cols; x++) {
    const phase = (x + Math.floor(t * CURRENT)) % 8;
    const near = Math.abs(x - (duckX + SPR_W / 2)) < 4;
    scr.set(x, y, near ? '≈' : '~', phase < 4 ? C.water1 : C.water2, null, near ? 0 : A_DIM);
  }
}

function drawBubble(scr, y, duckInfo, bubble, blinkOn) {
  if (!bubble) return;
  const txt = ' ' + clip(bubble.text, scr.cols - 6) + ' ';
  const cx = duckInfo.x + SPR_W / 2;
  let x0 = Math.round(cx - txt.length / 2);
  x0 = Math.max(0, Math.min(scr.cols - txt.length, x0));
  let fg = C.title;
  if (bubble.style === 'alert') fg = C.orange;
  if (bubble.style === 'panic') fg = blinkOn ? C.red : C.title;
  scr.text(x0, y, txt, fg, null, A_REV | A_BOLD);
  const tailX = Math.max(x0, Math.min(x0 + txt.length - 1, Math.round(cx)));
  scr.set(tailX, y + 1, '▾', fg);
}

function drawTable(scr, y, snap, cols, maxRows) {
  const wide = cols >= 78;
  const cw = wide ? [8, 5, 7, 7, 8, 8, 8] : [8, 5, 7, 7, 8];
  const heads = wide ? ['today', 'msgs', 'in', 'out', 'cache w', 'cache r', 'API $']
    : ['today', 'msgs', 'in', 'out', 'API $'];
  let x = 1;
  heads.forEach((h, i) => { scr.text(x, y, padR(h, cw[i]), C.faint, null, A_BOLD); x = x + cw[i] + 1; });
  const fams = Object.entries(snap.byFamDay).sort((a, b) => b[1].cost - a[1].cost).slice(0, maxRows);
  fams.forEach(([fam, s], r) => {
    let vals;
    if (wide) vals = [fam, String(s.n), fmtTok(s.i), fmtTok(s.o), fmtTok(s.cw), fmtTok(s.cr), fmtCost(s.cost)];
    else vals = [fam, String(s.n), fmtTok(s.i), fmtTok(s.o), fmtCost(s.cost)];
    let xx = 1;
    vals.forEach((v, i) => {
      scr.text(xx, y + 1 + r, i === 0 ? padR(v, cw[i]) : padL(v, cw[i]), i === 0 ? C.text : C.dim);
      xx += cw[i] + 1;
    });
  });
  return 1 + fams.length;
}

// state: {snap, duckInfo, bubble, cfg, tSec, blinkOn, ui}
// ui: {demoLabel, loading, paused, showTable, metricLabel}
function draw(scr, state) {
  const { snap, cfg, tSec, blinkOn, ui } = state;
  snapMetric = snap.metric;
  scr.clear();
  const cols = scr.cols, rows = scr.rows;

  if (rows < 17 || cols < 46) return drawMini(scr, state);

  // ---- vertical layout ----
  // fixe: header(1) sep(1) meters(3) ind(1) bubble(1) canvas(n) water(1) sep(1) stats(1) footer(1)
  let canvasRows = 6;
  let tableRows = 0;
  const famCount = Math.min(4, Object.keys(snap.byFamDay).length || 1);
  const baseNeed = 11; // tout sauf canvas et tableau
  if (ui.showTable && rows >= baseNeed + canvasRows + 1 + famCount + 1) tableRows = 1 + famCount;
  let spare = rows - (baseNeed + canvasRows + tableRows);
  if (spare < 0) { canvasRows = Math.max(6, canvasRows + spare); spare = 0; }
  canvasRows += Math.min(2, Math.max(0, spare)); // the duck gets room to breathe on a tall screen
  const geo = metersGeometry(snap, cols, cfg);

  // ---- header ----
  let y = 0;
  scr.text(1, y, ' CCDUCK ', C.title, null, A_REV | A_BOLD);
  const ver = 'v' + (ui.version || '?');
  scr.text(10, y, ver, C.faint);
  let hx = 10 + ver.length + 1; // space before the subtitle
  // update available: offered, never forced (the u key)
  if (ui.update) {
    const up = '→ v' + ui.update + ' [u]';
    scr.text(hx, y, up, C.green, null, A_BOLD);
    hx += up.length + 1;
  }
  const sub = 'Claude tokens' + (cfg.planLabel ? ' · ' + cfg.planLabel : '');
  scr.text(hx, y, clip(sub, cols - hx - 20), C.dim);
  if (ui.demoLabel) scr.text(hx + sub.length + 1, y, ' ' + ui.demoLabel + ' ', C.red, null, A_REV | A_BOLD);
  // age of the OFFICIAL data (not of the transcript rescan): that is what the
  // gauges carry, so that is the freshness worth showing
  // The Claude app samples every 5 min: an age under 8 min is normal.
  const usageAge = snap.officialAt ? Math.round((Date.now() - snap.officialAt) / 1000) : null;
  const stale = usageAge == null || usageAge > 8 * 60;
  const right = fmtClock(new Date())
    + (usageAge != null ? ' · usage ' + fmtDur(usageAge) + (stale ? ' ⚠' : '') : '');
  scr.text(cols - right.length - 1, y, right, stale ? C.orange : C.faint);
  y++;
  scr.hline(y++, 0, cols - 1, '─', C.faint);

  // ---- jauges ----
  // holes left by the starving duck: column -> bite time, the most recent one
  // wins (biting the same spot again reopens the hole)
  const metersTop = y;
  const biteMap = new Map();
  for (const b of (state.duckInfo.bites || [])) {
    let mm = biteMap.get(b.m);
    if (!mm) { mm = new Map(); biteMap.set(b.m, mm); }
    const prev = mm.get(b.i);
    if (prev === undefined || b.born > prev) mm.set(b.i, b.born);
  }
  for (let i = 0; i < snap.meters.length; i++) {
    drawMeter(scr, y, snap.meters[i], geo.L, cfg, blinkOn, geo.worst && geo.worst.idx === i,
      biteMap.get(i), state.duckInfo.t);
    y++;
  }

  // ---- marker + duck ----
  const indY = y, bubbleY = y + 1, canvasTop = y + 2;
  // one marker per gauge in alert, not just the worst one: when several limits
  // are closing in, they all have to be visible
  for (const a of geo.alerts) {
    const col = pctColor(a.pct, cfg);
    const show = a.eff === 'panic' ? blinkOn : true;   // only real panic blinks
    if (show) scr.set(a.tip, indY, '▲', col, null, A_BOLD);
    // dotted line between the marker and the duck when it stands below
    const duckCx = state.duckInfo.x + SPR_W / 2;
    if (Math.abs(duckCx - a.tip) < 3 && a.eff === 'panic' && blinkOn) scr.set(a.tip, bubbleY, '¦', col);
  }
  drawBubble(scr, bubbleY, state.duckInfo, state.bubble, blinkOn);
  // Raid: it leaves the water to go and strike the bar. We grow the drawing
  // area upwards by exactly what is needed, and lift it in proportion to
  // `reach` — at 1, its beak lands exactly on the gauge line.
  const peck = state.duckInfo.peck;
  let duckInfo = state.duckInfo, lift = 0;
  if (peck && peck.reach > 0) {
    // at rest the top of the sprite (12 px = 6 lines) sits on this row:
    // the distance between it and the bar is what it has to clear
    const headRow = canvasTop + canvasRows - 6;
    lift = Math.max(0, headRow - (metersTop + peck.m));
    duckInfo = { ...duckInfo, yOff: duckInfo.yOff - Math.round(peck.reach * lift * 2) };
  }
  // cat on its tower: lift it to the platform (the tower height adapts to the
  // canvas so the overflow is always 2 rows — the bubble and marker lines)
  if (duckInfo.towerLift > 0) {
    const tp = towerPx(canvasRows * 2);
    duckInfo = { ...duckInfo, yOff: duckInfo.yOff - Math.round(duckInfo.towerLift * (tp - 1)) };
    lift = Math.max(lift, 2);
  }
  drawCanvas(scr, canvasTop, canvasRows, duckInfo, tSec, lift);
  const waterY = canvasTop + canvasRows;
  drawWater(scr, waterY, tSec, state.duckInfo.x, state.duckInfo.pet);
  drawRain(scr, canvasTop, canvasRows, waterY, state.duckInfo.rain || 0, tSec);
  // crumbs torn off the bars: they fall from the gauge down to the pond,
  // where the seed physics takes over (and where it pecks them)
  const FALL = 0.7;
  for (const b of (state.duckInfo.bites || [])) {
    const age = (state.duckInfo.t || 0) - b.born;
    if (age < 0 || age > FALL) continue;
    const fromY = metersTop + b.m;
    const cy = Math.round(fromY + (age / FALL) * (canvasTop - fromY));
    const cx = geo.L.barX0 + b.i;
    if (cy > fromY && cy < canvasTop && cx >= 0 && cx < cols) scr.set(cx, cy, '·', SEED);
  }
  y = waterY + 1;
  scr.hline(y++, 0, cols - 1, '─', C.faint);

  // ---- burn rate / projection ----
  if (ui.loading) {
    scr.text(1, y, `scanning transcripts… ${ui.loading.done}/${ui.loading.total}`, C.dim);
  } else if (snap.diag) {
    // no official source: we show what THIS process sees, here and now
    scr.text(1, y, 'no usage source reachable from this process:', C.orange, null, A_BOLD);
    let dy = y + 1;
    for (const f of snap.diag.files) {
      if (dy >= rows - 1) break;
      const okish = /old,/.test(f.state);
      scr.text(2, dy, padR(clip(f.state, 18), 19), okish ? C.green : C.red);
      scr.text(21, dy, clip(f.path, cols - 22), C.dim);
      dy++;
    }
    if (dy < rows - 1) {
      scr.text(2, dy, 'oauth token: ' + snap.diag.token + (snap.diag.apiErr ? '  ·  api: ' + snap.diag.apiErr : ''), C.dim);
    }
    return geoOut(geo);
  } else if (!snap.hasData) {
    scr.text(1, y, 'no Claude Code data found in ~/.claude/projects', C.orange);
  } else {
    const parts = [];
    parts.push('today ' + fmtMetric(snap.day.val, snap.metric));
    parts.push('burn ' + (snap.metric === 'cost' ? fmtCost(snap.burnPerMin * 60) + '/h' : fmtTok(snap.burnTokPerMin) + ' tok/min'));
    if (snap.metric === 'cost') parts.push(fmtTok(snap.burnTokPerMin) + ' tok/min');
    if (snap.projPct != null) parts.push('proj. block ' + Math.round(snap.projPct) + '%');
    parts.push('msgs today ' + snap.day.n + (snap.day.n ? ' (agents ' + Math.round((snap.day.side / snap.day.n) * 100) + '%)' : ''));
    scr.text(1, y, clip(parts.join('  ·  '), cols - 2), C.dim);
  }
  y++;

  // ---- per-model table ----
  if (tableRows > 0 && !ui.loading) {
    drawTable(scr, y, snap, cols, famCount);
    y += tableRows;
  }

  // ---- pied de page ----
  const fy = rows - 1;
  if (snap.lastError) {
    scr.text(1, fy, clip('⚠ ' + snap.lastError, cols - 2), C.red);
  } else {
    const keys = '[q]uit [f]eed [s]edate [r]efresh [m]etric:' + ui.metricLabel + ' [c]table [d]emo'
      + ' [x]pet:' + (state.duckInfo.pet === 'cat' ? 'cat' : 'duck')
      + ' [k]skin:' + (state.duckInfo.pet === 'cat' ? (cfg.catSkin || 'brown') : (cfg.duckSkin || 'classic'))
      + ' [z]alerts:' + (cfg.alerts === false ? 'off' : 'on')
      + ' [a]uth:' + (cfg.autoReauth ? 'auto' : 'off') + (ui.paused ? ' ▮▮' : '');
    const bits = [];
    // the source actually kept: app (local Claude file), api, or VS Code cache
    if (snap.officialUsed) bits.push('• src:' + (snap.officialSrc || '?'));
    else bits.push('no official data — run: ccduck --debug-usage');
    if (!snap.planSeen) bits.push('app file: ' + (snap.planErr || 'not found'));
    if (snap.meters.some((m) => m.auto)) bits.push('≈ auto (' + cfg.historyDays + 'd)');
    else if (!snap.officialUsed) bits.push('limits: config');
    // the API error only matters when the displayed figures are going stale
    const usageAge = snap.officialAt ? (Date.now() - snap.officialAt) / 1000 : Infinity;
    if (snap.officialErr && usageAge > 8 * 60) bits.push('usage: ' + snap.officialErr);
    const lim = bits.join(' · ');
    scr.text(1, fy, clip(keys + '  ·  ' + lim, cols - 2), C.faint);
  }
  return geo;
}

function drawMini(scr, state) {
  const { snap, cfg, tSec, blinkOn, ui } = state;
  const cols = scr.cols, rows = scr.rows;
  const geo = metersGeometry(snap, cols, cfg);
  let y = 0;
  scr.text(0, y, ' CCDUCK ', C.title, null, A_REV | A_BOLD);
  const right = fmtClock(new Date());
  scr.text(cols - right.length - 1, y, right, C.faint);
  y++;
  for (let i = 0; i < snap.meters.length && y < rows - 2; i++, y++) {
    drawMeter(scr, y, snap.meters[i], geo.L, cfg, blinkOn, geo.worst && geo.worst.idx === i);
  }
  // the duck on a single line of water
  if (y < rows) {
    for (let x = 0; x < cols; x++) scr.set(x, y, '~', (x + Math.floor(tSec * CURRENT)) % 8 < 4 ? C.water1 : C.water2, null, A_DIM);
    for (const s of state.duckInfo.seeds || []) {
      if (s.landed) scr.set(Math.round(s.x), y, '∙', SEED);
    }
    for (const p of state.duckInfo.pills || []) {
      if (p.landed) { scr.set(Math.round(p.x), y, '∙', PILL_A); scr.set(Math.round(p.x) + 1, y, '∙', PILL_B); }
    }
    for (const p of state.duckInfo.poops || []) scr.set(Math.round(p.x), y, '∙', POOP);
    const d = state.duckInfo;
    const body = d.mirror ? '(°)>' : '<(°)';
    let art = body;
    if (geo.level === 'panic') art = blinkOn ? '<(°!' : '!°)>';
    const x0 = Math.max(0, Math.min(cols - art.length, Math.round(d.x)));
    scr.text(x0, y, art, C.title, null, A_BOLD);
    if (state.bubble && y > 0) {
      const t = clip(' ' + state.bubble.text + ' ', cols);
      scr.text(Math.max(0, Math.min(cols - t.length, x0 - 2)), y - 1 >= 5 ? y - 1 : y, t, C.title, null, A_REV);
    }
  }
  return geo;
}

module.exports = { draw, metersGeometry, levelOf, C };
