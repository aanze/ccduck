'use strict';
// Update detection and installation.
//
// Detection: reading the `package.json` of the default branch on GitHub
// (raw.githubusercontent.com, public repository, no authentication). It is the
// ONLY network call ccduck makes besides Anthropic's usage endpoint, it is
// cached for 6 h in ~/.ccduck-update.json and can be disabled entirely with
// `checkUpdates: false` in the config. Failures are silent: a network outage
// must never get in the way of the gauges.
//
// Installation: `git pull` when the command points at a clone (the
// `npm install -g <folder>` case, which creates a junction), otherwise an npm
// reinstall from the repository. Either way it is an explicit command, fired by
// a key press or `--update`, never in the background.

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = 'aanze/ccduck';
const BRANCH = 'master';
const TTL = 6 * 3600 * 1000;        // twice a day is plenty
const RETRY = 30 * 60 * 1000;       // after a failure, no retry for 30 min
const ROOT = path.join(__dirname, '..');

function statePath() {
  return process.env.CCDUCK_UPDATE_STATE || path.join(os.homedir(), '.ccduck-update.json');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return {}; }
}

function saveState(s) {
  try { fs.writeFileSync(statePath(), JSON.stringify(s)); } catch (e) { /* disque en lecture seule : tant pis */ }
}

// x.y.z version comparison — any suffix is ignored.
function cmpVer(a, b) {
  const p = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const A = p(a), B = p(b);
  for (let i = 0; i < 3; i++) {
    if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0) ? 1 : -1;
  }
  return 0;
}

function fetchLatest(timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'raw.githubusercontent.com',
      path: '/' + REPO + '/' + BRANCH + '/package.json',
      method: 'GET',
      headers: {
        'User-Agent': 'ccduck',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('http ' + res.statusCode));
        try {
          const v = JSON.parse(body).version;
          if (typeof v === 'string' && v) resolve(v);
          else reject(new Error('no version'));
        } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Known version without touching the network (cache): used for immediate rendering.
function cached(current) {
  const s = loadState();
  if (!s.latest || cmpVer(s.latest, current) <= 0) return null;
  return s.latest;
}

// Asynchronous check. Honours the cache unless `force`.
async function check(current, force) {
  const s = loadState();
  const now = Date.now();
  const age = now - (s.checkedAt || 0);
  if (!force && age < (s.err ? RETRY : TTL)) return cached(current);
  try {
    const latest = await fetchLatest(4000);
    saveState({ checkedAt: now, latest, err: null });
    return cmpVer(latest, current) > 0 ? latest : null;
  } catch (e) {
    saveState({ checkedAt: now, latest: s.latest || null, err: String((e && e.message) || 'error').slice(0, 40) });
    return cached(current);
  }
}

// How was this copy installed? A clone (npm junction included) updates through
// git; everything else through an npm reinstall.
function installKind() {
  try {
    if (fs.statSync(path.join(ROOT, '.git')).isDirectory()) return 'git';
  } catch (e) { /* pas un clone */ }
  return 'npm';
}

function updateCommand() {
  if (installKind() === 'git') {
    return { cmd: 'git', args: ['-C', ROOT, 'pull', '--ff-only'], label: 'git pull in ' + ROOT };
  }
  const url = 'git+https://github.com/' + REPO + '.git';
  return { cmd: 'npm', args: ['install', '-g', url], label: 'npm install -g ' + url };
}

// Runs the update in the foreground, output visible. Returns true on success.
function runUpdate() {
  const { cmd, args, label } = updateCommand();
  console.log('ccduck: ' + label + '\n');
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) {
    console.error('\nccduck: update failed' + (r.error ? ' (' + r.error.message + ')' : ''));
    return false;
  }
  // the cache still holds the old comparison: clear it so no stale "update
  // available" badge lingers afterwards
  saveState({ checkedAt: 0, latest: null, err: null });
  console.log('\nccduck: up to date — run the command again.');
  return true;
}

module.exports = { check, cached, runUpdate, updateCommand, installKind, cmpVer, REPO };
