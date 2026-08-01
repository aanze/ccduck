'use strict';
// Lecture des transcripts Claude Code (~/.claude/projects/**/*.jsonl) et agrégats.
// Chaque ligne "assistant" porte message.usage ; on déduplique par message.id+requestId
// (les reprises de session recopient des messages) et on garde la dernière occurrence.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const tls = require('tls');
const { PRICING, claudeProjectDirs } = require('./config');

const H5 = 5 * 3600 * 1000;
const D7 = 7 * 86400 * 1000;

// ---- Compteurs officiels /usage ----
// Source primaire : l'endpoint OAuth qu'utilise Claude Code lui-même
// (GET https://api.anthropic.com/api/oauth/usage, Bearer = token local de
// ~/.claude/.credentials.json). Même mécanisme que les statuslines communautaires.
// Le token ne quitte jamais la machine autrement que vers api.anthropic.com.
// Renvoie {token, expiresAt, mtime}. On NE touche JAMAIS au refreshToken : chez
// Anthropic il tourne à chaque usage, l'utiliser déconnecterait Claude Code.
// On se contente de suivre le fichier : dès que Claude Code renouvelle le token,
// le mtime change et on repart immédiatement.
function readOAuthCreds(env) {
  const paths = [];
  if (env.CLAUDE_CONFIG_DIR) paths.push(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'));
  paths.push(path.join(os.homedir(), '.claude', '.credentials.json'));
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const o = j.claudeAiOauth || j;
      if (o && typeof o.accessToken === 'string' && o.accessToken) {
        return { token: o.accessToken, expiresAt: Number(o.expiresAt) || 0, mtime: st.mtimeMs };
      }
    } catch (e) { /* absent : on retombera sur cache/estimation */ }
  }
  // macOS : Claude Code range le token dans le Trousseau, pas dans un fichier
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execSync(
        'security find-generic-password -s "Claude Code-credentials" -w',
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      ).toString().trim();
      const j = JSON.parse(out);
      const o = j.claudeAiOauth || j;
      if (o && typeof o.accessToken === 'string' && o.accessToken) {
        return { token: o.accessToken, expiresAt: Number(o.expiresAt) || 0, mtime: 0 };
      }
    } catch (e) { /* trousseau vide/refusé */ }
  }
  return null;
}

// État persisté des compteurs officiels : survit aux relances de ccduck, pour
// réafficher la dernière valeur connue ET respecter le backoff (l'endpoint 429
// sévèrement — chaque relance ne doit PAS refaire un appel à froid).
// CCDUCK_STATE permet de dérouter l'état (tests : ne jamais écrire dans le vrai fichier)
function officialStatePath() {
  return process.env.CCDUCK_STATE || path.join(os.homedir(), '.ccduck-usage.json');
}

function loadOfficialState() {
  const base = { data: null, premium: null, fetchedAt: 0, nextTryAt: 0, lastErr: null, fails: 0, inFlight: false };
  try {
    const j = JSON.parse(fs.readFileSync(officialStatePath(), 'utf8'));
    return { ...base, data: j.data || null, premium: j.premium || null,
      fetchedAt: j.fetchedAt || 0, nextTryAt: j.nextTryAt || 0, lastErr: j.lastErr || null };
  } catch (e) { return base; }
}

// Adopte les compteurs du disque s'ils sont plus frais que ceux en mémoire :
// plusieurs ccduck peuvent tourner en parallèle, et une instance en échec ne doit
// JAMAIS réécrire ses vieux chiffres par-dessus ceux qu'une autre vient d'obtenir.
function adoptDiskIfNewer(o) {
  try {
    const d = JSON.parse(fs.readFileSync(officialStatePath(), 'utf8'));
    if ((d.fetchedAt || 0) > (o.fetchedAt || 0)) {
      o.data = d.data || null;
      o.premium = d.premium || null;
      o.fetchedAt = d.fetchedAt || 0;
      return true;
    }
  } catch (e) { /* pas d'état sur disque */ }
  return false;
}

function saveOfficialState(o) {
  try {
    adoptDiskIfNewer(o); // garde-fou anti-régression
    fs.writeFileSync(officialStatePath(), JSON.stringify({
      data: o.data, premium: o.premium, fetchedAt: o.fetchedAt, nextTryAt: o.nextTryAt, lastErr: o.lastErr,
    }));
  } catch (e) { /* disque plein/verrouillé : tant pis, on garde l'état mémoire */ }
}

// Connexion neuve à chaque appel (pas de pool) : dans un process qui tourne des
// heures, une socket TLS gardée en vie et coupée par un proxy/pare-feu fait
// échouer tous les appels suivants. On ajoute aussi les CA du magasin système
// (proxy d'entreprise qui ré-signe le trafic) sans jamais désactiver la vérification.
let usageAgent = null;
function getAgent() {
  if (usageAgent) return usageAgent;
  const opts = { keepAlive: false };
  try {
    if (typeof tls.getCACertificates === 'function') {
      const sys = tls.getCACertificates('system') || [];
      if (sys.length) opts.ca = [...(tls.getCACertificates('default') || []), ...sys];
    }
  } catch (e) { /* Node sans cette API : CA par défaut */ }
  usageAgent = new https.Agent(opts);
  return usageAgent;
}

function fetchUsage(token, userAgent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      agent: getAgent(),
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': userAgent,
        'Connection': 'close',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

// SOURCE LA PLUS FIABLE : l'app Claude enregistre son propre relevé d'usage toutes
// les 5 min dans plan-usage-history.json — `fh` = session 5 h, `sd` = hebdo (en %).
// Aucun token, aucun appel réseau : ni 401 ni 429 possibles.
// Fichiers candidats, dans l'ordre de préférence.
function planUsageFiles(env, cfg) {
  const out = [];
  const addFile = (f) => { if (f && !out.includes(f)) out.push(f); };
  let home = null;
  try { home = os.homedir(); } catch (e) { /* ignore */ }
  // Miroir dans le home : seule voie quand le terminal n'a pas accès au dossier
  // de l'application (cf. --debug-usage). Alimenté par `ccduck --mirror`.
  if (home) addFile(path.join(home, '.ccduck-plan.json'));
  for (const d of planUsageDirs(env, cfg)) addFile(path.join(d, 'plan-usage-history.json'));
  return out;
}

// L'app Claude est distribuée en paquet MSIX : ce que l'on voit sous
// %APPDATA%\Claude n'est qu'une VUE VIRTUALISÉE, réservée aux processus portant
// la même identité de paquet. Un shell lancé par une autre application packagée
// (Windows Terminal, panneau terminal) reçoit sa propre vue et ne voit donc
// rien — d'où des ENOENT permanents. Le fichier physique, lui, vit sous
// %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude et reste lisible
// depuis n'importe quel shell : c'est le chemin à privilégier.
let msixCache = null;
function msixClaudeDirs(env) {
  if (msixCache) return msixCache;
  const out = [];
  const roots = [env.LOCALAPPDATA, path.join(os.homedir(), 'AppData', 'Local')];
  for (const r of roots) {
    if (!r) continue;
    const pkgRoot = path.join(r, 'Packages');
    let names = [];
    try { names = fs.readdirSync(pkgRoot); } catch (e) { continue; }
    for (const n of names) {
      if (!/claude|anthropic/i.test(n)) continue;
      out.push(path.join(pkgRoot, n, 'LocalCache', 'Roaming', 'Claude'));
      out.push(path.join(pkgRoot, n, 'LocalCache', 'Local', 'Claude'));
    }
    if (out.length) break;
  }
  msixCache = out;
  return out;
}

function planUsageDirs(env, cfg) {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  // chemin physique MSIX en tête : il fonctionne quel que soit le shell
  for (const d of msixClaudeDirs(env)) add(d);
  // 1) chemin explicite (config planUsageDir ou variable CCDUCK_CLAUDE_DIR)
  add(env.CCDUCK_CLAUDE_DIR);
  if (cfg && cfg.planUsageDir) add(cfg.planUsageDir);
  // 2) jonction dans le home : contourne un terminal qui n'a pas accès à %APPDATA%\Claude
  try { add(path.join(os.homedir(), '.ccduck-claude')); } catch (e) { /* ignore */ }
  const roots = [env.APPDATA, env.LOCALAPPDATA];
  let home = null;
  try { home = os.homedir(); } catch (e) { /* ignore */ }
  for (const h of [home, env.USERPROFILE, env.HOME]) {
    if (!h) continue;
    roots.push(path.join(h, 'AppData', 'Roaming'), path.join(h, 'AppData', 'Local'));
  }
  for (const r of roots) if (r) { add(path.join(r, 'Claude')); add(path.join(r, 'Claude', 'Claude')); }
  for (const h of [home, env.USERPROFILE, env.HOME]) {
    if (!h) continue;
    add(path.join(h, 'Library', 'Application Support', 'Claude'));
    add(path.join(h, '.config', 'Claude'));
  }
  return dirs;
}

// L'app réécrit ce fichier toutes les 5 min : pendant l'opération il disparaît
// brièvement (ENOENT) ou se lit tronqué. Une lecture ratée ne doit JAMAIS faire
// perdre la source — d'où la double tentative ici, et le cache côté DataStore.
function readOnce(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    const t = Date.now(); while (Date.now() - t < 40) { /* fenêtre de réécriture */ }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
}

function readPlanUsage(env, cfg) {
  let why = null;
  let best = null;
  // On lit TOUS les candidats et on garde le relevé le plus récent. Prendre le
  // premier lisible ferait gagner un miroir périmé face au vrai fichier de l'app.
  for (const p of planUsageFiles(env, cfg)) {
    try {
      const j = readOnce(p);
      const arr = Array.isArray(j.samples) ? j.samples : null;
      if (!arr || !arr.length) { why = why || 'empty'; continue; }
      const last = arr[arr.length - 1];
      if (!last || !last.u) { why = why || 'no sample'; continue; }
      const u5 = typeof last.u.fh === 'number' ? last.u.fh / 100 : null;
      const u7 = typeof last.u.sd === 'number' ? last.u.sd / 100 : null;
      if (u5 == null && u7 == null) { why = why || 'no fh/sd'; continue; }
      const at = Number(last.t) || 0;
      if (best && at <= best.at) continue;
      // on garde l'historique récent : il sert à calibrer l'extrapolation
      const hist = arr.slice(-40).map((s) => ({ t: Number(s.t) || 0, fh: s.u && s.u.fh, sd: s.u && s.u.sd }));
      best = { u5h: u5, u7d: u7, at, path: p, samples: hist };
    } catch (e) {
      // ENOENT = app pas installée à cet emplacement, on continue ; le reste
      // (droits, JSON tronqué pendant une écriture) mérite d'être signalé.
      if (e && e.code !== 'ENOENT') why = String(e.code || 'parse error');
    }
  }
  if (best) return best;
  return why ? { error: why } : null;
}

// Repli : cache local écrit par l'extension VS Code / la statusline (parfois périmé).
function readOfficialUsage(env) {
  const paths = [];
  if (env.CLAUDE_CONFIG_DIR) paths.push(path.join(env.CLAUDE_CONFIG_DIR, 'vscode-claude-status-cache.json'));
  paths.push(path.join(os.homedir(), '.claude', 'vscode-claude-status-cache.json'));
  for (const p of paths) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const u = j.usageData || j;
      if (typeof u.utilization5h !== 'number' && typeof u.utilization7d !== 'number') continue;
      return {
        u5h: typeof u.utilization5h === 'number' ? u.utilization5h : null,
        u7d: typeof u.utilization7d === 'number' ? u.utilization7d : null,
        reset5h: (u.reset5hAt || 0) * 1000,
        reset7d: (u.reset7dAt || 0) * 1000,
        at: Date.parse(j.updatedAt) || 0,
      };
    } catch (e) { /* fichier absent/illisible : estimation */ }
  }
  return null;
}

function familyOf(model) {
  const m = String(model || '');
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'autre';
}

function entryCost(e) {
  const p = PRICING[e.fam] || PRICING.autre;
  return (e.i * p.i + e.o * p.o + e.cw5 * p.i * 1.25 + e.cw1 * p.i * 2 + e.cr * p.i * 0.1) / 1e6;
}

function entryMetric(e, metric) {
  if (metric === 'cost') return e.cost;
  if (metric === 'billable') return e.i + e.o + e.cw5 + e.cw1;
  return e.i + e.o + e.cw5 + e.cw1 + e.cr; // total
}

class DataStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.entries = new Map();       // clé dédup -> entrée
    this.fileState = new Map();     // chemin -> {size, offset}
    this.lastScanAt = 0;
    this.lastError = null;
    this.seq = 0;
    this.ccVersion = null;          // version de Claude Code vue dans les transcripts (pour le User-Agent)
    this.lastEntryTs = 0;           // horodatage du dernier message vu → détecte la conso en cours
    this.credsMtime = 0;            // suit le renouvellement du token par Claude Code
    this.planCache = null;          // dernier relevé lu de l'app (survit aux réécritures)
    this.official = loadOfficialState();
  }

  // Interroge l'endpoint officiel. Cadence pilotée par l'activité réelle :
  // ~45 s tant qu'on consomme (les chiffres bougent), 3 min au repos. Un raté
  // réseau ne gèle plus l'affichage — on retente à 20 s, puis 40, 80… (max 5 min).
  // Seul un 429 impose son délai (retry-after du serveur).
  async refreshOfficial(force) {
    const o = this.official;
    const now = Date.now();
    if (o.inFlight) return;
    // une autre instance a peut-être déjà rafraîchi : en profiter avant de décider
    adoptDiskIfNewer(o);

    const creds = readOAuthCreds(process.env);
    if (!creds) { o.lastErr = 'no token'; o.nextTryAt = now + 10 * 60 * 1000; saveOfficialState(o); return; }
    // Claude Code vient de renouveler le token → on repart tout de suite
    const rotated = this.credsMtime && creds.mtime && creds.mtime !== this.credsMtime;
    this.credsMtime = creds.mtime;
    if (rotated) { o.nextTryAt = 0; o.fails = 0; }

    // Token expiré : inutile de brûler du quota pour un 401 garanti. On attend que
    // Claude Code le renouvelle (surveillance du fichier, vérif toutes les 5 s).
    if (creds.expiresAt && creds.expiresAt < now + 5000 && !rotated) {
      o.lastErr = 'token expired (Claude Code will refresh)';
      o.nextTryAt = now + 5000;
      saveOfficialState(o);
      return;
    }

    if (!force && !rotated) {
      if (now < o.nextTryAt) return;
      const consuming = this.lastEntryTs > o.fetchedAt;
      if (now - o.fetchedAt < (consuming ? 25 * 1000 : 90 * 1000)) return;
    }
    o.inFlight = true;
    try {
      const res = await fetchUsage(creds.token, 'claude-code/' + (this.ccVersion || '2.1.219'), 15000);
      if (res.status === 401) {
        // token périmé côté serveur : on rebascule sur la surveillance du fichier
        o.lastErr = 'token expired (Claude Code will refresh)';
        o.fails = 0;
        o.nextTryAt = now + 8000;
        saveOfficialState(o);
        return;
      }
      if (res.status === 429) {
        // retry-after imposé par le serveur (secondes ou date HTTP) — le respecter
        // scrupuleusement : les 429 de cet endpoint s'aggravent si on insiste.
        const raw = res.headers['retry-after'] || '';
        let ra = Number(raw) * 1000;
        if (!isFinite(ra) || ra <= 0) ra = (Date.parse(raw) || 0) - now;
        o.lastErr = 'rate-limited';
        o.fails = 0;
        o.nextTryAt = now + Math.max(ra || 0, 60 * 1000); // délai imposé par le serveur
        saveOfficialState(o);
        return;
      }
      if (res.status < 200 || res.status >= 300) {
        o.lastErr = 'http ' + res.status;
        o.fails = (o.fails || 0) + 1;
        o.nextTryAt = now + Math.min(15000 * 2 ** (o.fails - 1), 120000);
        saveOfficialState(o);
        return;
      }
      const j = JSON.parse(res.body);
      const win = (v) => (v && typeof v.utilization === 'number')
        ? { pct: v.utilization / 100, reset: Date.parse(v.resets_at) || 0 } : null;
      // Source de vérité : le tableau `limits` (c'est lui que l'écran /usage affiche).
      // Repli sur les champs plats five_hour/seven_day/seven_day_* si absent.
      const lims = Array.isArray(j.limits) ? j.limits : [];
      const byKind = {};
      for (const L of lims) if (L && typeof L.percent === 'number') byKind[L.kind] = L;
      const fromLimit = (L) => L ? { pct: L.percent / 100, reset: Date.parse(L.resets_at) || 0 } : null;
      o.data = {
        five_hour: fromLimit(byKind.session) || win(j.five_hour),
        seven_day: fromLimit(byKind.weekly_all) || win(j.seven_day),
      };
      const scoped = lims.find((L) => L && L.kind === 'weekly_scoped' && typeof L.percent === 'number');
      if (scoped) {
        const dn = scoped.scope && scoped.scope.model && scoped.scope.model.display_name;
        o.premium = { name: String(dn || 'premium').toLowerCase(), pct: scoped.percent / 100, reset: Date.parse(scoped.resets_at) || 0 };
      } else {
        o.premium = null;
        for (const [k, v] of Object.entries(j)) {
          const m = /^seven_day_(.+)$/.exec(k);
          if (m && m[1] !== 'oauth_apps' && win(v)) { o.premium = { name: m[1], ...win(v) }; break; }
        }
      }
      o.raw = j; // pour --debug-usage (contient uniquement des stats, jamais le token)
      o.fetchedAt = now;
      o.nextTryAt = 0;   // la cadence est pilotée par l'activité, pas par un verrou
      o.lastErr = null;
      o.fails = 0;
      saveOfficialState(o);
    } catch (e) {
      // Diagnostic honnête : on garde le code réel plutôt que de deviner.
      const code = String((e && (e.code || (e.cause && e.cause.code))) || '');
      if (code === 'ETIMEDOUT' || (e && e.name === 'AbortError')) o.lastErr = 'timeout';
      else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) o.lastErr = 'tls ' + code.toLowerCase();
      else o.lastErr = 'net ' + (code || (e && e.message) || 'unknown').toString().toLowerCase().slice(0, 24);
      o.fails = (o.fails || 0) + 1;
      // retente vite : un raté réseau ne doit pas figer les chiffres
      o.nextTryAt = now + Math.min(20000 * 2 ** (o.fails - 1), 300000);
      saveOfficialState(o);
    } finally {
      o.inFlight = false;
    }
  }

  listFiles() {
    const cutoff = Date.now() - this.cfg.historyDays * 86400 * 1000;
    const out = [];
    for (const root of claudeProjectDirs(process.env)) {
      let subs = [];
      try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
      for (const s of subs) {
        const dir = path.join(root, s.name);
        if (!s.isDirectory()) continue;
        let files = [];
        try { files = fs.readdirSync(dir); } catch (e) { continue; }
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const p = path.join(dir, f);
          let st;
          try { st = fs.statSync(p); } catch (e) { continue; }
          if (st.mtimeMs < cutoff) continue;
          out.push({ path: p, size: st.size });
        }
      }
    }
    return out;
  }

  parseChunk(text) {
    let start = 0, added = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end === -1) end = text.length;
      const line = text.slice(start, end);
      start = end + 1;
      if (line.length < 20 || !line.includes('"assistant"') || !line.includes('"usage"')) continue;
      let j;
      try { j = JSON.parse(line); } catch (e) { continue; }
      if (j.type !== 'assistant' || !j.message || !j.message.usage) continue;
      if (j.version) this.ccVersion = j.version;
      const m = j.message;
      if (m.model === '<synthetic>') continue;
      const u = m.usage;
      const ts = Date.parse(j.timestamp);
      if (!isFinite(ts)) continue;
      const cc = u.cache_creation || null;
      const cwTot = u.cache_creation_input_tokens || 0;
      const cw1 = cc ? (cc.ephemeral_1h_input_tokens || 0) : 0;
      const cw5 = cc ? (cc.ephemeral_5m_input_tokens || 0) : Math.max(0, cwTot - cw1);
      const e = {
        ts,
        fam: familyOf(m.model),
        i: u.input_tokens || 0,
        o: u.output_tokens || 0,
        cw5: cc ? cw5 : cwTot,
        cw1,
        cr: u.cache_read_input_tokens || 0,
        side: !!j.isSidechain,
      };
      e.cost = entryCost(e);
      const key = m.id ? m.id + ':' + (j.requestId || '') : 'k' + (this.seq++);
      this.entries.set(key, e);
      if (ts > this.lastEntryTs) this.lastEntryTs = ts;
      added++;
    }
    return added;
  }

  // Générateur : traite un fichier par étape (l'appelant peut animer entre deux étapes).
  *scanSteps() {
    this.lastError = null;
    let files;
    try { files = this.listFiles(); } catch (err) { this.lastError = String(err.message || err); files = []; }
    const total = files.length;
    let done = 0;
    for (const f of files) {
      const st = this.fileState.get(f.path);
      try {
        if (!st) {
          this.parseChunk(fs.readFileSync(f.path, 'utf8'));
          this.fileState.set(f.path, { size: f.size, offset: f.size });
        } else if (f.size > st.offset) {
          // journal en append : ne lire que la fin
          const fd = fs.openSync(f.path, 'r');
          try {
            const len = f.size - st.offset;
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, st.offset);
            this.parseChunk(buf.toString('utf8'));
          } finally { fs.closeSync(fd); }
          st.offset = f.size; st.size = f.size;
        } else if (f.size < st.offset) {
          // fichier réécrit : relire en entier (les entrées se dédupliquent par clé)
          this.parseChunk(fs.readFileSync(f.path, 'utf8'));
          this.fileState.set(f.path, { size: f.size, offset: f.size });
        }
      } catch (err) {
        this.lastError = path.basename(f.path) + ': ' + String(err.message || err);
      }
      done++;
      yield { done, total };
    }
    this.lastScanAt = Date.now();
  }

  scanSync() { for (const _ of this.scanSteps()) { /* tout d'un coup */ } }

  // ---- agrégats ----

  sorted() {
    return [...this.entries.values()].sort((a, b) => a.ts - b.ts);
  }

  snapshot(now, metric) {
    const cfg = this.cfg;
    const es = this.sorted();
    const zero = () => ({ n: 0, i: 0, o: 0, cw: 0, cr: 0, cost: 0, val: 0, side: 0 });
    const acc = (a, e) => {
      a.n++; a.i += e.i; a.o += e.o; a.cw += e.cw5 + e.cw1; a.cr += e.cr;
      a.cost += e.cost; a.val += entryMetric(e, metric); if (e.side) a.side++;
    };

    // Blocs de 5h (ancrés à l'heure pleine UTC du premier message, style ccusage)
    const blocks = [];
    let cur = null;
    for (const e of es) {
      if (!cur || e.ts >= cur.end || e.ts - cur.lastTs > H5) {
        const start = Math.floor(e.ts / 3600000) * 3600000;
        cur = { start, end: start + H5, lastTs: e.ts, sum: zero() };
        blocks.push(cur);
      }
      acc(cur.sum, e);
      cur.lastTs = e.ts;
    }
    const active = blocks.length && now < blocks[blocks.length - 1].end ? blocks[blocks.length - 1] : null;

    // Source de vérité : l'endpoint /usage (mêmes chiffres que l'écran de Claude
    // Code, bucket Fable compris). Le cache local `vscode-claude-status-cache.json`
    // n'est utilisé que s'il est PLUS RÉCENT que la dernière réponse API — sur les
    // postes où l'extension VS Code ne tourne pas, il fige et ment de plusieurs
    // heures. Par fenêtre, la donnée la plus fraîche gagne ; jamais de mélange.
    const od = this.official;
    const cacheU = readOfficialUsage(process.env);
    // Cache : une lecture ratée (fichier en cours de réécriture) ne doit pas faire
    // disparaître la source — on garde le dernier échantillon lu, il porte sa
    // propre date et reste soumis à la règle de fraîcheur.
    const planRaw = readPlanUsage(process.env, cfg);
    if (planRaw && planRaw.at) this.planCache = planRaw;
    const plan = (planRaw && planRaw.at) ? planRaw : (this.planCache || null);
    const planErr = plan ? null : ((planRaw && planRaw.error) || 'not found');
    // Un relevé est valable si sa fenêtre court encore, ou s'il est très récent
    // (les échantillons de l'app n'embarquent pas l'heure de reset).
    // Règle dure : un relevé de plus de 15 min n'est PLUS considéré comme officiel.
    // Mieux vaut basculer honnêtement en estimation ≈ que d'afficher un chiffre
    // périmé avec un point « officiel » — c'est ce qui figeait les jauges.
    const MAXAGE = 15 * 60 * 1000;
    const collect = (src, pct, reset, at) =>
      (pct != null && at && now - at < MAXAGE && (!reset || reset > now))
        ? [{ src, pct, reset: reset || 0, at }] : [];
    const best = (arr) => arr.sort((a, b) => b.at - a.at)[0] || null;

    // L'app n'échantillonne que toutes les 5 min : entre deux relevés, le compteur
    // affiché retarde d'autant. On comble avec la conso réellement observée dans les
    // transcripts, convertie en points de pourcentage grâce à un facteur calibré sur
    // l'historique de l'app lui-même (aucune valeur inventée : Δ% mesuré / Δcoût mesuré).
    const costBetween = (t0, t1) => {
      let c = 0;
      for (const e of es) if (e.ts > t0 && e.ts <= t1) c += e.cost;
      return c;
    };
    const calibrate = (samples, field) => {
      if (!Array.isArray(samples) || samples.length < 3) return 0;
      let dPct = 0, dCost = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        if (typeof a[field] !== 'number' || typeof b[field] !== 'number') continue;
        const dp = b[field] - a[field];
        if (dp <= 0) continue;                    // reset de fenêtre ou palier : on ignore
        const dc = costBetween(a.t, b.t);
        if (dc <= 0) continue;
        dPct += dp; dCost += dc;
      }
      return dCost > 0 ? dPct / dCost : 0;        // points de % par dollar équivalent
    };
    const extrapolate = (sel, field) => {
      if (!sel || sel.src !== 'app' || !plan || !plan.samples) return null;
      const factor = calibrate(plan.samples, field);
      if (!factor) return null;
      const since = costBetween(sel.at, now);
      if (since <= 0) return null;
      return Math.min(100, sel.pct * 100 + since * factor);
    };
    const api5 = od.data && od.data.five_hour, api7 = od.data && od.data.seven_day;
    const s5 = best([
      ...collect('api', api5 && api5.pct, api5 && api5.reset, od.fetchedAt),
      ...collect('vscode', cacheU && cacheU.u5h, cacheU && cacheU.reset5h, cacheU && cacheU.at),
      ...collect('app', plan && plan.u5h, 0, plan && plan.at),
    ]);
    const s7 = best([
      ...collect('api', api7 && api7.pct, api7 && api7.reset, od.fetchedAt),
      ...collect('vscode', cacheU && cacheU.u7d, cacheU && cacheU.reset7d, cacheU && cacheU.at),
      ...collect('app', plan && plan.u7d, 0, plan && plan.at),
    ]);
    // heure de reset : la meilleure connue, même si le pourcentage vient d'ailleurs
    const knownReset = (...v) => v.find((x) => x && x > now) || 0;
    const reset5 = knownReset(s5 && s5.reset, api5 && api5.reset, cacheU && cacheU.reset5h);
    const reset7 = knownReset(s7 && s7.reset, api7 && api7.reset, cacheU && cacheU.reset7d);

    // Fable : seule l'API expose ce compteur. Si l'hebdo a bougé depuis le dernier
    // relevé Fable, on l'ajuste dans la même proportion (marqué ≈).
    // même règle de fraîcheur que les autres jauges : un relevé Fable de plusieurs
    // heures ne doit pas s'afficher comme officiel
    let offPrem = od.premium && od.premium.reset > now && now - od.fetchedAt < MAXAGE
      ? { ...od.premium } : null;
    let premEstimated = false;
    if (offPrem && s7 && api7 && api7.pct > 0 && s7.at > od.fetchedAt + 60000) {
      const ratio = s7.pct / api7.pct;
      if (isFinite(ratio) && ratio > 1 && ratio < 3) {
        offPrem.pct = Math.min(1, offPrem.pct * ratio);
        premEstimated = true;
      }
    }
    const off = {
      u5h: s5 ? s5.pct : null, reset5h: reset5,
      u7d: s7 ? s7.pct : null, reset7d: reset7,
      at: Math.max(s5 ? s5.at : 0, s7 ? s7.at : 0),
    };
    const off5 = off.u5h != null;
    const off7 = off.u7d != null;

    // Fenêtres jour / semaine
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const dayStart = midnight.getTime();
    let weekStart, weekReset = null;
    if (off7 && off.reset7d > now) {
      // fenêtre hebdo officielle
      weekStart = off.reset7d - D7;
      weekReset = off.reset7d;
    } else if (cfg.weeklyReset && typeof cfg.weeklyReset.weekday === 'number') {
      const d = new Date(now);
      d.setHours(cfg.weeklyReset.hour || 0, 0, 0, 0);
      let delta = (d.getDay() - cfg.weeklyReset.weekday + 7) % 7;
      d.setDate(d.getDate() - delta);
      if (d.getTime() > now) d.setDate(d.getDate() - 7);
      weekStart = d.getTime();
      weekReset = weekStart + 7 * 86400 * 1000;
    } else {
      weekStart = now - 7 * 86400 * 1000;
    }

    // Famille premium suivie par la 3e jauge (nom officiel prioritaire)
    let premiumFam = cfg.premiumFamily;
    if (offPrem) premiumFam = offPrem.name;
    else if (premiumFam === 'auto') {
      const recent = now - 14 * 86400 * 1000;
      premiumFam = es.some((e) => e.fam === 'fable' && e.ts > recent) ? 'fable'
        : es.some((e) => e.fam === 'opus' && e.ts > recent) ? 'opus' : 'fable';
    }

    const day = zero(), week = zero(), premium = zero(), hour = zero();
    const byFamDay = {};
    const hourAgo = now - 3600 * 1000;
    const rollStart = now - D7; // fenêtre glissante 7 j — celle de la formule cccat
    const roll = { prem: 0, tot: 0, premCost: 0, totCost: 0 };
    for (const e of es) {
      if (e.ts >= dayStart) {
        acc(day, e);
        acc(byFamDay[e.fam] = byFamDay[e.fam] || zero(), e);
      }
      if (e.ts >= weekStart) {
        acc(week, e);
        if (e.fam === premiumFam) acc(premium, e);
      }
      if (e.ts >= rollStart) {
        const tok = e.i + e.o + e.cw5 + e.cw1 + e.cr;
        roll.tot += tok; roll.totCost += e.cost;
        if (e.fam === premiumFam) { roll.prem += tok; roll.premCost += e.cost; }
      }
      if (e.ts >= hourAgo) acc(hour, e);
    }

    // Maxima historiques pour les limites auto — TOUJOURS en coût pondéré, quelle
    // que soit la métrique d'affichage : les pourcentages estimés sont canoniques
    // (la touche m ne change que l'unité des chiffres, jamais les %).
    let maxBlock = 0;
    for (const b of blocks) if (b !== active) maxBlock = Math.max(maxBlock, b.sum.cost);
    // Semaine glissante max : somme sur fenêtre de 168h par pas d'une heure.
    // On exclut les 7 derniers jours : seules les périodes révolues calibrent la
    // limite auto (sinon la fenêtre courante est son propre max → 100 % permanent).
    const winCutoff = now - 7 * 86400 * 1000;
    const maxWin = (filter) => {
      const hours = new Map();
      for (const e of es) {
        if (e.ts > winCutoff) continue;
        if (filter && !filter(e)) continue;
        const h = Math.floor(e.ts / 3600000);
        hours.set(h, (hours.get(h) || 0) + e.cost);
      }
      const keys = [...hours.keys()].sort((a, b) => a - b);
      let best = 0;
      for (const k of keys) {
        let s = 0;
        for (const k2 of keys) if (k2 > k - 168 && k2 <= k) s += hours.get(k2);
        best = Math.max(best, s);
      }
      return best;
    };
    const maxWeek = maxWin(null);
    const maxPremium = maxWin((e) => e.fam === premiumFam);

    const floors = { session: 5, week: 40, premium: 20 }; // dollars (éq. API)
    // Limite auto = pic des périodes révolues, avec 15 % de marge au-dessus de la
    // fenêtre courante : battre son record affiche ~87 %, jamais un faux 100 %.
    const lim = (key, observed, current) => {
      const c = cfg.limits[key];
      if (typeof c === 'number' && c > 0) return { v: c, auto: false };
      return { v: Math.max(observed, (current || 0) * 1.15, floors[key]), auto: true };
    };

    // 3 jauges, alignées sur les limites réelles d'Anthropic : bloc 5h, hebdo
    // globale, hebdo premium. `official` = pourcentage exact issu de /usage ;
    // sinon estimation locale vs limite auto (marquée ≈). Pas de jauge "jour" :
    // cette limite n'existe pas (le total du jour vit dans la ligne de stats).
    const meters = [];
    const push = (key, label, used, usedCost, tokens, limit, resetSec, resetText, official) => {
      meters.push({
        key, label, used, tokens,
        limit: official ? null : limit.v,       // dollars (éq. API)
        auto: official ? false : limit.auto,
        official: !!official,
        pct: official ? official.pct : (limit.v > 0 ? (usedCost / limit.v) * 100 : 0),
        resetSec, resetText,
      });
    };
    // RÈGLE : sans relevé officiel frais, on n'invente RIEN — pct = null, la jauge
    // affiche « — ». Un pourcentage calculé sur des pics historiques n'a aucun
    // rapport avec les quotas réels et induit en erreur.
    const unknown = (key, label, used, tokens, resetSec) => meters.push({
      key, label, used, tokens, limit: null, auto: false, official: false,
      pct: null, resetSec, resetText: null,
    });
    const estBlockVal = active ? active.sum.val : 0;
    const estBlockCost = active ? active.sum.cost : 0;
    const estBlockTok = active ? active.sum.i + active.sum.o + active.sum.cw + active.sum.cr : 0;
    const ex5 = extrapolate(s5, 'fh'), ex7 = extrapolate(s7, 'sd');

    // Coût premium consommé entre deux instants (transcripts locaux).
    const premCostBetween = (t0, t1) => {
      let c = 0;
      for (const e of es) if (e.fam === premiumFam && e.ts > t0 && e.ts <= t1) c += e.cost;
      return c;
    };
    // API muette depuis un moment (token périmé, réseau) : on repart du DERNIER
    // pourcentage officiel du bucket et on le fait bouger comme l'hebdo globale,
    // qui, elle, continue d'être rafraîchie par le fichier de l'app. On ne le
    // bouge que si les transcripts montrent de la conso premium depuis ce relevé :
    // passer sur un autre modèle ne doit pas faire monter la jauge premium.
    //
    // L'ancienne règle de trois — pourcentage officiel × (coût premium sur 7 j
    // glissants maintenant / au moment du relevé) — explosait : sa base n'a rien
    // à voir avec le quota (fenêtre glissante contre fenêtre à reset fixe, et
    // les transcripts ne voient que CE poste). Mesuré ici : 85 % × 1,3 = 100 %
    // affiché pour 86 % réels, alors que l'hebdo n'avait bougé que de 68 à 69 %.
    let anchorPrem = null;
    if (!offPrem && od.premium && od.premium.reset > now && od.premium.pct > 0 && od.fetchedAt > 0) {
      anchorPrem = od.premium.pct * 100;
      const ratio = (s7 && api7 && api7.pct > 0 && s7.at > od.fetchedAt) ? s7.pct / api7.pct : 1;
      if (premCostBetween(od.fetchedAt, now) > 0 && isFinite(ratio) && ratio > 1 && ratio < 3) {
        anchorPrem = Math.min(100, anchorPrem * ratio);
      }
    }
    if (off5) {
      push('session', 'SESSION 5h', estBlockVal, estBlockCost, estBlockTok, null,
        reset5 ? (reset5 - now) / 1000 : null, null, { pct: ex5 != null ? ex5 : off.u5h * 100 });
    } else {
      unknown('session', 'SESSION 5h', estBlockVal, estBlockTok, reset5 ? (reset5 - now) / 1000 : null);
    }
    const weekTok = week.i + week.o + week.cw + week.cr;
    if (off7) {
      push('week', 'WEEK', week.val, week.cost, weekTok, null,
        reset7 ? (reset7 - now) / 1000 : null, null, { pct: ex7 != null ? ex7 : off.u7d * 100 });
    } else {
      unknown('week', 'WEEK', week.val, weekTok, reset7 ? (reset7 - now) / 1000 : null);
    }
    const premTok = premium.i + premium.o + premium.cw + premium.cr;
    if (offPrem) {
      // bucket officiel weekly_scoped (Fable/Opus) — la vraie valeur de /usage
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: premEstimated,
        official: !premEstimated, pct: offPrem.pct * 100,
        resetSec: (offPrem.reset - now) / 1000, resetText: null,
      });
    } else if (anchorPrem != null) {
      // Ancrage sur le dernier relevé officiel du bucket premium, même ancien :
      // il donne le quota en coût (quota = coût_premium_à_T / pourcentage_à_T),
      // puis on applique le coût premium consommé sur 7 j glissants aujourd'hui.
      // Insensible au changement de modèle : si tu passes sur Opus, la conso
      // premium stagne et la jauge ne bouge pas, contrairement à une règle de
      // trois sur l'hebdo globale.
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: true, official: false,
        pct: anchorPrem, resetSec: reset7 ? (reset7 - now) / 1000 : null, resetText: null,
      });
    } else if (off7 && roll.tot > 0) {
      // Sans relevé officiel premium : repli sur la formule cccat, en coût pondéré
      // (un token Fable pèse ~2x un token Opus dans le quota).
      const share = cfg.premiumShare > 0 ? cfg.premiumShare : 0.5;
      const pct = Math.min(100, ((roll.premCost / roll.totCost) * off.u7d / share) * 100);
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: true, official: false,
        pct, resetSec: reset7 ? (reset7 - now) / 1000 : null, resetText: null,
      });
    } else {
      unknown('premium', premiumFam.toUpperCase() + ' 7d', premium.val, premTok,
        reset7 ? (reset7 - now) / 1000 : null);
    }

    // Débit et projection de fin de bloc (canoniques en coût, comme les %)
    const burnPerMin = hour.val / 60;
    const burnCostPerMin = hour.cost / 60;
    const burnTokPerMin = (hour.i + hour.o + hour.cw + hour.cr) / 60;
    let projPct = null;
    const sess = meters[0];
    if (active) {
      const remainMin = ((off5 ? off.reset5h : active.end) - now) / 60000;
      if (sess.official && estBlockCost > 0) {
        // règle de trois sur le pourcentage officiel, au rythme de dépense actuel
        projPct = sess.pct * (1 + (burnCostPerMin * Math.max(0, remainMin)) / estBlockCost);
      } else if (!sess.official && sess.limit > 0) {
        projPct = ((estBlockCost + burnCostPerMin * Math.max(0, remainMin)) / sess.limit) * 100;
      }
    }

    return {
      meters, metric, premiumFam,
      burnPerMin, burnTokPerMin, projPct,
      day, byFamDay,
      officialAt: off.at,
      // diagnostic affiché à l'écran quand aucune source ne répond : c'est ce que
      // CE process voit, pas ce qu'un autre terminal verrait.
      diag: (off5 || off7) ? null : (() => {
        const lines = [];
        for (const p of planUsageFiles(process.env, cfg)) {
          let st;
          try {
            const s = fs.statSync(p);
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            const l = j.samples && j.samples[j.samples.length - 1];
            st = l ? Math.round((now - (Number(l.t) || 0)) / 1000) + 's old, ' + s.size + 'B' : 'no sample';
          } catch (e) { st = String((e && e.code) || 'error'); }
          lines.push({ path: p, state: st });
        }
        const cr = readOAuthCreds(process.env);
        const tok = !cr ? 'no credentials file'
          : (cr.expiresAt && cr.expiresAt < now
            ? 'expired ' + Math.round((now - cr.expiresAt) / 60000) + 'min ago' : 'valid');
        return { files: lines, token: tok, apiErr: od.lastErr || null };
      })(),
      officialSrc: (s5 ? s5.src : (s7 ? s7.src : null)) + (ex5 != null || ex7 != null ? '+live' : ''),
      planSeen: !!plan,
      planErr,
      officialUsed: off5 || off7 || !!offPrem,
      officialErr: od.lastErr,
      officialRetryIn: Math.max(0, od.nextTryAt - now),
      entryCount: this.entries.size,
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      hasData: es.length > 0,
      activeBlock: active,
    };
  }
}

module.exports = { DataStore, familyOf, entryCost, entryMetric, readOAuthCreds, readPlanUsage, planUsageDirs, planUsageFiles };
