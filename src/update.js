'use strict';
// Détection et application des mises à jour.
//
// Détection : lecture du `package.json` de la branche par défaut sur GitHub
// (raw.githubusercontent.com, dépôt public, aucune authentification). C'est le
// SEUL appel réseau de ccduck en dehors de l'endpoint d'usage d'Anthropic, il
// est mis en cache 6 h dans ~/.ccduck-update.json et se coupe entièrement avec
// `checkUpdates: false` dans la config. Un échec est silencieux : jamais une
// panne réseau ne doit gêner l'affichage des jauges.
//
// Application : `git pull` quand la commande pointe sur un clone (cas de
// `npm install -g <dossier>`, qui crée une jonction), sinon réinstallation
// npm depuis le dépôt. Dans les deux cas c'est une commande explicite, lancée
// par une touche ou `--update`, jamais en tâche de fond.

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = 'aanze/ccduck';
const BRANCH = 'master';
const TTL = 6 * 3600 * 1000;        // une vérification par demi-journée suffit
const RETRY = 30 * 60 * 1000;       // après un échec, on ne réessaie pas avant 30 min
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

// Comparaison de versions x.y.z — suffixe éventuel ignoré.
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

// Version connue sans toucher au réseau (cache) : sert au rendu immédiat.
function cached(current) {
  const s = loadState();
  if (!s.latest || cmpVer(s.latest, current) <= 0) return null;
  return s.latest;
}

// Vérification asynchrone. Respecte le cache sauf si `force`.
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

// Comment cette copie a-t-elle été installée ? Un clone (jonction npm comprise)
// se met à jour par git ; tout le reste par réinstallation npm.
function installKind() {
  try {
    if (fs.statSync(path.join(ROOT, '.git')).isDirectory()) return 'git';
  } catch (e) { /* pas un clone */ }
  return 'npm';
}

function updateCommand() {
  if (installKind() === 'git') {
    return { cmd: 'git', args: ['-C', ROOT, 'pull', '--ff-only'], label: 'git pull dans ' + ROOT };
  }
  const url = 'git+https://github.com/' + REPO + '.git';
  return { cmd: 'npm', args: ['install', '-g', url], label: 'npm install -g ' + url };
}

// Lance la mise à jour en avant-plan, sortie visible. Retourne true si OK.
function runUpdate() {
  const { cmd, args, label } = updateCommand();
  console.log('ccduck: ' + label + '\n');
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) {
    console.error('\nccduck: la mise à jour a échoué' + (r.error ? ' (' + r.error.message + ')' : ''));
    return false;
  }
  // le cache porte encore l'ancienne comparaison : on le vide pour ne pas
  // rester avec une pastille « mise à jour dispo » après coup
  saveState({ checkedAt: 0, latest: null, err: null });
  console.log('\nccduck: à jour — relance la commande.');
  return true;
}

module.exports = { check, cached, runUpdate, updateCommand, installKind, cmpVer, REPO };
