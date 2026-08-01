'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Tarifs $/MTok par famille de modèle (entrée, sortie). Cache: écrit 5m = 1,25x in,
// écrit 1h = 2x in, lu = 0,1x in. Sert aux estimations "équivalent API".
const PRICING = {
  fable:  { i: 10, o: 50 },
  opus:   { i: 5,  o: 25 },
  sonnet: { i: 3,  o: 15 },
  haiku:  { i: 1,  o: 5 },
  autre:  { i: 5,  o: 25 },
};

const DEFAULTS = {
  metric: 'cost',            // 'cost' (éq. API $) | 'total' (tous tokens) | 'billable' (hors cache lu)
  historyDays: 35,           // fenêtre d'historique parsée (calibrage des limites auto)
  refreshSec: 10,
  fps: 10,
  alert: 70,                 // seuil alerte (%)
  panic: 90,                 // seuil panique (%)
  premiumFamily: 'auto',     // 'auto' | 'fable' | 'opus'
  premiumShare: 0.5,         // part de l'enveloppe hebdo allouée au modèle premium (formule d'estimation)
  planUsageDir: null,        // dossier contenant plan-usage-history.json (si %APPDATA%\Claude est inaccessible)
  weeklyReset: null,         // null = fenêtre glissante 7j, sinon {weekday:0-6 (0=dim), hour:0-23}
  planLabel: '',             // affiché dans l'en-tête si renseigné (ex: "Max 20x")
  // Limites par jauge, dans l'unité de la métrique ('auto' = pic historique observé).
  limits: { session: 'auto', day: 'auto', week: 'auto', premium: 'auto' },
  showTable: true,
  checkUpdates: true,        // vérifie une fois par demi-journée si une version plus récente existe
  autoReauth: false,         // renouveler soi-même le token OAuth expiré (touche `a`) — voir src/auth.js
};

function configPath() {
  return path.join(os.homedir(), '.ccduck.json');
}

function load(overridePath) {
  const p = overridePath || configPath();
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* pas de config: valeurs par défaut */ }
  const cfg = { ...DEFAULTS, ...user, limits: { ...DEFAULTS.limits, ...(user.limits || {}) } };
  cfg.configPath = p;
  return cfg;
}

// Répertoires de données Claude Code à scanner.
function claudeProjectDirs(env) {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  if (env.CLAUDE_CONFIG_DIR) add(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  add(path.join(os.homedir(), '.claude', 'projects'));
  add(path.join(os.homedir(), '.config', 'claude', 'projects'));
  return dirs.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

module.exports = { load, DEFAULTS, PRICING, claudeProjectDirs, configPath };
