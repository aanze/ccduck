'use strict';
// Lecture des transcripts Claude Code (~/.claude/projects/**/*.jsonl) et agrégats.
// Chaque ligne "assistant" porte message.usage ; on déduplique par message.id+requestId
// (les reprises de session recopient des messages) et on garde la dernière occurrence.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PRICING, claudeProjectDirs } = require('./config');

const H5 = 5 * 3600 * 1000;
const D7 = 7 * 86400 * 1000;

// ---- Compteurs officiels /usage ----
// Source primaire : l'endpoint OAuth qu'utilise Claude Code lui-même
// (GET https://api.anthropic.com/api/oauth/usage, Bearer = token local de
// ~/.claude/.credentials.json). Même mécanisme que les statuslines communautaires.
// Le token ne quitte jamais la machine autrement que vers api.anthropic.com.
function readOAuthToken(env) {
  const paths = [];
  if (env.CLAUDE_CONFIG_DIR) paths.push(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'));
  paths.push(path.join(os.homedir(), '.claude', '.credentials.json'));
  for (const p of paths) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const o = j.claudeAiOauth || j;
      if (o && typeof o.accessToken === 'string' && o.accessToken) return o.accessToken;
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
      if (o && typeof o.accessToken === 'string' && o.accessToken) return o.accessToken;
    } catch (e) { /* trousseau vide/refusé */ }
  }
  return null;
}

// État persisté des compteurs officiels : survit aux relances de ccduck, pour
// réafficher la dernière valeur connue ET respecter le backoff (l'endpoint 429
// sévèrement — chaque relance ne doit PAS refaire un appel à froid).
function officialStatePath() { return path.join(os.homedir(), '.ccduck-usage.json'); }

function loadOfficialState() {
  const base = { data: null, premium: null, fetchedAt: 0, nextTryAt: 0, lastErr: null, inFlight: false };
  try {
    const j = JSON.parse(fs.readFileSync(officialStatePath(), 'utf8'));
    return { ...base, data: j.data || null, premium: j.premium || null,
      fetchedAt: j.fetchedAt || 0, nextTryAt: j.nextTryAt || 0, lastErr: j.lastErr || null };
  } catch (e) { return base; }
}

function saveOfficialState(o) {
  try {
    fs.writeFileSync(officialStatePath(), JSON.stringify({
      data: o.data, premium: o.premium, fetchedAt: o.fetchedAt, nextTryAt: o.nextTryAt, lastErr: o.lastErr,
    }));
  } catch (e) { /* disque plein/verrouillé : tant pis, on garde l'état mémoire */ }
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
    this.official = loadOfficialState();
  }

  // Interroge l'endpoint officiel. Prudent avec le rate limit (429 agressif) :
  // au plus une requête toutes les 3 min, backoff long en cas d'erreur,
  // on garde la dernière réponse valide entre deux.
  async refreshOfficial() {
    const o = this.official;
    const now = Date.now();
    if (o.inFlight || now < o.nextTryAt) return;
    // Politique cccat : quand le cache local couvre session + hebdo et qu'il est
    // frais, l'API ne sert qu'au bucket premium exact → au plus 1 appel / 30 min.
    const c = readOfficialUsage(process.env);
    const cacheCovers = !!(c && c.u5h != null && c.reset5h > now && c.u7d != null
      && c.reset7d > now && now - c.at < 20 * 60 * 1000);
    if (cacheCovers && now - o.fetchedAt < 30 * 60 * 1000) return;
    const token = readOAuthToken(process.env);
    if (!token) { o.lastErr = 'no token'; o.nextTryAt = now + 10 * 60 * 1000; saveOfficialState(o); return; }
    o.inFlight = true;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          'Authorization': 'Bearer ' + token,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
          'User-Agent': 'claude-code/' + (this.ccVersion || '2.1.219'),
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        // retry-after imposé par le serveur (secondes ou date HTTP) — le respecter
        // scrupuleusement : les 429 de cet endpoint s'aggravent si on insiste.
        const raw = res.headers.get('retry-after') || '';
        let ra = Number(raw) * 1000;
        if (!isFinite(ra) || ra <= 0) ra = (Date.parse(raw) || 0) - now;
        o.lastErr = 'rate-limited';
        o.nextTryAt = now + Math.max(ra || 0, 15 * 60 * 1000) + Math.random() * 90 * 1000;
        saveOfficialState(o);
        return;
      }
      if (!res.ok) {
        o.lastErr = 'http ' + res.status;
        o.nextTryAt = now + (res.status === 401 ? 10 : 5) * 60 * 1000;
        saveOfficialState(o);
        return;
      }
      const j = await res.json();
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
      // 5 min ± jitter : plusieurs postes derrière la même IP de sortie ne doivent
      // pas marteler l'endpoint en cadence (son budget est petit et partagé avec
      // l'écran /usage de Claude Code lui-même).
      o.nextTryAt = now + 300 * 1000 + (Math.random() * 120 * 1000 - 60 * 1000);
      o.lastErr = null;
      saveOfficialState(o);
    } catch (e) {
      const code = String((e && (e.code || (e.cause && e.cause.code))) || '');
      if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(code)) o.lastErr = 'tls (proxy? see README)';
      else o.lastErr = e && e.name === 'AbortError' ? 'timeout' : 'offline';
      o.nextTryAt = now + 5 * 60 * 1000; // réseau/proxy : on retentera, repli en attendant
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

    // Compteurs officiels — approche cccat : la source PRIMAIRE est le cache local
    // que Claude Code rafraîchit à chaque échange avec l'API (donc frais pendant
    // qu'on consomme, exactement quand ça compte) ; relu à chaque snapshot, zéro
    // réseau, zéro rate-limit. L'API OAuth n'est qu'un complément espacé (bucket
    // Fable exact). Par fenêtre, on garde la source la plus récemment mise à jour
    // dont la fenêtre court toujours (reset dans le futur).
    const od = this.official;
    const cacheU = readOfficialUsage(process.env);
    const cand5 = [], cand7 = [];
    if (cacheU && cacheU.u5h != null && cacheU.reset5h > now) cand5.push({ pct: cacheU.u5h, reset: cacheU.reset5h, at: cacheU.at });
    if (cacheU && cacheU.u7d != null && cacheU.reset7d > now) cand7.push({ pct: cacheU.u7d, reset: cacheU.reset7d, at: cacheU.at });
    if (od.data && od.data.five_hour && od.data.five_hour.reset > now) cand5.push({ pct: od.data.five_hour.pct, reset: od.data.five_hour.reset, at: od.fetchedAt });
    if (od.data && od.data.seven_day && od.data.seven_day.reset > now) cand7.push({ pct: od.data.seven_day.pct, reset: od.data.seven_day.reset, at: od.fetchedAt });
    const newest = (arr) => arr.sort((a, b) => b.at - a.at)[0] || null;
    const sess5 = newest(cand5), sess7 = newest(cand7);
    const offPrem = od.premium && od.premium.reset > now && now - od.fetchedAt < 6 * 3600 * 1000 ? od.premium : null;
    const off = {
      u5h: sess5 ? sess5.pct : null, reset5h: sess5 ? sess5.reset : 0,
      u7d: sess7 ? sess7.pct : null, reset7d: sess7 ? sess7.reset : 0,
      at: Math.max(sess5 ? sess5.at : 0, sess7 ? sess7.at : 0, offPrem ? od.fetchedAt : 0),
    };
    const off5 = !!sess5, off7 = !!sess7;

    // Fenêtres jour / semaine
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const dayStart = midnight.getTime();
    let weekStart, weekReset = null;
    if (off7) {
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

    // Famille premium suivie par la 3e jauge (bucket officiel prioritaire)
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
    for (const e of es) {
      if (e.ts >= dayStart) {
        acc(day, e);
        acc(byFamDay[e.fam] = byFamDay[e.fam] || zero(), e);
      }
      if (e.ts >= weekStart) {
        acc(week, e);
        if (e.fam === premiumFam) acc(premium, e);
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
    const estBlockVal = active ? active.sum.val : 0;
    const estBlockCost = active ? active.sum.cost : 0;
    const estBlockTok = active ? active.sum.i + active.sum.o + active.sum.cw + active.sum.cr : 0;
    if (off5) {
      push('session', 'SESSION 5h', estBlockVal, estBlockCost, estBlockTok, null,
        (off.reset5h - now) / 1000, null, { pct: off.u5h * 100 });
    } else {
      push('session', 'SESSION 5h', estBlockVal, estBlockCost, estBlockTok,
        lim('session', maxBlock, estBlockCost),
        active ? (active.end - now) / 1000 : null, active ? null : 'idle');
    }
    const weekTok = week.i + week.o + week.cw + week.cr;
    if (off7) {
      push('week', 'WEEK', week.val, week.cost, weekTok, null,
        (off.reset7d - now) / 1000, null, { pct: off.u7d * 100 });
    } else {
      push('week', 'WEEK', week.val, week.cost, weekTok,
        lim('week', maxWeek, week.cost),
        weekReset ? (weekReset - now) / 1000 : null, weekReset ? null : '7d rolling');
    }
    const premTok = premium.i + premium.o + premium.cw + premium.cr;
    const weekTokAll = week.i + week.o + week.cw + week.cr;
    if (offPrem) {
      push('premium', premiumFam.toUpperCase() + ' 7d', premium.val, premium.cost, premTok, null,
        (offPrem.reset - now) / 1000, null, { pct: offPrem.pct * 100 });
    } else if (off7 && weekTokAll > 0) {
      // formule cccat : part de tokens premium × hebdo officiel ÷ plafond premium
      // (Fable dispose d'~50 % de l'enveloppe hebdo sur les plans qui l'incluent)
      const share = cfg.premiumShare > 0 ? cfg.premiumShare : 0.5;
      const pct = Math.min(150, ((premTok / weekTokAll) * off.u7d / share) * 100);
      meters.push({
        key: 'premium', label: premiumFam.toUpperCase() + ' 7d',
        used: premium.val, tokens: premTok, limit: null, auto: true, official: false,
        pct, resetSec: weekReset ? (weekReset - now) / 1000 : null, resetText: null,
      });
    } else {
      push('premium', premiumFam.toUpperCase() + ' 7d', premium.val, premium.cost, premTok,
        lim('premium', maxPremium, premium.cost),
        weekReset ? (weekReset - now) / 1000 : null, weekReset ? null : '7d rolling');
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

module.exports = { DataStore, familyOf, entryCost, entryMetric };
