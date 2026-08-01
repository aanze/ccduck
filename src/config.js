'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// $/MTok rates per model family (input, output). Cache: 5m write = 1.25x in,
// 1h write = 2x in, read = 0.1x in. Used for "API-equivalent" estimates.
const PRICING = {
  fable:  { i: 10, o: 50 },
  opus:   { i: 5,  o: 25 },
  sonnet: { i: 3,  o: 15 },
  haiku:  { i: 1,  o: 5 },
  autre:  { i: 5,  o: 25 },
};

const DEFAULTS = {
  metric: 'cost',            // 'cost' (API-equivalent $) | 'total' (every token) | 'billable' (cache reads excluded)
  historyDays: 35,           // how much history is parsed (auto-limit calibration)
  refreshSec: 10,
  fps: 10,
  alert: 70,                 // alert threshold (%)
  panic: 90,                 // panic threshold (%)
  premiumFamily: 'auto',     // 'auto' | 'fable' | 'opus'
  premiumShare: 0.5,         // share of the weekly envelope for the premium model (estimation formula)
  planUsageDir: null,        // folder holding plan-usage-history.json (when %APPDATA%\Claude is unreachable)
  weeklyReset: null,         // null = rolling 7-day window, otherwise {weekday:0-6 (0=Sunday), hour:0-23}
  planLabel: '',             // shown in the header when set (e.g. "Max 20x")
  // Per-gauge limits, in the metric's unit ('auto' = observed historical peak).
  limits: { session: 'auto', day: 'auto', week: 'auto', premium: 'auto' },
  showTable: true,
  checkUpdates: true,        // checks twice a day whether a newer version exists
  autoReauth: false,         // renew the expired OAuth token ourselves (the `a` key) — see src/auth.js
};

function configPath() {
  return path.join(os.homedir(), '.ccduck.json');
}

function load(overridePath) {
  const p = overridePath || configPath();
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* no config: defaults */ }
  const cfg = { ...DEFAULTS, ...user, limits: { ...DEFAULTS.limits, ...(user.limits || {}) } };
  cfg.configPath = p;
  return cfg;
}

// Claude Code data folders to scan.
function claudeProjectDirs(env) {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  if (env.CLAUDE_CONFIG_DIR) add(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  add(path.join(os.homedir(), '.claude', 'projects'));
  add(path.join(os.homedir(), '.config', 'claude', 'projects'));
  return dirs.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

module.exports = { load, DEFAULTS, PRICING, claudeProjectDirs, configPath };
