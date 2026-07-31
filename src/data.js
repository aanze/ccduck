'use strict';
// Lecture des transcripts Claude Code (~/.claude/projects/**/*.jsonl) et agrégats.
// Chaque ligne "assistant" porte message.usage ; on déduplique par message.id+requestId
// (les reprises de session recopient des messages) et on garde la dernière occurrence.

const fs = require('fs');
const path = require('path');
const { PRICING, claudeProjectDirs } = require('./config');

const H5 = 5 * 3600 * 1000;

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

    // Fenêtres jour / semaine
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const dayStart = midnight.getTime();
    let weekStart, weekReset = null;
    if (cfg.weeklyReset && typeof cfg.weeklyReset.weekday === 'number') {
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

    // Famille premium suivie par la 4e jauge
    let premiumFam = cfg.premiumFamily;
    if (premiumFam === 'auto') {
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

    // Maxima historiques pour les limites auto
    let maxBlock = 0;
    for (const b of blocks) if (b !== active) maxBlock = Math.max(maxBlock, b.sum.val);
    const dayTotals = new Map();
    for (const e of es) {
      const d = new Date(e.ts); d.setHours(0, 0, 0, 0);
      const k = d.getTime();
      dayTotals.set(k, (dayTotals.get(k) || 0) + entryMetric(e, metric));
    }
    let maxDay = 0;
    for (const [k, v] of dayTotals) if (k !== dayStart) maxDay = Math.max(maxDay, v);
    // Semaine glissante max : somme sur fenêtre de 168h par pas d'une heure
    const maxWin = (filter) => {
      const hours = new Map();
      for (const e of es) {
        if (filter && !filter(e)) continue;
        const h = Math.floor(e.ts / 3600000);
        hours.set(h, (hours.get(h) || 0) + entryMetric(e, metric));
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

    const floors = metric === 'cost'
      ? { session: 5, day: 10, week: 40, premium: 20 }
      : { session: 2e6, day: 5e6, week: 2e7, premium: 1e7 };
    const lim = (key, observed) => {
      const c = cfg.limits[key];
      if (typeof c === 'number' && c > 0) return { v: c, auto: false };
      return { v: Math.max(observed, floors[key]), auto: true };
    };

    const meters = [];
    const push = (key, label, used, tokens, limit, resetSec, resetText) => {
      meters.push({
        key, label, used, tokens, limit: limit.v, auto: limit.auto,
        pct: limit.v > 0 ? (used / limit.v) * 100 : 0, resetSec, resetText,
      });
    };
    push('session', 'SESSION 5h', active ? active.sum.val : 0,
      active ? active.sum.i + active.sum.o + active.sum.cw + active.sum.cr : 0,
      lim('session', maxBlock), active ? (active.end - now) / 1000 : null, active ? null : 'idle');
    const nextMidnight = dayStart + 86400 * 1000;
    push('day', 'DAY', day.val, day.i + day.o + day.cw + day.cr,
      lim('day', maxDay), (nextMidnight - now) / 1000, null);
    push('week', 'WEEK', week.val, week.i + week.o + week.cw + week.cr,
      lim('week', maxWeek), weekReset ? (weekReset - now) / 1000 : null, weekReset ? null : '7d rolling');
    push('premium', premiumFam.toUpperCase() + ' 7d', premium.val, premium.i + premium.o + premium.cw + premium.cr,
      lim('premium', maxPremium), weekReset ? (weekReset - now) / 1000 : null, weekReset ? null : '7d rolling');

    // Débit et projection de fin de bloc
    const burnPerMin = hour.val / 60;
    const burnTokPerMin = (hour.i + hour.o + hour.cw + hour.cr) / 60;
    let projPct = null;
    if (active && meters[0].limit > 0) {
      const remainMin = (active.end - now) / 60000;
      projPct = ((active.sum.val + burnPerMin * remainMin) / meters[0].limit) * 100;
    }

    return {
      meters, metric, premiumFam,
      burnPerMin, burnTokPerMin, projPct,
      day, byFamDay,
      entryCount: this.entries.size,
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      hasData: es.length > 0,
      activeBlock: active,
    };
  }
}

module.exports = { DataStore, familyOf, entryCost, entryMetric };
