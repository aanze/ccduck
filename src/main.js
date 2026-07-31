'use strict';
// Orchestration : boucle d'animation, scan incrémental, clavier, modes CLI.

const { Screen, colorMode, term } = require('./ansi');
const { load } = require('./config');
const { DataStore } = require('./data');
const { Duck } = require('./duck');
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
  --help, --version

Keys  : [q] quit  [f] feed the duck  [s] sleeping pill (5 min)  [r] refresh  [m] metric  [c] table  [d] demo  [p] pause
Config: ~/.ccduck.json (limits, thresholds, weekly reset… see README)`;

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

  const cfg = load(opts.config);
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

  // ---- miroir : recopie le relevé de l'app dans le home ----
  // Nécessaire quand le terminal n'a pas accès à %APPDATA%\Claude : à lancer
  // depuis un contexte qui, lui, y accède (--mirror-watch pour rester en tâche
  // de fond). Le fichier ne contient que des pourcentages d'usage.
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
          JSON.parse(raw); // ne recopier qu'un JSON complet
          fsx.writeFileSync(dest, raw);
          return src;
        } catch (e) { /* suivant */ }
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

  // ---- diagnostic : état persisté + appel forcé à l'endpoint officiel ----
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

  // ---- instantané statique ----
  if (opts.once || (!isTTY && !opts.frames)) {
    store.scanSync();
    await store.refreshOfficial();
    const screen = new Screen(cols, Math.min(rows, 30), mode);
    const snap = applyDemo(store.snapshot(Date.now(), metric), opts.demo ?? null, 0);
    const duck = new Duck(cols);
    duck.x = Math.round(cols / 2 - 8);
    const geo = ui.metersGeometry(snap, cols, cfg);
    duck.update(0.01, { mode: geo.level, targetX: geo.worst ? geo.worst.tip : cols / 2, worstLabel: geo.worst ? geo.worst.label : '', worstPct: geo.worst ? geo.worst.pct : 0, soft: geo.soft, canvasW: cols });
    ui.draw(screen, {
      snap, cfg, tSec: 1.3, blinkOn: true,
      duckInfo: duck.renderInfo(), bubble: duck.bubble,
      ui: { demoLabel: opts.demo != null ? 'DEMO' : '', loading: null, paused: false, showTable: true, metricLabel: METRIC_LABELS[metric], version: VERSION },
    });
    process.stdout.write(screen.renderLines() + '\n');
    return;
  }

  // ---- mode frames (test hors TTY) ----
  if (opts.frames) {
    store.scanSync();
    const screen = new Screen(cols, rows, mode);
    const duck = new Duck(cols);
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
  // Compteurs officiels : l'intervalle réel est géré dans refreshOfficial (2 min,
  // backoff sur 429) — ici on se contente de la solliciter régulièrement.
  const pokeOfficial = (force) => {
    store.refreshOfficial(force).then(() => { if (!pendingScan) refreshSnap(); }).catch(() => {});
  };
  pokeOfficial(true);

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
        pokeOfficial(true); // r = je veux les vrais chiffres maintenant
      }
      else if (k === 'm' || k === 'M') { metric = METRICS[(METRICS.indexOf(metric) + 1) % METRICS.length]; refreshSnap(); }
      else if (k === 'f' || k === 'F') { duck.feed(); }
      else if (k === 's' || k === 'S') { duck.dropPill(); }
      else if (k === 'c' || k === 'C') { showTable = !showTable; }
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

    // pompe le scan en cours (2 fichiers max par image pour rester fluide)
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
    });
    ui.draw(screen, {
      snap: shown, cfg, tSec: duck.t, blinkOn: Math.floor(duck.t / 0.35) % 2 === 0,
      duckInfo: duck.renderInfo(), bubble: duck.bubble,
      ui: {
        demoLabel: demo == null ? '' : 'DEMO' + (typeof demo === 'number' ? ' ' + demo + '%' : ''),
        loading, paused, showTable, metricLabel: METRIC_LABELS[metric], version: VERSION,
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
  // Sonde légère : refreshOfficial décide seul s'il doit appeler (cadence, backoff,
  // token renouvelé). Battre à 3 s permet de repartir dès que Claude Code
  // renouvelle le token, sans jamais marteler l'endpoint.
  const officialTimer = setInterval(pokeOfficial, 3000);
  tick();
}

module.exports = { run };
