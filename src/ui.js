'use strict';
// Mise en page et rendu : en-tête, jauges, zone du canard (pixels demi-blocs),
// débit, tableau par modèle, pied de page. Conçu pour un panneau étroit (>= 56 col).

const { A_BOLD, A_REV, A_DIM } = require('./ansi');
const { SPR_W, SPR_H, PAL, SEED, PILL_A, PILL_B, POOP, POOP_TOP, POOP_OLD, POOP_LIFE, CURRENT } = require('./duck');
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

function levelOf(worstPct, cfg) {
  if (worstPct >= cfg.panic) return 'panic';
  if (worstPct >= cfg.alert) return 'alert';
  if (worstPct < 30) return 'zen';
  return 'calm';
}

// Géométrie d'une ligne de jauge selon la largeur.
function meterLayout(cols) {
  const labelW = cols < 62 ? 5 : 11;
  let figsW = 0;
  if (cols >= 88) figsW = 20;
  else if (cols >= 70) figsW = 12;
  const resetW = 10;
  const barW = Math.max(8, cols - labelW - 5 - (figsW ? figsW + 1 : 0) - resetW - 4);
  return { labelW, figsW, resetW, barW, barX0: labelW + 1 };
}

// Positions des pointes de jauges + jauge qui pilote l'humeur du canard.
// La jauge premium (fable/opus) ne déclenche jamais la vraie panique : les autres
// modèles restent utilisables, on plafonne sa sévérité à l'alerte (douce).
const RANK = { zen: 0, calm: 1, alert: 2, panic: 3 };
function metersGeometry(snap, cols, cfg) {
  const L = meterLayout(cols);
  let worst = null;
  const tips = snap.meters.map((m, idx) => {
    const pct = Math.max(0, m.pct);
    const fill = Math.min(1, pct / 100) * L.barW;
    const tip = L.barX0 + Math.max(0, Math.min(L.barW - 1, Math.floor(fill)));
    let eff = levelOf(pct, cfg);
    if (m.key === 'premium' && eff === 'panic') eff = 'alert';
    if (!worst || RANK[eff] > RANK[worst.eff] || (RANK[eff] === RANK[worst.eff] && pct > worst.pct)) {
      worst = { pct, tip, label: m.label, idx, eff, key: m.key };
    }
    return tip;
  });
  return {
    L, tips, worst,
    level: worst ? worst.eff : 'calm',
    soft: !!(worst && worst.key === 'premium'),
  };
}

function drawMeter(scr, y, m, L, cfg, blinkOn, isWorst) {
  const lbl = L.labelW <= 5 ? clip(m.label, 4) : m.label;
  const pct = Math.max(0, m.pct);
  const lblColor = isWorst && pct >= cfg.alert ? pctColor(pct, cfg) : C.text;
  const lblAt = isWorst && pct >= cfg.alert ? A_BOLD : 0;
  scr.text(1, y, padR(lbl, L.labelW - 1), lblColor, null, lblAt);

  // barre avec fraction sub-cellule
  const color = pctColor(pct, cfg);
  const fill = Math.min(1, pct / 100) * L.barW;
  const full = Math.floor(fill);
  const frac = Math.round((fill - full) * 8);
  for (let i = 0; i < L.barW; i++) {
    const x = L.barX0 + i;
    if (i < full) scr.set(x, y, '█', color);
    else if (i === full && frac > 0) scr.set(x, y, PARTIALS[Math.min(6, frac - 1)], color);
    else scr.set(x, y, '·', C.barEmpty);
  }
  let x = L.barX0 + L.barW + 1;
  const pctAt = pct >= cfg.panic && !blinkOn ? A_DIM : A_BOLD;
  scr.text(x, y, fmtPct(pct), color, null, pctAt);
  x += 5;
  if (L.figsW) {
    // % toujours canonique (coût pondéré) ; la métrique ne change que ces chiffres
    let figs;
    if (m.official) figs = '• ' + fmtMetric(m.used, snapMetric); // % officiel, dépense estimée à côté
    else if (m.limit == null || snapMetric !== 'cost') figs = (m.auto ? '≈ ' : '') + fmtMetric(m.used, snapMetric);
    else figs = fmtCost(m.used) + '/' + (m.auto ? '≈' : '') + fmtCost(m.limit);
    if (L.figsW >= 20 && snapMetric === 'cost') figs += ' · ' + fmtTok(m.tokens);
    scr.text(x, y, padR(clip(figs, L.figsW), L.figsW), C.dim);
    x += L.figsW + 1;
  }
  const reset = m.resetText != null ? m.resetText : (m.resetSec != null ? '↺ ' + fmtDur(m.resetSec) : '');
  scr.text(x, y, padR(clip(reset, L.resetW), L.resetW), C.faint);
  if (isWorst && pct >= cfg.panic && blinkOn) scr.text(Math.min(scr.cols - 2, x + L.resetW), y, '◀', C.red, null, A_BOLD);
}

let snapMetric = 'cost'; // unité courante pour fmtMetric (évite de la passer partout)

// Compose les pixels du canard + particules dans les cellules [top .. top+rowsN-1].
function drawCanvas(scr, top, rowsN, duckInfo, t) {
  const W = scr.cols;
  const H = rowsN * 2;
  const px = new Int32Array(W * H).fill(-1);
  const baseY = H - SPR_H;
  const { rows, mirror, x, yOff } = duckInfo;
  // graines (sous le canard : il nage dessus et les picore)
  for (const s of duckInfo.seeds || []) {
    const sx = Math.round(s.x), sy = baseY + Math.round(s.y);
    if (sx >= 0 && sx < W && sy >= 0 && sy < H) px[sy * W + sx] = SEED;
  }
  // gélules bicolores (2 px : rouge + blanc)
  for (const p of duckInfo.pills || []) {
    const sx = Math.round(p.x), sy = baseY + Math.round(p.y);
    if (sy >= 0 && sy < H) {
      if (sx >= 0 && sx < W) px[sy * W + sx] = PILL_A;
      if (sx + 1 >= 0 && sx + 1 < W) px[sy * W + sx + 1] = PILL_B;
    }
  }
  // crottes en dérive : petit monticule 2 px de large, sommet plus clair ;
  // semi-immergé (une seule rangée, foncée) juste avant de couler
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
  for (let ry = 0; ry < rowsN; ry++) {
    for (let cx = 0; cx < W; cx++) {
      const topC = px[(ry * 2) * W + cx];
      const botC = px[(ry * 2 + 1) * W + cx];
      if (topC < 0 && botC < 0) continue;
      if (topC >= 0 && botC >= 0) {
        if (topC === botC) scr.set(cx, top + ry, '█', topC);
        else scr.set(cx, top + ry, '▀', topC, botC);
      } else if (topC >= 0) scr.set(cx, top + ry, '▀', topC);
      else scr.set(cx, top + ry, '▄', botC);
    }
  }
  // particules par-dessus (rel:false = ancrées à l'eau, pas au canard qui oscille)
  for (const p of duckInfo.particles) {
    const pxY = baseY + (p.rel === false ? 0 : yOff) + p.y;
    const cy = top + Math.floor(pxY / 2);
    const cx = Math.round(p.x);
    if (cy >= top && cy < top + rowsN && cx >= 0 && cx < W) scr.set(cx, cy, p.ch, p.fg);
  }
}

function drawWater(scr, y, t, duckX) {
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

  // ---- répartition verticale ----
  // fixe: header(1) sep(1) meters(3) ind(1) bubble(1) canvas(n) water(1) sep(1) stats(1) footer(1)
  let canvasRows = 6;
  let tableRows = 0;
  const famCount = Math.min(4, Object.keys(snap.byFamDay).length || 1);
  const baseNeed = 11; // tout sauf canvas et tableau
  if (ui.showTable && rows >= baseNeed + canvasRows + 1 + famCount + 1) tableRows = 1 + famCount;
  let spare = rows - (baseNeed + canvasRows + tableRows);
  if (spare < 0) { canvasRows = Math.max(6, canvasRows + spare); spare = 0; }
  canvasRows += Math.min(2, Math.max(0, spare)); // le canard respire si l'écran est haut
  const geo = metersGeometry(snap, cols, cfg);

  // ---- en-tête ----
  let y = 0;
  scr.text(1, y, ' CCDUCK ', C.title, null, A_REV | A_BOLD);
  let hx = 10;
  const sub = 'Claude tokens' + (cfg.planLabel ? ' · ' + cfg.planLabel : '');
  scr.text(hx, y, clip(sub, cols - hx - 20), C.dim);
  if (ui.demoLabel) scr.text(hx + sub.length + 1, y, ' ' + ui.demoLabel + ' ', C.red, null, A_REV | A_BOLD);
  const ago = snap.lastScanAt ? Math.max(0, Math.round((Date.now() - snap.lastScanAt) / 1000)) : null;
  const right = fmtClock(new Date()) + (ago != null ? ' · upd ' + ago + 's' : '');
  scr.text(cols - right.length - 1, y, right, C.faint);
  y++;
  scr.hline(y++, 0, cols - 1, '─', C.faint);

  // ---- jauges ----
  for (let i = 0; i < snap.meters.length; i++) {
    drawMeter(scr, y, snap.meters[i], geo.L, cfg, blinkOn, geo.worst && geo.worst.idx === i);
    y++;
  }

  // ---- indicateur + canard ----
  const indY = y, bubbleY = y + 1, canvasTop = y + 2;
  if (geo.worst && geo.worst.pct >= cfg.alert) {
    const col = pctColor(geo.worst.pct, cfg);
    const show = geo.worst.pct >= cfg.panic ? blinkOn : true;
    if (show) scr.set(geo.worst.tip, indY, '▲', col, null, A_BOLD);
    // pointillés entre la pointe et le canard quand il est dessous
    const duckCx = state.duckInfo.x + SPR_W / 2;
    if (Math.abs(duckCx - geo.worst.tip) < 3 && geo.worst.pct >= cfg.panic && blinkOn) {
      scr.set(geo.worst.tip, bubbleY, '¦', col);
    }
  }
  drawBubble(scr, bubbleY, state.duckInfo, state.bubble, blinkOn);
  drawCanvas(scr, canvasTop, canvasRows, state.duckInfo, tSec);
  const waterY = canvasTop + canvasRows;
  drawWater(scr, waterY, tSec, state.duckInfo.x);
  y = waterY + 1;
  scr.hline(y++, 0, cols - 1, '─', C.faint);

  // ---- débit / projection ----
  if (ui.loading) {
    scr.text(1, y, `scanning transcripts… ${ui.loading.done}/${ui.loading.total}`, C.dim);
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

  // ---- tableau par modèle ----
  if (tableRows > 0 && !ui.loading) {
    drawTable(scr, y, snap, cols, famCount);
    y += tableRows;
  }

  // ---- pied de page ----
  const fy = rows - 1;
  if (snap.lastError) {
    scr.text(1, fy, clip('⚠ ' + snap.lastError, cols - 2), C.red);
  } else {
    const keys = '[q]uit [f]eed [s]edate [r]efresh [m]etric:' + ui.metricLabel + ' [c]table [d]emo' + (ui.paused ? ' ▮▮' : '');
    const bits = [];
    if (snap.officialUsed) {
      const age = Date.now() - snap.officialAt;
      bits.push('• /usage' + (age > 30 * 60 * 1000 ? ' (' + fmtDur(age / 1000) + ' old — open Claude Code)' : ''));
    }
    if (snap.meters.some((m) => m.auto)) bits.push('≈ auto (' + cfg.historyDays + 'd)');
    else if (!snap.officialUsed) bits.push('limits: config');
    if (snap.officialErr && snap.meters.some((m) => !m.official)) {
      bits.push('usage: ' + snap.officialErr + (snap.officialRetryIn > 0 ? ' (retry ' + fmtDur(snap.officialRetryIn / 1000) + ')' : ''));
    }
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
  // canard une ligne sur l'eau
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
