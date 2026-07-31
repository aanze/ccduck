'use strict';
// Formatage compact (anglais) pour l'affichage terminal.

function fmtTok(n) {
  if (!isFinite(n) || n < 0) n = 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return trim1(n / 1e3) + 'k';
  if (n < 1e9) return trim1(n / 1e6) + 'M';
  return trim1(n / 1e9) + 'G';
}

function trim1(x) {
  const s = x >= 100 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toFixed(1);
  return s.replace(/\.0$/, '');
}

function fmtCost(n) {
  if (!isFinite(n) || n < 0) n = 0;
  if (n < 10) return '$' + (Math.round(n * 100) / 100).toFixed(2);
  if (n < 100) return '$' + (Math.round(n * 10) / 10).toFixed(1);
  return '$' + String(Math.round(n));
}

// Valeur d'une métrique dans l'unité de la jauge.
function fmtMetric(n, metric) {
  return metric === 'cost' ? fmtCost(n) : fmtTok(n);
}

function fmtDur(sec) {
  if (!isFinite(sec) || sec < 0) return '—';
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return d + 'd' + (h > 0 ? h + 'h' : '');
  if (h > 0) return h + 'h' + String(m).padStart(2, '0');
  if (m > 0) return m + 'min';
  return sec + 's';
}

function fmtClock(d) {
  const p = (x) => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtPct(p) {
  if (!isFinite(p)) return ' —%';
  return String(Math.round(p)).padStart(3) + '%';
}

// Tronque avec … si trop long.
function clip(s, w) {
  if (s.length <= w) return s;
  if (w <= 1) return s.slice(0, Math.max(0, w));
  return s.slice(0, w - 1) + '…';
}

function padR(s, w) { return s.length >= w ? clip(s, w) : s + ' '.repeat(w - s.length); }
function padL(s, w) { return s.length >= w ? clip(s, w) : ' '.repeat(w - s.length) + s; }

module.exports = { fmtTok, fmtCost, fmtMetric, fmtDur, fmtClock, fmtPct, clip, padR, padL };
