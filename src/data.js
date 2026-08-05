'use strict';
// Reading Claude Code transcripts (~/.claude/projects/**/*.jsonl) and aggregates.
// Every "assistant" line carries message.usage; we dedupe on message.id+requestId
// (resumed sessions copy messages over) and keep the last occurrence.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const tls = require('tls');
const { PRICING, claudeProjectDirs } = require('./config');
const auth = require('./auth');

const H5 = 5 * 3600 * 1000;
const D7 = 7 * 86400 * 1000;

// ---- Official /usage counters ----
// Primary source: the OAuth endpoint Claude Code itself uses
// (GET https://api.anthropic.com/api/oauth/usage, Bearer = the local token from
// ~/.claude/.credentials.json). Same mechanism as the community statuslines.
// The token never leaves the machine except towards api.anthropic.com.
// Returns {token, expiresAt, mtime}. We NEVER touch the refreshToken: Anthropic
// rotates it on every use, and using it would sign Claude Code out.
// We just watch the file: as soon as Claude Code renews the token, the mtime
// changes and we pick straight back up.
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
    } catch (e) { /* missing: we will fall back to cache/estimate */ }
  }
  // macOS: Claude Code keeps the token in the Keychain, not in a file
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
    } catch (e) { /* keychain empty or denied */ }
  }
  return null;
}

// Persisted state of the official counters: survives ccduck restarts, so the
// last known value can be shown again AND the backoff honoured (the endpoint
// 429s hard — a restart must NOT fire a cold call).
// CCDUCK_STATE redirects the state (tests: never write to the real file)
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

// Adopt the counters from disk when they are fresher than those in memory:
// several ccduck can run in parallel, and a failing instance must NEVER write
// its stale figures over the ones another just obtained.
function adoptDiskIfNewer(o) {
  try {
    const d = JSON.parse(fs.readFileSync(officialStatePath(), 'utf8'));
    if ((d.fetchedAt || 0) > (o.fetchedAt || 0)) {
      o.data = d.data || null;
      o.premium = d.premium || null;
      o.fetchedAt = d.fetchedAt || 0;
      return true;
    }
  } catch (e) { /* no state on disk */ }
  return false;
}

function saveOfficialState(o) {
  try {
    adoptDiskIfNewer(o); // guard against going backwards
    fs.writeFileSync(officialStatePath(), JSON.stringify({
      data: o.data, premium: o.premium, fetchedAt: o.fetchedAt, nextTryAt: o.nextTryAt, lastErr: o.lastErr,
    }));
  } catch (e) { /* disk full or locked: never mind, we keep the in-memory state */ }
}

// A fresh connection on every call (no pool): in a process running for hours, a
// kept-alive TLS socket cut by a proxy or firewall makes every later call fail.
// We also add the system store CAs (corporate proxies re-signing traffic)
// without ever disabling verification.
let usageAgent = null;
function getAgent() {
  if (usageAgent) return usageAgent;
  const opts = { keepAlive: false };
  try {
    if (typeof tls.getCACertificates === 'function') {
      const sys = tls.getCACertificates('system') || [];
      if (sys.length) opts.ca = [...(tls.getCACertificates('default') || []), ...sys];
    }
  } catch (e) { /* Node without that API: default CAs */ }
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

// MOST RELIABLE SOURCE: the Claude app records its own usage reading every
// 5 min in plan-usage-history.json — `fh` = 5-hour session, `sd` = weekly (as %).
// No token, no network call: no 401 and no 429 possible.
// Candidate files, in order of preference.
function planUsageFiles(env, cfg) {
  const out = [];
  const addFile = (f) => { if (f && !out.includes(f)) out.push(f); };
  let home = null;
  try { home = os.homedir(); } catch (e) { /* ignore */ }
  // Mirror in the home folder: the only way when the terminal cannot reach the
  // application folder (see --debug-usage). Fed by `ccduck --mirror`.
  if (home) addFile(path.join(home, '.ccduck-plan.json'));
  for (const d of planUsageDirs(env, cfg)) addFile(path.join(d, 'plan-usage-history.json'));
  return out;
}

// The Claude app ships as an MSIX package: what shows up under
// %APPDATA%\Claude is only a VIRTUALISED VIEW, reserved for processes carrying the same
// package identity. A shell started by another packaged application (Windows
// Terminal, terminal panel) gets its own view and therefore sees nothing —
// hence the permanent ENOENT. The physical file itself lives under
// %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude and stays readable
// from any shell: that is the path to prefer.
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
  // the physical MSIX path first: it works whatever the shell
  for (const d of msixClaudeDirs(env)) add(d);
  // 1) chemin explicite (config planUsageDir ou variable CCDUCK_CLAUDE_DIR)
  add(env.CCDUCK_CLAUDE_DIR);
  if (cfg && cfg.planUsageDir) add(cfg.planUsageDir);
  // 2) junction in the home folder: works around a terminal with no access to %APPDATA%\Claude
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

// The app rewrites this file every 5 min: while it does, the file briefly
// disappears (ENOENT) or reads truncated. A failed read must NEVER lose the
// source — hence the second attempt here, and the cache on the DataStore side.
function readOnce(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    const t = Date.now(); while (Date.now() - t < 40) { /* rewrite window */ }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
}

function readPlanUsage(env, cfg) {
  let why = null;
  let best = null;
  // We read EVERY candidate and keep the most recent reading. Taking the first
  // readable one would let a stale mirror beat the real app file.
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
      // we keep the recent history: it calibrates the extrapolation
      const hist = arr.slice(-40).map((s) => ({ t: Number(s.t) || 0, fh: s.u && s.u.fh, sd: s.u && s.u.sd }));
      best = { u5h: u5, u7d: u7, at, path: p, samples: hist };
    } catch (e) {
      // ENOENT = app not installed there, keep going; the rest (permissions,
      // JSON truncated mid-write) is worth reporting.
      if (e && e.code !== 'ENOENT') why = String(e.code || 'parse error');
    }
  }
  if (best) return best;
  return why ? { error: why } : null;
}

// Fallback: local cache written by the VS Code extension / statusline (sometimes stale).
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
    this.entries = new Map();       // dedupe key -> entry
    this.fileState = new Map();     // chemin -> {size, offset}
    this.lastScanAt = 0;
    this.lastError = null;
    this.seq = 0;
    this.ccVersion = null;          // Claude Code version seen in the transcripts (for the User-Agent)
    this.lastEntryTs = 0;           // timestamp of the last message seen → detects ongoing consumption
    this.credsMtime = 0;            // tracks token renewal by Claude Code
    this.lastReauthAt = 0;          // auto-reauth mode: never two attempts back to back
    this.reauthBlockedUntil = 0;    // and no insisting after a hard failure
    this.planCache = null;          // last app reading (survives the rewrites)
    this.official = loadOfficialState();
  }

  // Renewing the token ourselves — only when the mode is armed (config
  // `autoReauth` or the `a` key). One attempt per minute at most, and we give
  // up for good once the refresh token is dead: only `claude auth login` fixes
  // that, and insisting would only make noise.
  async tryReauth(now) {
    if (!this.cfg || !this.cfg.autoReauth) return null;
    if (now < this.reauthBlockedUntil || now - this.lastReauthAt < 60 * 1000) return null;
    this.lastReauthAt = now;
    try {
      const r = await auth.refresh(process.env, 15000);
      this.credsMtime = r.mtime || 0;
      this.official.lastErr = null;
      return r;
    } catch (e) {
      const code = String((e && e.code) || 'failed');
      this.official.lastErr = 'reauth: ' + code;
      const dead = code === 'invalid_grant' || code === 'no refresh token' || code === 'no credentials file';
      this.reauthBlockedUntil = now + (dead ? 6 * 3600 * 1000 : 5 * 60 * 1000);
      return null;
    }
  }

  // Queries the official endpoint. Pacing driven by real activity: ~45 s while
  // consuming (the figures move), 3 min when idle. A network miss no longer
  // freezes the display — we retry at 20 s, then 40, 80… (5 min max).
  // Only a 429 imposes its own delay (the server retry-after).
  async refreshOfficial(force) {
    const o = this.official;
    const now = Date.now();
    if (o.inFlight) return;
    // another instance may have refreshed already: use that before deciding
    adoptDiskIfNewer(o);

    let creds = readOAuthCreds(process.env);
    if (!creds) { o.lastErr = 'no token'; o.nextTryAt = now + 10 * 60 * 1000; saveOfficialState(o); return; }
    // Claude Code just renewed the token → start again right away
    const rotated = this.credsMtime && creds.mtime && creds.mtime !== this.credsMtime;
    this.credsMtime = creds.mtime;
    if (rotated) { o.nextTryAt = 0; o.fails = 0; }

    // Expired token: no point burning quota on a guaranteed 401. We wait for
    // Claude Code to renew it (file watch, checked every 5 s).
    if (creds.expiresAt && creds.expiresAt < now + 5000 && !rotated) {
      // auto-reauth armed: we renew it ourselves and chain the call.
      // Otherwise (the default), we wait for Claude Code to do it.
      const fresh = await this.tryReauth(now);
      if (fresh) creds = fresh;
      else {
        if (!o.lastErr || !/^reauth:/.test(o.lastErr)) o.lastErr = 'token expired (Claude Code will refresh)';
        o.nextTryAt = now + 5000;
        saveOfficialState(o);
        return;
      }
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
        // Token expired server-side even though its own date said otherwise.
        // In auto-reauth we renew it right away (the next tick will call the
        // endpoint again); otherwise we go back to watching the file.
        const fresh = await this.tryReauth(now);
        if (!fresh) o.lastErr = 'token expired (Claude Code will refresh)';
        o.fails = 0;
        o.nextTryAt = now + (fresh ? 500 : 8000);
        saveOfficialState(o);
        return;
      }
      if (res.status === 429) {
        // retry-after imposed by the server (seconds or HTTP date) — honour it
        // strictly: this endpoint 429s harder if you push.
        const raw = res.headers['retry-after'] || '';
        let ra = Number(raw) * 1000;
        if (!isFinite(ra) || ra <= 0) ra = (Date.parse(raw) || 0) - now;
        o.lastErr = 'rate-limited';
        o.fails = 0;
        o.nextTryAt = now + Math.max(ra || 0, 60 * 1000); // delay imposed by the server
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
      // Source of truth: the `limits` array (that is what the /usage screen shows).
      // Fall back to the flat five_hour/seven_day/seven_day_* fields when absent.
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
      o.raw = j; // for --debug-usage (stats only, never the token)
      o.fetchedAt = now;
      o.nextTryAt = 0;   // pacing is driven by activity, not by a lock
      o.lastErr = null;
      o.fails = 0;
      saveOfficialState(o);
    } catch (e) {
      // Honest diagnostics: we keep the real code rather than guessing.
      const code = String((e && (e.code || (e.cause && e.cause.code))) || '');
      if (code === 'ETIMEDOUT' || (e && e.name === 'AbortError')) o.lastErr = 'timeout';
      else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) o.lastErr = 'tls ' + code.toLowerCase();
      else o.lastErr = 'net ' + (code || (e && e.message) || 'unknown').toString().toLowerCase().slice(0, 24);
      o.fails = (o.fails || 0) + 1;
      // retry soon: a network miss must not freeze the figures
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

  // Generator: one file per step (the caller can animate between steps).
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
          // append-only log: read the tail only
          const fd = fs.openSync(f.path, 'r');
          try {
            const len = f.size - st.offset;
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, st.offset);
            this.parseChunk(buf.toString('utf8'));
          } finally { fs.closeSync(fd); }
          st.offset = f.size; st.size = f.size;
        } else if (f.size < st.offset) {
          // file rewritten: read it whole again (entries dedupe by key)
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

  scanSync() { for (const _ of this.scanSteps()) { /* all at once */ } }

  // ---- aggregates ----

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

    // 5-hour blocks (anchored to the whole UTC hour of the first message, ccusage style)
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

    // Source of truth: the /usage endpoint (the same figures as Claude Code
    // shows, Fable bucket included). The local `vscode-claude-status-cache.json`
    // cache is only used when it is MORE RECENT than the last API response — on
    // machines where the VS Code extension is not running it freezes and lies by
    // hours. Per window, the freshest data wins; never a blend.
    const od = this.official;
    const cacheU = readOfficialUsage(process.env);
    // Cache: a failed read (file being rewritten) must not make the source
    // disappear — we keep the last sample read, it carries its own date and
    // stays subject to the freshness rule.
    const planRaw = readPlanUsage(process.env, cfg);
    if (planRaw && planRaw.at) this.planCache = planRaw;
    const plan = (planRaw && planRaw.at) ? planRaw : (this.planCache || null);
    const planErr = plan ? null : ((planRaw && planRaw.error) || 'not found');
    // A reading is valid while its window is still running, or when it is very
    // recent (the app samples carry no reset time).
    // Hard rule: a reading older than 15 min is NO LONGER considered official.
    // Better to fall back honestly to an ≈ estimate than to show a stale figure
    // with an "official" dot — that is what used to freeze the gauges.
    const MAXAGE = 15 * 60 * 1000;
    const collect = (src, pct, reset, at) =>
      (pct != null && at && now - at < MAXAGE && (!reset || reset > now))
        ? [{ src, pct, reset: reset || 0, at }] : [];
    const best = (arr) => arr.sort((a, b) => b.at - a.at)[0] || null;

    // The app only samples every 5 min: between two readings the displayed
    // counter lags by that much. We fill the gap with the consumption actually
    // seen in the transcripts, converted into percentage points through a factor
    // calibrated on the app history itself (nothing invented: measured Δ% / Δcost).
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
        if (dp <= 0) continue;                    // window reset or plateau: ignore
        const dc = costBetween(a.t, b.t);
        if (dc <= 0) continue;
        dPct += dp; dCost += dc;
      }
      return dCost > 0 ? dPct / dCost : 0;        // percentage points per equivalent dollar
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
    // reset time: the best one known, even when the percentage comes from elsewhere
    const knownReset = (...v) => v.find((x) => x && x > now) || 0;
    const reset5 = knownReset(s5 && s5.reset, api5 && api5.reset, cacheU && cacheU.reset5h);
    const reset7 = knownReset(s7 && s7.reset, api7 && api7.reset, cacheU && cacheU.reset7d);

    // Fable: only the API exposes this counter. If the weekly moved since the last
    // Fable reading, we adjust it in the same proportion (marked ≈).
    // same freshness rule as the other gauges: a Fable reading hours old must
    // not be displayed as official
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

    // Day / week windows
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const dayStart = midnight.getTime();
    let weekStart, weekReset = null;
    if (off7 && off.reset7d > now) {
      // official weekly window
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

    // Premium family tracked by the 3rd gauge (official name wins)
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
    const rollStart = now - D7; // rolling 7-day window — the one the cccat formula uses
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

    // Historical maxima for the auto limits — ALWAYS in weighted cost, whatever
    // the display metric: the estimated percentages are canonical (the m key
    // only changes the unit of the figures, never the %).
    let maxBlock = 0;
    for (const b of blocks) if (b !== active) maxBlock = Math.max(maxBlock, b.sum.cost);
    // Max rolling week: sum over a 168 h window, stepping one hour at a time.
    // We exclude the last 7 days: only completed periods calibrate the auto
    // limit (otherwise the current window is its own max → a permanent 100 %).
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

    const floors = { session: 5, week: 40, premium: 20 }; // dollars (API-equivalent)
    // Auto limit = peak of the completed periods, with 15 % headroom above the
    // current window: beating your record shows ~87 %, never a fake 100 %.
    const lim = (key, observed, current) => {
      const c = cfg.limits[key];
      if (typeof c === 'number' && c > 0) return { v: c, auto: false };
      return { v: Math.max(observed, (current || 0) * 1.15, floors[key]), auto: true };
    };

    // 3 gauges, aligned with Anthropic's real limits: 5-hour block, global
    // weekly, premium weekly. `official` = the exact percentage from /usage;
    // otherwise a local estimate against the auto limit (marked ≈). No "day"
    // gauge: that limit does not exist (the daily total lives in the stats line).
    const meters = [];
    const push = (key, label, used, usedCost, tokens, limit, resetSec, resetText, official) => {
      meters.push({
        key, label, used, tokens,
        limit: official ? null : limit.v,       // dollars (API-equivalent)
        auto: official ? false : limit.auto,
        official: !!official,
        pct: official ? official.pct : (limit.v > 0 ? (usedCost / limit.v) * 100 : 0),
        resetSec, resetText,
      });
    };
    // RULE: with no fresh official reading we invent NOTHING — pct = null, the
    // gauge shows "—". A percentage computed from historical peaks bears no
    // relation to the real quotas and misleads.
    const unknown = (key, label, used, tokens, resetSec) => meters.push({
      key, label, used, tokens, limit: null, auto: false, official: false,
      pct: null, resetSec, resetText: null,
    });
    const estBlockVal = active ? active.sum.val : 0;
    const estBlockCost = active ? active.sum.cost : 0;
    const estBlockTok = active ? active.sum.i + active.sum.o + active.sum.cw + active.sum.cr : 0;
    const ex5 = extrapolate(s5, 'fh'), ex7 = extrapolate(s7, 'sd');

    // Premium cost consumed between two instants (local transcripts).
    const premCostBetween = (t0, t1) => {
      let c = 0;
      for (const e of es) if (e.fam === premiumFam && e.ts > t0 && e.ts <= t1) c += e.cost;
      return c;
    };
    // API silent for a while (expired token, network): we start again from the
    // LAST official percentage of the bucket and move it like the global weekly,
    // which the app file keeps refreshing. We only move it when the transcripts
    // show premium consumption since that reading: switching to another model
    // must not push the premium gauge up.
    //
    // The old rule of three — official percentage × (premium cost over a rolling
    // 7 days now / at the time of the reading) — blew up: its base has nothing
    // to do with the quota (rolling window against a fixed-reset window, and the
    // transcripts only see THIS machine). Measured here: 85 % × 1.3 = 100 %
    // displayed for a real 86 %, while the weekly had only moved from 68 to 69 %.
    let anchorPrem = null;
    if (!offPrem && od.premium && od.premium.reset > now && od.premium.pct > 0 && od.fetchedAt > 0) {
      anchorPrem = od.premium.pct * 100;
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
      // official weekly_scoped bucket (Fable/Opus) — the real /usage value
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: premEstimated,
        official: !premEstimated, pct: offPrem.pct * 100,
        resetSec: (offPrem.reset - now) / 1000, resetText: null,
      });
    } else if (off7 && roll.totCost > 0) {
      // No fresh reading of the bucket: the cccat formula, in weighted cost (a
      // Fable token weighs ~2x an Opus token in the quota). It reads the model
      // mix off the transcripts, so it follows a switch of model straight away.
      //
      // This is deliberately preferred over ageing the last official reading.
      // Scaling that reading by the global weekly's growth assumes premium usage
      // grows like everything else, which is false exactly when it matters —
      // measured here: a 3 % reading times a weekly that went 6 → 14 % displayed
      // 7 % for a real 11 %, because the session in between was nearly all
      // premium. The formula gave 11.3 %. The same rule of three had already
      // been caught overshooting the other way (100 % shown for a real 86 %).
      const share = cfg.premiumShare > 0 ? cfg.premiumShare : 0.5;
      const pct = Math.min(100, ((roll.premCost / roll.totCost) * off.u7d / share) * 100);
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: true, official: false,
        pct, resetSec: reset7 ? (reset7 - now) / 1000 : null, resetText: null,
      });
    } else if (anchorPrem != null) {
      // Last resort, with no transcripts to read a mix off: the last official
      // reading as it was measured, unscaled. Old, but at least it was true once.
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: true, official: false,
        pct: anchorPrem, resetSec: reset7 ? (reset7 - now) / 1000 : null, resetText: null,
      });
    } else {
      unknown('premium', premiumFam.toUpperCase() + ' 7d', premium.val, premTok,
        reset7 ? (reset7 - now) / 1000 : null);
    }

    // Burn rate and end-of-block projection (canonical in cost, like the %)
    const burnPerMin = hour.val / 60;
    const burnCostPerMin = hour.cost / 60;
    const burnTokPerMin = (hour.i + hour.o + hour.cw + hour.cr) / 60;
    let projPct = null;
    const sess = meters[0];
    if (active) {
      const remainMin = ((off5 ? off.reset5h : active.end) - now) / 60000;
      if (sess.official && estBlockCost > 0) {
        // rule of three on the official percentage, at the current spend rate
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
      // diagnostics shown on screen when no source answers: this is what THIS
      // process sees, not what another terminal would see.
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

module.exports = { DataStore, familyOf, entryCost, entryMetric, readOAuthCreds, readPlanUsage, planUsageDirs, planUsageFiles, getAgent };
