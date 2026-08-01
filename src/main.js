'use strict';
// Orchestration: animation loop, incremental scan, keyboard, CLI modes.

const { Screen, colorMode, term } = require('./ansi');
const { load } = require('./config');
const { DataStore } = require('./data');
const { Duck } = require('./duck');
const update = require('./update');
const ui = require('./ui');

const VERSION = require('../package.json').version;

const HELP = `ccduck ${VERSION} — Claude Code token monitor, with a debug duck

Usage: ccduck [options]

  --once           print a static snapshot and exit
  --demo[=PCT]     force the meters (default: animated sweep) to watch the duck react
  --frames N       render N frames as a stream (non-TTY testing)
  --size CxR       force size, e.g. 90x32
  --metric M       cost | total | billable
  --config PATH    config file (default: ~/.ccduck.json)
  --update         update ccduck now (git pull, or reinstall from the repo)
  --auto-reauth    renew the expired OAuth token instead of waiting for Claude Code
  --cat, --duck    which animal, for this run only (cccat = ccduck --cat)
  --no-alerts      the animal ignores the gauges: no pointing, no panic
  --help, --version

Keys  : [q] quit  [f] feed  [s] sleeping pill (5 min)  [r] refresh  [m] metric  [c] table  [d] demo  [p] pause
        [x] swap duck and cat for this session
        [z] alerts off: it stops watching the gauges entirely, and just lives
        [u] install the update when one is offered in the header
        [a] toggle auto-reauth (off by default: ccduck only reads the token file)
Config: ~/.ccduck.json (limits, thresholds, weekly reset… see README)

Tuning  the rare behaviours are on long timers; these shorten them, in seconds:
        CCDUCK_HUNGRY_SEC=20    begging, then bar raiding once starving
        CCDUCK_RAIN_EVERY=15    rain (duck) / the fly it chases (cat)
        CCDUCK_ZOOM_EVERY=15    the cat's zoomies`;

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    if (a === '--once') o.once = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a.startsWith('--demo')) o.demo = a.includes('=') ? Number(a.split('=')[1]) : 'sweep';
    else if (a === '--frames') o.frames = Number(eat());
    else if (a === '--size') o.size = eat();
    else if (a === '--metric') o.metric = eat();
    else if (a === '--config') o.config = eat();
    else if (a === '--no-color') o.noColor = true;
    else if (a === '--debug-usage') o.debugUsage = true;
    else if (a === '--update') o.update = true;
    else if (a === '--auto-reauth') o.autoReauth = true;
    else if (a === '--no-alerts') o.alerts = false;
    // which animal, for this run only: what the `cccat` launcher passes
    else if (a === '--cat') o.pet = 'cat';
    else if (a === '--duck') o.pet = 'duck';
    else if (a === '--mirror') o.mirror = true;
    else if (a === '--mirror-watch') { o.mirror = true; o.mirrorWatch = true; }
    else o._.push(a);
  }
  return o;
}

const METRICS = ['cost', 'total', 'billable'];
const METRIC_LABELS = { cost: 'cost', total: 'tokens', billable: 'no-cache' };

function applyDemo(snap, demo, tSec) {
  if (demo == null) return snap;
  let v = typeof demo === 'number' ? demo : 30 + ((Math.sin(tSec * 0.28) + 1) / 2) * 68;
  v = Math.max(1, Math.min(130, v));
  const offsets = { session: -16, week: 0, premium: -5 };
  const meters = snap.meters.map((m) => {
    const pct = Math.max(3, v + (offsets[m.key] || 0));
    return { ...m, pct };
  });
  return { ...snap, meters, projPct: Math.min(140, v + 6) };
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log('ccduck ' + VERSION); return; }

  if (opts.update) { process.exit(update.runUpdate() ? 0 : 1); }

  const cfg = load(opts.config);
  if (opts.autoReauth) cfg.autoReauth = true;
  if (opts.pet) cfg.pet = opts.pet;        // --cat / --duck win over the config file
  if (opts.alerts === false) cfg.alerts = false;
  let metric = METRICS.includes(opts.metric) ? opts.metric : (METRICS.includes(cfg.metric) ? cfg.metric : 'cost');
  const mode = colorMode(process.env, opts.noColor ? '256' : null);
  const isTTY = !!process.stdout.isTTY;

  let cols = 100, rows = 30;
  if (opts.size && /^\d+x\d+$/i.test(opts.size)) {
    const [c, r] = opts.size.toLowerCase().split('x').map(Number);
    cols = c; rows = r;
  } else if (isTTY) {
    cols = process.stdout.columns || 100;
    rows = process.stdout.rows || 30;
  }

  const store = new DataStore(cfg);

  // ---- mirror: copy the app reading into the home folder ----
  // Needed when the terminal cannot reach %APPDATA%\Claude: run it
  // from a context that can (--mirror-watch to keep it running in the
  // background). The file only ever holds usage percentages.
  if (opts.mirror) {
    const fsx = require('fs'), pth = require('path'), osx = require('os');
    const { planUsageDirs } = require('./data');
    const dest = pth.join(osx.homedir(), '.ccduck-plan.json');
    const copyOnce = () => {
      for (const d of planUsageDirs(process.env, cfg)) {
        const src = pth.join(d, 'plan-usage-history.json');
        if (src === dest) continue;
        try {
          const raw = fsx.readFileSync(src, 'utf8');
          JSON.parse(raw); // only copy a complete JSON
          fsx.writeFileSync(dest, raw);
          return src;
        } catch (e) { /* next one */ }
      }
      return null;
    };
    const first = copyOnce();
    console.log(first ? 'mirrored ' + first + '\n       -> ' + dest : 'mirror failed: source file not readable from here');
    if (!opts.mirrorWatch) return;
    console.log('watching (Ctrl+C to stop) — refresh every 60s');
    setInterval(copyOnce, 60000);
    return;
  }

  // ---- diagnostics: persisted state + forced call to the official endpoint ----
  if (opts.debugUsage) {
    const o = store.official;
    const { readOAuthCreds, readPlanUsage, planUsageFiles } = require('./data');
    const fsx = require('fs');
    console.log('Claude app usage file (source #1) — candidate paths:');
    for (const f of planUsageFiles(process.env, cfg)) {
      let mark = 'missing';
      try { const st = fsx.statSync(f); mark = 'FOUND (' + st.size + ' bytes, ' + Math.round((Date.now() - st.mtimeMs) / 1000) + 's ago)'; } catch (e) { mark = e.code || 'missing'; }
      console.log('  ' + mark.padEnd(34) + f);
    }
    const pu = readPlanUsage(process.env, cfg);
    console.log('  → result: ' + (pu && pu.at
      ? 'session ' + Math.round(pu.u5h * 100) + '% / weekly ' + Math.round(pu.u7d * 100) + '%, sampled ' + Math.round((Date.now() - pu.at) / 1000) + 's ago'
      : 'UNUSABLE (' + ((pu && pu.error) || 'not found') + ')'));
    console.log('  env: APPDATA=' + (process.env.APPDATA || '(unset)') + '  HOME=' + (process.env.USERPROFILE || process.env.HOME || '(unset)'));
    console.log();
    const cr = readOAuthCreds(process.env);
    console.log('oauth token: ' + (cr
      ? (cr.expiresAt ? 'expires ' + new Date(cr.expiresAt).toLocaleString()
          + (cr.expiresAt < Date.now() ? '  ← EXPIRED (Claude Code must refresh it)' : '  (valid)')
        : 'no expiry field')
      : 'NOT FOUND'));
    console.log('persisted state (~/.ccduck-usage.json):');
    console.log(JSON.stringify({
      fetchedAt: o.fetchedAt ? new Date(o.fetchedAt).toISOString() : null,
      nextTryAt: o.nextTryAt ? new Date(o.nextTryAt).toISOString() : null,
      lastErr: o.lastErr, data: o.data, premium: o.premium,
    }, null, 2));
    console.log('\nforcing live call… (note: consumes the endpoint\'s small rate budget — avoid repeating)');
    await store.refreshOfficial(true);
    console.log(o.raw ? JSON.stringify(o.raw, null, 2) : 'live call failed: ' + (o.lastErr || 'unknown'));
    return;
  }

  // ---- static snapshot ----
  if (opts.once || (!isTTY && !opts.frames)) {
    store.scanSync();
    await store.refreshOfficial();
    const screen = new Screen(cols, Math.min(rows, 30), mode);
    const snap = applyDemo(store.snapshot(Date.now(), metric), opts.demo ?? null, 0);
    const duck = new Duck(cols);
    duck.pet = cfg.pet === 'cat' ? 'cat' : 'duck';
    duck.x = Math.round(cols / 2 - 8);
    const geo = ui.metersGeometry(snap, cols, cfg);
    duck.update(0.01, { mode: geo.level, targetX: geo.worst ? geo.worst.tip : cols / 2, worstLabel: geo.worst ? geo.worst.label : '', worstPct: geo.worst ? geo.worst.pct : 0, soft: geo.soft, canvasW: cols });
    ui.draw(screen, {
      snap, cfg, tSec: 1.3, blinkOn: true,
      duckInfo: duck.renderInfo(), bubble: duck.bubble,
      ui: {
        demoLabel: opts.demo != null ? 'DEMO' : '', loading: null, paused: false, showTable: true,
        metricLabel: METRIC_LABELS[metric], version: VERSION,
        update: cfg.checkUpdates === false ? null : update.cached(VERSION), // cache only: no network here
      },
    });
    process.stdout.write(screen.renderLines() + '\n');
    return;
  }

  // ---- mode frames (test hors TTY) ----
  if (opts.frames) {
    store.scanSync();
    const screen = new Screen(cols, rows, mode);
    const duck = new Duck(cols);
    duck.pet = cfg.pet === 'cat' ? 'cat' : 'duck';
    let t = 0;
    for (let f = 0; f < opts.frames; f++) {
      t += 0.1;
      const snap = applyDemo(store.snapshot(Date.now(), metric), opts.demo ?? null, t);
      const geo = ui.metersGeometry(snap, cols, cfg);
      duck.update(0.1, { mode: geo.level, targetX: geo.worst ? geo.worst.tip : cols / 2, worstLabel: geo.worst ? geo.worst.label : '', worstPct: geo.worst ? geo.worst.pct : 0, soft: geo.soft, canvasW: cols });
      ui.draw(screen, {
        snap, cfg, tSec: t, blinkOn: Math.floor(t / 0.4) % 2 === 0,
        duckInfo: duck.renderInfo(), bubble: duck.bubble,
        ui: { demoLabel: opts.demo != null ? 'DEMO' : '', loading: null, paused: false, showTable: true, metricLabel: METRIC_LABELS[metric], version: VERSION },
      });
      process.stdout.write(screen.renderLines() + '\n' + '─'.repeat(20) + ' frame ' + (f + 1) + '\n');
    }
    return;
  }

  // ---- mode interactif ----
  let screen = new Screen(cols, rows, mode);
  const duck = new Duck(cols);
    duck.pet = cfg.pet === 'cat' ? 'cat' : 'duck';
  let demo = opts.demo ?? null;
  let showTable = cfg.showTable !== false;
  let paused = false;
  let snap = store.snapshot(Date.now(), metric);
  let pendingScan = store.scanSteps();
  let loading = { done: 0, total: 0 };
  let lastFrame = '';
  let lastTick = Date.now();
  let quitting = false;

  const refreshSnap = () => { snap = store.snapshot(Date.now(), metric); };
  // Official counters: the real interval lives in refreshOfficial (2 min,
  // backoff on 429) — here we just poke it regularly.
  const pokeOfficial = (force) => {
    store.refreshOfficial(force).then(() => { if (!pendingScan) refreshSnap(); }).catch(() => {});
  };
  pokeOfficial(true);

  // Updates: one check at startup (6 h cache on the update.js side), never
  // blocking, and the offer shows up in the header — the u key decides,
  // nothing installs itself.
  let updateTo = cfg.checkUpdates === false ? null : update.cached(VERSION);
  const pokeUpdate = (force) => {
    if (cfg.checkUpdates === false) return;
    update.check(VERSION, force).then((v) => { updateTo = v; }).catch(() => {});
  };
  pokeUpdate(false);

  const cleanup = () => {
    if (quitting) return;
    quitting = true;
    clearInterval(animTimer);
    clearInterval(refreshTimer);
    clearInterval(officialTimer);
    try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (e) { /* ignore */ }
    process.stdin.pause();
    process.stdout.write(term.altOff);
  };

  process.stdout.write(term.altOn);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('ccduck: erreur inattendue\n', err && err.stack || err);
    process.exit(1);
  });

  // clavier
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (buf) => {
      const k = buf.toString('utf8');
      if (k === 'q' || k === 'Q' || k === '\x03') { cleanup(); process.exit(0); }
      else if (k === 'r' || k === 'R') {
        if (!pendingScan) pendingScan = store.scanSteps();
        pokeOfficial(true); // r = I want the real numbers now
      }
      else if (k === 'm' || k === 'M') { metric = METRICS[(METRICS.indexOf(metric) + 1) % METRICS.length]; refreshSnap(); }
      else if (k === 'f' || k === 'F') { duck.feed(); }
      else if (k === 's' || k === 'S') { duck.dropPill(); }
      else if (k === 'c' || k === 'C') { showTable = !showTable; }
      else if (k === 'x' || k === 'X') {
        // swap the animal: same behaviours, different drawings. Session only —
        // set "pet": "cat" in ~/.ccduck.json to make it permanent.
        duck.pet = duck.pet === 'cat' ? 'duck' : 'cat';
        duck.tower = null;
      }
      else if (k === 'a' || k === 'A') {
        // toggles between "wait for Claude Code to renew" (default) and
        // "ccduck renews the expired token itself". Session only: to make it
        // permanent, set "autoReauth": true in ~/.ccduck.json
        cfg.autoReauth = !cfg.autoReauth;
        store.reauthBlockedUntil = 0;
        if (cfg.autoReauth) pokeOfficial(true);
      }
      else if (k === 'z' || k === 'Z') {
        // the animal stops watching the gauges altogether: no pointing, no
        // panic, no markers, everything else as usual. Session only: to make it
        // permanent, set "alerts": false in ~/.ccduck.json
        cfg.alerts = cfg.alerts === false;
        duck.phase = null;                 // drop a pointing burst in progress
        refreshSnap();
      }
      else if (k === 'u' || k === 'U') {
        // hand the terminal back before running git/npm: their output has to
        // stay readable, and the process stops right after anyway
        if (updateTo) { cleanup(); process.exit(update.runUpdate() ? 0 : 1); }
        else pokeUpdate(true);
      }
      else if (k === 'p' || k === 'P' || k === ' ') { paused = !paused; }
      else if (k === 'd' || k === 'D') {
        demo = demo == null ? 75 : demo === 75 ? 93 : demo === 93 ? 'sweep' : null;
      }
    });
  }

  process.stdout.on('resize', () => {
    cols = process.stdout.columns || cols;
    rows = process.stdout.rows || rows;
    screen = new Screen(cols, rows, mode);
    lastFrame = '';
  });

  const tick = () => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    if (paused) return;

    // pump the running scan (2 files per frame at most, to stay smooth)
    if (pendingScan) {
      for (let i = 0; i < 2; i++) {
        const st = pendingScan.next();
        if (st.done) { pendingScan = null; loading = null; refreshSnap(); break; }
        if (loading) loading = st.value;
      }
    }

    const tSec = duck.t + dt;
    const shown = applyDemo(snap, demo, tSec);
    const geo = ui.metersGeometry(shown, cols, cfg);
    const level = loading && !snap.hasData ? 'calm' : geo.level;
    duck.update(dt, {
      mode: level,
      targetX: geo.worst ? geo.worst.tip : cols / 2,
      worstLabel: geo.worst ? geo.worst.label.replace(/ .*/, '') : '',
      worstPct: geo.worst ? geo.worst.pct : 0,
      soft: geo.soft,
      canvasW: cols,
      // every gauge in alert, not just the worst: it handles them in turn
      alerts: geo.alerts.map((a) => ({ tip: a.tip, label: a.label.replace(/ .*/, ''), pct: a.pct, eff: a.eff })),
      // bar geometry: what it needs to go and nibble them
      bars: { x0: geo.L.barX0, tips: geo.tips },
    });
    ui.draw(screen, {
      snap: shown, cfg, tSec: duck.t, blinkOn: Math.floor(duck.t / 0.35) % 2 === 0,
      duckInfo: duck.renderInfo(), bubble: duck.bubble,
      ui: {
        demoLabel: demo == null ? '' : 'DEMO' + (typeof demo === 'number' ? ' ' + demo + '%' : ''),
        loading, paused, showTable, metricLabel: METRIC_LABELS[metric], version: VERSION,
        update: updateTo,
      },
    });
    const frame = screen.render();
    if (frame !== lastFrame) {
      process.stdout.write(frame);
      lastFrame = frame;
    }
  };

  const animTimer = setInterval(tick, Math.max(40, Math.round(1000 / (cfg.fps || 10))));
  const refreshTimer = setInterval(() => {
    if (!pendingScan) pendingScan = store.scanSteps();
  }, Math.max(3, cfg.refreshSec || 10) * 1000);
  // Light poll: refreshOfficial alone decides whether to call (pacing, backoff,
  // renewed token). Beating every 3 s lets it pick up as soon as Claude Code
  // renews the token, without ever hammering the endpoint.
  const officialTimer = setInterval(pokeOfficial, 3000);
  tick();
}

module.exports = { run };
