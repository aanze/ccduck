'use strict';
// The debug duck. 16x12 pixel sprites (rendered as half-blocks), facing left;
// rows are mirrored to look right. '.' = transparent.
//
// Behaviour:
//  - quiet life: swims, drifts, dabbles head-down, preens its feathers, sleeps
//  - alert/panic: cyclic — it points at the offending gauge for a long burst,
//    then catches its breath with a lap around the pond, then goes back to it
//  - feeding (the f key): seeds fall and float; it rushes over (even mid-panic),
//    pecks for a while, then resumes its business; the rest floats for later
//  - hunger: with no meal for 10 min it comes begging, filling the frame, at
//    regular intervals, until someone feeds it

const PAL = {
  Y: 0xFFD21E, // body
  H: 0xFFE97A, // highlight
  y: 0xD99E00, // shadow / wing
  O: 0xFF8A00, // beak
  o: 0xC96A00, // beak shadow
  K: 0x26200F, // eye
  W: 0xFFFFFF,
  R: 0xFF5555,
};

const SEED = 0xD9B44A;
const PILL_A = 0xFF5A5A; // two-tone pill
const PILL_B = 0xF0F0F5;
const SEDATE_SEC = 300;  // a 5 min nap
const POOP = 0x7A4E22;      // base of the mound
const POOP_TOP = 0x9A6B3C;  // lighter top
const POOP_OLD = 0x5F3E1E;  // half-sunk before going under
const POOP_LIFE = 60;       // drifts for ~1 min at most, then disappears
const CURRENT = 2.5;        // current speed (px/s, leftwards) — shared with the water

function F(rows) {
  if (rows.length !== 12) throw new Error('sprite: 12 rows expected');
  for (const r of rows) if (r.length !== 16) throw new Error('sprite: a row of 16 expected: "' + r + '"');
  return rows;
}

const SPR = {
  stand: F([
    '................',
    '....HHYY........',
    '...HYYYYY.......',
    '..HYKYYYY.......',
    '.OOYYYYYY.......',
    '..oYYYYYy.......',
    '...YYYYYYYYYYH..',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  blink: F([
    '................',
    '....HHYY........',
    '...HYYYYY.......',
    '..HYyYYYY.......',
    '.OOYYYYYY.......',
    '..oYYYYYy.......',
    '...YYYYYYYYYYH..',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  quack: F([
    '................',
    '....HHYY........',
    '...HYYYYY.......',
    '..HYKYYYY.......',
    'OOOYYYYYY.......',
    '.ooYYYYYy.......',
    '...YYYYYYYYYYH..',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  // dabbling / pecking: head under water, rump in the air
  dabble: F([
    '................',
    '................',
    '..........yHH...',
    '.........YYYY...',
    '....YYYYYYYYY...',
    '..YYYYYYYYYYy...',
    '.YYYYYYyyyYYy...',
    '.yYYYYYyyyYY....',
    '..yYYYYYYYy.....',
    '..yyyYYYyy......',
    '.OOYyyyy........',
    '.oYYy...........',
  ]),
  // doing its business: tail up (two frames for a slight quiver)
  poopA: F([
    '................',
    '....HHYY........',
    '...HYYYYY.......',
    '..HYKYYYY....YH.',
    '.OOYYYYYY...YYY.',
    '..oYYYYYy..YYYy.',
    '...YYYYYYYYYYYy.',
    '..YYYYYYyyyYYY..',
    '.yYYYYYYyyyyYY..',
    '.yYYYYYYYyyYy...',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  poopB: F([
    '................',
    '....HHYY........',
    '...HYYYYY.......',
    '..HYKYYYY.......',
    '.OOYYYYYY....YH.',
    '..oYYYYYy...YYY.',
    '...YYYYYYYYYYYy.',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYY..',
    '.yYYYYYYYyyYy...',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  // raiding the bars, seen from BEHIND: it crouches, then springs up with wings
  // spread and strikes the gauge with its beak. The beak sits at the top of the
  // sprite (rows 1-2, columns 7-8): that is the point the UI brings to the bar.
  raidLow: F([
    '................',
    '.......OO.......',
    '......oOOo......',
    '.....yYYYYy.....',
    '.....YYYYYY.....',
    '....yYYYYYYy....',
    '...yYYYYYYYYy...',
    '..yYYYYYYYYYYy..',
    '..yYYYYYYYYYYy..',
    '...yYYYYYYYYy...',
    '.....yYYYYy.....',
    '......yYYy......',
  ]),
  // three wing positions, cycled fast: it flaps like a chick that cannot fly.
  // The beak stays on rows 1-2 in every frame: the contact point with the bar
  // must not move from one frame to the next.
  raidFlapUp: F([
    '................',
    '.......OO.......',
    '......oOOo......',
    '.....yYYYYy.....',
    'yYY..YYYYYY..YYy',
    '.yY.yYYYYYYy.Yy.',
    '..yYYYYYYYYYYy..',
    '...yYYYYYYYYy...',
    '....yYYYYYYy....',
    '.....yYYYYy.....',
    '......yYYy......',
    '.......yy.......',
  ]),
  raidFlapMid: F([
    '................',
    '.......OO.......',
    '......oOOo......',
    '.....yYYYYy.....',
    '.....YYYYYY.....',
    'yYYYYYYYYYYYYYYy',
    '..yYYYYYYYYYYy..',
    '...yYYYYYYYYy...',
    '....yYYYYYYy....',
    '.....yYYYYy.....',
    '......yYYy......',
    '.......yy.......',
  ]),
  raidFlapDown: F([
    '................',
    '.......OO.......',
    '......oOOo......',
    '.....yYYYYy.....',
    '.....YYYYYY.....',
    '...yyYYYYYYyy...',
    '.yYYYYYYYYYYYYy.',
    'yYy.yYYYYYYy.yYy',
    '....yYYYYYYy....',
    '.....yYYYYy.....',
    '......yYYy......',
    '.......yy.......',
  ]),
  // begging: big head filling the frame, pressed against the screen, beak snapping
  begA: F([
    '.....HHHHHH.....',
    '...HHYYYYYYYY...',
    '..HYYYYYYYYYYy..',
    '.HYYYYYYYYYYYYy.',
    '.YYWKYYYYYYKWYy.',
    '.YYKKYYYYYYKKYy.',
    '.YYYYYYYYYYYYYy.',
    '.YYOOOOOOOOOOYy.',
    '..yOOOOOOOOOOy..',
    '...oooooooooo...',
    '....yYYYYYYy....',
    '.....YYYYYY.....',
  ]),
  begB: F([
    '.....HHHHHH.....',
    '...HHYYYYYYYY...',
    '..HYYYYYYYYYYy..',
    '.HYYYYYYYYYYYYy.',
    '.YYWKYYYYYYKWYy.',
    '.YYKKYYYYYYKKYy.',
    '.YYYYYYYYYYYYYy.',
    '.YYOOOOOOOOOOYy.',
    '..yKKKKKKKKKKy..',
    '...KKKKRRKKKK...',
    '....OOOOOOOO....',
    '.....oooooo.....',
  ]),
  // front view: it stares at us
  front: F([
    '................',
    '.....HHYY.......',
    '....HYYYYY......',
    '...HYYYYYYY.....',
    '...YKYYYYKY.....',
    '...YYYOOYYY.....',
    '....YYooYY......',
    '..YYYYYYYYYY....',
    '.YYYYYYYYYYYY...',
    '.yYYYYYYYYYYy...',
    '..yyYYYYYYyy....',
    '...yyyyyyyy.....',
  ]),
  frontBlink: F([
    '................',
    '.....HHYY.......',
    '....HYYYYY......',
    '...HYYYYYYY.....',
    '...YyYYYYyY.....',
    '...YYYOOYYY.....',
    '....YYooYY......',
    '..YYYYYYYYYY....',
    '.YYYYYYYYYYYY...',
    '.yYYYYYYYYYYy...',
    '..yyYYYYYYyy....',
    '...yyyyyyyy.....',
  ]),
  // front view, beak wide open: QUACK
  frontQuack: F([
    '................',
    '.....HHYY.......',
    '....HYYYYY......',
    '...HYYYYYYY.....',
    '...YKYYYYKY.....',
    '...YYYOOYYY.....',
    '....YOOOOY......',
    '....ooOOoo......',
    '..YYYYYYYYYY....',
    '.YYYYYYYYYYYY...',
    '.yYYYYYYYYYYy...',
    '..yyYYYYYYyy....',
  ]),
  // preening: head turned back, beak in the wing
  preen: F([
    '................',
    '........HHYY....',
    '.......HYYYYY...',
    '.......YKYYYY...',
    '......OOYYYYY...',
    '....YYooYYYy....',
    '..YYYYYYYYYYY...',
    '.YYYYYYyyyYYYY..',
    '.yYYYYYyyyyYYY..',
    '..yYYYYYYyyYy...',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  // beak up: savouring the shower (mirrored so it looks both ways)
  billUp: F([
    '................',
    '..O.HHYY........',
    '..OOHYKYY.......',
    '...HYYYYY.......',
    '...YYYYYY.......',
    '..yYYYYYy.......',
    '...YYYYYYYYYYH..',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  lookA: F([
    '................',
    '..O.HHYY........',
    '..OOHYKYY.......',
    '...HYYYYY.......',
    '...YYYYYY.......',
    '..yYYYYYy..YH...',
    '...YYYYYYYYYY...',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  lookB: F([
    '................',
    '..O.HHYY........',
    '..OOHYKYY.......',
    '...HYYYYY..YH...',
    '...YYYYYY..Y....',
    '..yYYYYYy..Y....',
    '...YYYYYYYYYY...',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  panicA: F([
    '..O......Y..Y...',
    '..OOHHYY.Y..Y...',
    '...HYKYYYY..Y...',
    '...HYYYYY.YY....',
    '...YYYYYYYYY....',
    '..yYYYYYYYY.....',
    '..YYYYYYYYYYY...',
    '.yYYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYY..',
    '..yYYYYYYyyYY...',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  panicB: F([
    '................',
    '..O.............',
    '..OOHHYY........',
    '...HYKYYY.......',
    '...YYYYYY.......',
    '..yYYYYYYy......',
    'YYYYYYYYYYYYYY..',
    'YyYYYYYYyyyYYYYY',
    '.yYYYYYYyyyyYYY.',
    '..yYYYYYYyyYY...',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
  sleep: F([
    '................',
    '................',
    '....HHYY........',
    '...HYyYYY.......',
    '.OOYYYYYY.......',
    '..oYYYYYy.......',
    '...YYYYYYYYYYH..',
    '..YYYYYYyyyYYYY.',
    '.yYYYYYYyyyyYYY.',
    '.yYYYYYYYyyYYy..',
    '..yyYYYYYYYyy...',
    '...yyyyyyyyy....',
  ]),
};

const SPR_W = 16, SPR_H = 12;
const WATER = 0x7FD4F5;

// The duck does not comment on what it does: onomatopoeia only.
// Only limit warnings (alert/panic) are allowed actual words.
const QUACKS = ['quack', 'quack quack', 'squeak', 'wak wak'];
const ZENS = ['zzz…', 'quack… zzz'];
const NOMS = ['nom nom nom', 'crunch crunch', '♥'];

// Activities that change the silhouette markedly. Chaining two of these poses
// with no transition (head under water then napping in the same frame) breaks
// the illusion: we always slip in a beat where it straightens up.
const POSED = new Set(['dabble', 'preen', 'sleep', 'gaze']);
// Same idea on the frame side: while it holds one of these poses (or panics),
// we do not overlay the dropping pose on it.
const POSE_FRAMES = new Set(['dabble', 'preen', 'sleep', 'front', 'frontBlink', 'frontQuack',
  'panicA', 'panicB', 'poopA', 'poopB', 'begA', 'begB', 'billUp',
  'raidLow', 'raidFlapUp', 'raidFlapMid', 'raidFlapDown']);

// Weather: the occasional shower, rare and long. It changes nothing about the
// figures, only the mood — and the duck's.
// CCDUCK_RAIN_EVERY shortens the wait between showers (for tuning).
const RAIN_TEST = Number(process.env.CCDUCK_RAIN_EVERY) || 0;
const RAIN_EVERY = RAIN_TEST ? [RAIN_TEST, RAIN_TEST * 2] : [420, 1500]; // 7 to 25 min
const RAIN_LEN = [30, 300];    // a shower lasts 30 s to 5 min
const JOY_AFTER = [3, 6];      // the time it takes to notice
const JOY_LEN = [6.5, 10];     // one burst of joy, 10 s at most
const JOY_GAP = [30, 50];      // and never two bursts less than 30 s apart
const JOYS = ['♥', 'quack quack !', '♥ ♥'];

// Hunger: with no meal for HUNGRY_AFTER it comes begging, filling the frame, and
// does it again every 1-2 min until fed. Dabbling does not count: it comes to us
// precisely because it is finding nothing.
// CCDUCK_HUNGRY_SEC shortens the delay (for tuning the rendering).
const HUNGRY_AFTER = Number(process.env.CCDUCK_HUNGRY_SEC) || 600;
// Hunger climbs in HUNGRY_AFTER steps: it comes begging more and more often,
// and by the third step it stops asking and helps itself.
const BEG_STEPS = [[60, 120], [35, 70], [22, 45]];
const STARVING = 3;            // step from which it starts attacking the bars
const RAID_EVERY = [40, 80];   // and it comes back regularly while still hungry
const RAID_LEN = [4, 7];
const RAID_UP = 0.18, RAID_HOLD = 0.12, RAID_DOWN = 0.3;   // spring, impact, fall back
const RAID_FLAP = ['raidFlapUp', 'raidFlapMid', 'raidFlapDown', 'raidFlapMid'];
const BITE_REGEN = 240;        // a nibbled bar takes 4 min to close up
// Picture bubble: seeds and a question mark, not a sentence — words stay
// reserved for limit warnings.
const BEGS = ['∵ ?', 'QUACK ! ∵', '∵ ∵ ∵ !!'];

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(pairs) {
  let sum = 0;
  for (const [, w] of pairs) sum += w;
  let r = Math.random() * sum;
  for (const [name, w] of pairs) { r -= w; if (r <= 0) return name; }
  return pairs[0][0];
}

class Duck {
  constructor(canvasW) {
    this.canvasW = canvasW;
    this.x = canvasW / 2;
    this.dir = -1;
    this.mode = 'calm';
    this.frame = 'stand';
    this.act = null;            // current quiet activity {name, until, x, speed}
    this.phase = null;          // cycle alerte/panique {name:'point'|'break', until, tgt}
    this.alertIdx = 0;          // round robin across the gauges in alert
    this.blinkUntil = 0;
    this.bubble = null;         // {text, until, style}
    this.nextBubbleAt = 0;
    this.particles = [];        // {x, y, vx, vy, ch, fg, life, grav, rel}
    this.seeds = [];            // {x, y, vy, landed} — y relative to the top of the sprite
    this.pills = [];            // sedative pills (same physics as the seeds)
    this.sedatedUntil = 0;
    this.poops = [];            // {x, born} — they drift with the current
    this.eaten = 0;             // digestion: no meal, no plop
    this.nextPoopAt = 0;
    this.poopPose = null;       // {until, dropAt, dropped} — tail up for the duration of the business
    this.feeding = null;        // {until}
    this.feedCooldownUntil = 0;
    this.lastMealAt = 0;        // last real meal (seed/pill) — the hunger gauge
    this.nextBegAt = 0;
    this.beg = null;            // {phase:'come'|'face', until, comeUntil, nextQuack}
    this.raid = null;           // {m, until, nextBite, x0, tip, aim} — raid on one gauge
    this.nextRaidAt = 0;
    this.bites = [];            // {m, i, born} — holes left in the bars (the swiss cheese effect)
    this.peck = null;           // {m, x, strike} — the strike in progress, extended by the UI
    this.rain = null;           // {since, until} — shower in progress
    this.nextRainAt = rand(RAIN_EVERY[0], RAIN_EVERY[1]);
    this.joy = null;            // {lookUntil, endAt, nextTurn, wx} — burst of joy in the rain
    this.nextJoyAt = 0;
    this.eatT = 0;
    this.hop = 0;
    this.t = 0;
  }

  say(text, style, durSec) {
    this.bubble = { text, style: style || 'calm', until: this.t + (durSec || 2.5) };
  }

  spawn(p) { this.particles.push({ grav: 1, rel: true, ...p }); }

  // Throws a handful of seeds at a random spot in the pond.
  feed(atX) {
    const W = this.canvasW;
    const cx = atX != null ? atX : rand(W * 0.12, W * 0.85);
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      this.seeds.push({
        x: Math.max(1, Math.min(W - 2, cx + rand(-3.5, 3.5))),
        y: -rand(3, 10), vy: rand(3, 7), landed: false,
      });
    }
    while (this.seeds.length > 28) this.seeds.shift();
    this.feedCooldownUntil = 0; // fresh food, irresistible
  }

  // Drops a sedative pill: it mistakes it for food, swallows it… zzz.
  dropPill(atX) {
    const W = this.canvasW;
    this.pills.push({
      x: Math.max(1, Math.min(W - 3, (atX != null ? atX : rand(W * 0.15, W * 0.85)))),
      y: -rand(4, 9), vy: rand(3, 6), landed: false,
    });
    while (this.pills.length > 6) this.pills.shift();
    this.feedCooldownUntil = 0;
  }

  headX() { return this.dir < 0 ? this.x + 2 : this.x + SPR_W - 3; }

  moveToward(dest, speed, dt, minX, maxX) {
    const dx = dest - this.x;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    this.x += step;
    if (Math.abs(step) > 0.03 * dt * speed) this.dir = step < 0 ? -1 : 1;
    this.x = Math.max(minX, Math.min(maxX, this.x));
    return Math.abs(dx) > 1.2;
  }

  pickAct(mode, minX, maxX, breakMode) {
    const t = this.t;
    let weights;
    if (breakMode) {
      // break during alert/panic: a lap around the pond, no napping
      weights = [['swim', 58], ['drift', 14], ['dabble', 14], ['quack', 14]];
    } else if (mode === 'zen') {
      // sleep carries little weight because zen naps are long (up to 1 min):
      // any more and it would spend two thirds of its time with eyes shut
      weights = [['drift', 30], ['sleep', 10], ['dabble', 10], ['preen', 10], ['swim', 10], ['quack', 6]];
    } else {
      weights = [['swim', 34], ['drift', 16], ['dabble', 14], ['preen', 10], ['quack', 10], ['sleep', 6]];
    }
    // the camera stare only comes AFTER a stroll: it stops, turns around, stares
    // at us, blinks, lets out a QUACK, then goes back to its business
    if (!breakMode && (this.lastAct === 'swim' || this.lastAct === 'drift')) {
      weights = weights.concat([['gaze', mode === 'zen' ? 12 : 18]]);
    }
    const name = pickWeighted(weights);
    // Two distinctive poses in a row: we drop this one and straighten up first.
    // The draw starts over after that beat.
    if (POSED.has(name) && POSED.has(this.lastAct)) {
      this.lastAct = 'settle';
      return { name: 'settle', x: this.x, speed: 1.2, start: t, until: t + rand(0.9, 1.7) };
    }
    this.lastAct = name;
    const a = { name, x: this.x, speed: 5, start: t };
    if (name === 'gaze') { a.until = t + 4.4; return a; }
    if (name === 'swim') {
      // on a panic break: long crossings (the "lap around the pond")
      a.x = breakMode ? (this.x > (minX + maxX) / 2 ? rand(minX, minX + 6) : rand(maxX - 6, maxX)) : rand(minX, maxX);
      a.speed = breakMode ? rand(7, 11) : rand(4, 9);
      a.until = t + rand(3, 7);
    } else if (name === 'drift') { a.x = this.x + rand(-6, 6); a.speed = 1.2; a.until = t + rand(3, 7); }
    else if (name === 'dabble') { a.until = t + rand(1.6, 3); }
    else if (name === 'preen') { a.until = t + rand(1.8, 3.2); }
    // real naps: up to 1 min when everything is green, 30 s otherwise
    else if (name === 'sleep') { a.until = t + (mode === 'zen' ? rand(6, 60) : rand(3.5, 30)); }
    else if (name === 'quack') {
      a.until = t + 0.8;
      // including during alert/panic laps: the occasional quack
      if (Math.random() < 0.7) this.say(pick(mode === 'zen' ? ZENS : QUACKS), 'calm', 2.2);
    }
    a.x = Math.max(minX, Math.min(maxX, a.x));
    return a;
  }

  runIdleLife(dt, mode, minX, maxX, breakMode) {
    const t = this.t;
    if (!this.act || t > this.act.until) this.act = this.pickAct(mode, minX, maxX, breakMode);
    const a = this.act;
    this.frame = 'stand';
    if (a.name === 'swim' || a.name === 'drift') {
      const dest = a.name === 'drift' ? a.x + Math.sin(t * 0.6) * 3 : a.x;
      const moving = this.moveToward(dest, a.speed, dt, minX, maxX);
      if (a.name === 'swim' && !moving) a.until = Math.min(a.until, t + 0.3);
      if (a.name === 'swim' && moving && Math.random() < dt * 5) this.spawn({
        x: this.dir < 0 ? this.x + SPR_W - 2 : this.x + 1, y: SPR_H - 1,
        vx: -this.dir * rand(1, 3), vy: -rand(0.5, 2), ch: '·', fg: WATER, life: rand(0.3, 0.7),
      });
    } else if (a.name === 'dabble') {
      // dabbling is foraging: it counts as a meal
      this.frame = 'dabble';
      if (!a.fed && t - a.start > 1.2) {
        a.fed = true;
        this.eaten = Math.min(6, this.eaten + 1);
        if (this.nextPoopAt < t) this.nextPoopAt = t + rand(60, 135);
      }
      if (Math.random() < dt * 5) this.spawn({
        x: this.headX() + rand(-2, 2), y: SPR_H - rand(0, 1),
        vx: rand(-2, 2), vy: -rand(1, 4), ch: pick(['∘', '°', '·']), fg: WATER, life: rand(0.4, 0.8),
      });
    } else if (a.name === 'gaze') {
      // it stares at us: two blinks, then a QUACK with the beak wide open
      const e = t - a.start;
      if (e < 1.2) this.frame = 'front';
      else if (e < 1.45) this.frame = 'frontBlink';
      else if (e < 2.2) this.frame = 'front';
      else if (e < 2.45) this.frame = 'frontBlink';
      else if (e < 3.5) {
        this.frame = 'frontQuack';
        if (!a.said) { a.said = true; this.say('QUACK !', 'calm', 1.6); }
      } else this.frame = 'front';
    } else if (a.name === 'preen') {
      this.frame = 'preen';
    } else if (a.name === 'sleep') {
      this.frame = 'sleep';
      if (Math.random() < dt * 0.9) this.spawn({
        x: this.headX(), y: 1, vx: 1.2, vy: -1.4, ch: 'z', fg: 0x9AA0A6, life: 1.8, grav: 0,
      });
    } else if (a.name === 'quack') {
      this.frame = 'quack';
    }
    if (this.frame === 'stand') {
      if (t < this.blinkUntil) this.frame = 'blink';
      else if (Math.random() < dt / 4) this.blinkUntil = t + 0.25;
    }
  }

  updateSeeds(dt) {
    const fall = (arr) => {
      for (const s of arr) {
        if (s.landed) continue;
        s.y += s.vy * dt;
        s.vy += 14 * dt;
        if (s.y >= SPR_H - 1) {
          s.y = SPR_H - 1;
          s.landed = true;
          this.spawn({ x: s.x, y: SPR_H - 1, vx: rand(-1.5, 1.5), vy: -rand(1, 3), ch: '∘', fg: WATER, life: 0.4, rel: false });
        }
      }
    };
    fall(this.seeds);
    fall(this.pills);
    // droppings go with the current — at exactly its speed
    for (const p of this.poops) p.x -= CURRENT * dt;
    this.poops = this.poops.filter((p) => this.t - p.born < POOP_LIFE && p.x > -3);
    // nibbled bars close up very slowly (see BITE_REGEN)
    this.bites = this.bites.filter((b) => this.t - b.born < BITE_REGEN);
  }

  // Digestion: now and then (and only if it has eaten), a little plop.
  // It takes the pose (tail up) before getting on with it — see runPoopPose.
  maybePoop() {
    const t = this.t;
    if (this.poopPose || this.eaten <= 0 || t < this.nextPoopAt) return;
    // never on top of another pose: the appointment is not consumed, it will
    // happen as soon as it is back to a normal stance
    if (this.feeding || POSE_FRAMES.has(this.frame)) return;
    this.eaten--;
    this.nextPoopAt = t + rand(95, 210);
    this.poopPose = { until: t + rand(2.2, 3), dropAt: t + rand(0.7, 1.1), dropped: false };
    if (this.act) this.act.speed = Math.min(this.act.speed, 1.2); // slow down, it is more dignified
  }

  // Tail up for the whole business, plop halfway through. Called at the end of
  // update(): it overrides the frame chosen by the current activity.
  runPoopPose() {
    const t = this.t;
    const p = this.poopPose;
    if (t > p.until) { this.poopPose = null; return; }
    this.frame = (Math.floor(t / 0.45) % 2 === 0) ? 'poopA' : 'poopB';
    if (p.dropped || t < p.dropAt) return;
    p.dropped = true;
    const tailX = this.dir < 0 ? this.x + SPR_W - 3 : this.x + 2; // behind it
    this.poops.push({ x: Math.max(0, Math.min(this.canvasW - 2, tailX)), born: t });
    // the falling drop + the splash
    this.spawn({ x: tailX, y: SPR_H - 3, vx: 0, vy: 3, ch: '·', fg: POOP_TOP, life: 0.35, rel: false });
    this.spawn({ x: tailX, y: SPR_H - 1, vx: rand(-1, 1), vy: -rand(1, 2), ch: '∘', fg: WATER, life: 0.4, rel: false });
    this.hop = 1.4;  // petit sursaut de soulagement
    if (Math.random() < 0.5) this.say('plop', 'calm', 1.1);
  }

  // The urges (dropping, begging, joy) are blocked while a pose is held —
  // otherwise they barge in on top of it. But an appointment merely held back
  // fires at the EXACT second the pose ends: the duck used to wake up and do
  // its business in the same breath, one time in two in zen. So we push the
  // deadlines back while the pose lasts: what could not happen during the nap
  // happens a few seconds later, not during the yawn.
  //
  postponeUrges() {
    const t = this.t;
    this.nextPoopAt = Math.max(this.nextPoopAt, t + rand(2, 8));
    this.nextBegAt = Math.max(this.nextBegAt, t + rand(2, 6));
    this.nextJoyAt = Math.max(this.nextJoyAt, t + rand(2, 5));
  }

  // Weather: nothing more than a timer. Showers are rare and long; the drops
  // are rendered on the ui side, which knows the geometry.
  updateWeather() {
    const t = this.t;
    if (this.rain) {
      if (t <= this.rain.until) return;
      this.rain = null;
      this.joy = null;
      this.nextRainAt = t + rand(RAIN_EVERY[0], RAIN_EVERY[1]);
      return;
    }
    if (t < this.nextRainAt) return;
    this.rain = { since: t, until: t + rand(RAIN_LEN[0], RAIN_LEN[1]) };
      // it takes a few seconds to notice it is raining
    this.nextJoyAt = Math.max(this.nextJoyAt, t + rand(JOY_AFTER[0], JOY_AFTER[1]));
  }

  // Shower intensity: it sets in and eases off gradually.
  rainStrength() {
    if (!this.rain) return 0;
    const t = this.t;
    return Math.max(0, Math.min(1, (t - this.rain.since) / 4, (this.rain.until - t) / 4));
  }

  // A burst of joy if it is raining, it is not busy, and the previous one is at
  // least JOY_GAP old.
  maybeJoy() {
    const t = this.t;
    if (this.joy || !this.rain || this.feeding || this.beg) return;
    if (t < this.nextJoyAt || POSE_FRAMES.has(this.frame)) return;
    if (this.rain.until - t < 3) return;         // shower ending: not worth it
    this.joy = {
      lookUntil: t + rand(2, 3), endAt: t + rand(JOY_LEN[0], JOY_LEN[1]),
      nextTurn: 0, wx: this.x, said: false,
      beatUntil: 0, kind: null, flap: 0.22, speed: 0,
    };
    this.act = null;
  }

  // Joy in the rain: beak up, it looks left and right, then dabbles twice as
  // fast as usual, splashing everywhere.
  runJoy(dt, minX, maxX) {
    const t = this.t, j = this.joy;
    if (t > j.endAt || !this.rain) {
      this.joy = null;
      this.nextJoyAt = t + rand(JOY_GAP[0], JOY_GAP[1]);
      return;
    }
    if (t < j.lookUntil) {
      this.frame = 'billUp';
      if (t > j.nextTurn) { this.dir = -this.dir; j.nextTurn = t + rand(0.6, 0.9); }
      return;
    }
    if (!j.said) {
      j.said = true;
      if (Math.random() < 0.6) this.say(pick(JOYS), 'calm', 1.8);
    }
    // No fixed tempo: we draw one "beat" at a time — a dash one way or the
    // other, dabbling on the spot, or both at once. Distance, direction, speed
    // and beak cadence are redrawn on every beat: two bursts of joy never look
    // alike.
    if (t > j.beatUntil) {
      j.kind = pickWeighted([['dash', 40], ['splash', 42], ['both', 18]]);
      j.beatUntil = t + (j.kind === 'dash' ? rand(0.25, 0.55) : rand(0.5, 1.2));
      j.flap = rand(0.15, 0.3);            // more or less frantic dabbling
      if (j.kind === 'splash') { j.wx = this.x; j.speed = 0; }
      else {
        const dist = rand(4, 11) * (Math.random() < 0.5 ? -1 : 1);
        j.wx = Math.max(minX, Math.min(maxX, this.x + dist));
        j.speed = j.kind === 'dash' ? rand(20, 32) : rand(9, 14);
      }
    }
    this.frame = j.kind === 'dash' ? 'stand'
      : (Math.floor(t / j.flap) % 2 === 0) ? 'dabble' : 'stand';
    if (j.speed) {
      this.moveToward(j.wx, j.speed, dt, minX, maxX);
      // wake of the dash
      if (j.kind === 'dash' && Math.random() < dt * 12) this.spawn({
        x: this.dir < 0 ? this.x + SPR_W - 2 : this.x + 1, y: SPR_H - 1,
        vx: -this.dir * rand(2, 5), vy: -rand(1, 3), ch: pick(['∘', '·']), fg: WATER, life: rand(0.3, 0.7), rel: false,
      });
    }
    if (Math.random() < dt * 1.6) this.hop = 2.2;
    if (Math.random() < dt * 14) this.spawn({
      x: this.x + rand(1, SPR_W - 1), y: SPR_H - rand(0, 2),
      vx: rand(-4, 4), vy: -rand(2, 6), ch: pick(['∘', '·', '°']), fg: WATER, life: rand(0.3, 0.8), rel: false,
    });
  }

  // Fires a begging round if the belly is empty and it is not already busy with
  // something else. The slot is only armed here: until it gets fed, it will
  // come back every BEG_EVERY.
  maybeBeg() {
    const t = this.t;
    if (this.beg || this.feeding || t - this.lastMealAt < HUNGRY_AFTER) return;
    if (t < this.nextBegAt || POSE_FRAMES.has(this.frame)) return;
    // the longer the hunger lasts, the more often it comes back
    const step = BEG_STEPS[Math.min(BEG_STEPS.length - 1, this.hungerLevel() - 1)];
    this.nextBegAt = t + rand(step[0], step[1]);
    this.beg = { phase: 'come', until: 0, comeUntil: t + 6, nextQuack: 0 };
    this.act = null;
  }

  // Begging: it crosses the pond, plants itself facing us and quacks — big head
  // filling the frame, picture bubble, splashes.
  runBeg(dt, minX, maxX) {
    const t = this.t;
    const b = this.beg;
    if (b.phase === 'come') {
      const center = Math.max(minX, Math.min(maxX, this.canvasW / 2 - SPR_W / 2));
      if (this.moveToward(center, 18, dt, minX, maxX) && t < b.comeUntil) {
        this.frame = 'stand';
        return;
      }
      b.phase = 'face';
      b.until = t + rand(3.5, 5);
    }
    if (t > b.until) { this.beg = null; return; }
    this.frame = (Math.floor(t / 0.18) % 2 === 0) ? 'begA' : 'begB';
    if (t < b.nextQuack) return;
    b.nextQuack = t + rand(1, 1.5);
    this.say(pick(BEGS), 'alert', 1.4);
    this.hop = 2;                       // it hops with impatience
    for (let i = 0; i < 2; i++) this.spawn({
      x: this.x + rand(3, SPR_W - 3), y: SPR_H - 1,
      vx: rand(-3, 3), vy: -rand(2, 5), ch: pick(['∘', '·']), fg: WATER, life: rand(0.4, 0.8), rel: false,
    });
  }

  // The gauge the duck will take care of during this pointing burst.
  // Several limits can climb at once: it handles them in turn rather than
  // hammering the highest one. Real panic (premium excluded, whose alert is
  // deliberately softened) keeps priority and monopolises the cycle — that is
  // the emergency, no time for a tour.
  pickAlert(ctx) {
    const list = ctx.alerts;
    if (!Array.isArray(list) || !list.length) return null;
    const panics = list.filter((a) => a.eff === 'panic');
    const pool = panics.length ? panics : list;
    this.alertIdx = (this.alertIdx + 1) % pool.length;
    return pool[this.alertIdx];
  }

  // Hunger level, in HUNGRY_AFTER steps: 0 = full, 1 = begging, 2 = insisting,
  // 3 and up = starving and helping itself.
  hungerLevel() {
    return Math.max(0, Math.floor((this.t - this.lastMealAt) / HUNGRY_AFTER));
  }

  // Last stage of hunger: it goes for the progress bars.
  // `bars` comes from the UI: {x0, tips} — where the bars start and how far
  // each one is filled. Without it (rendering outside a TTY), no raid.
  maybeRaid(bars) {
    const t = this.t;
    if (this.raid || this.beg || this.feeding || this.hungerLevel() < STARVING) return;
    if (t < this.nextRaidAt || POSE_FRAMES.has(this.frame)) return;
    if (!bars || !Array.isArray(bars.tips)) return;
    // it only aims at bars with something to nibble — one filled cell is
    // enough, otherwise a low gauge (a session at the start of its block) would
    // be excluded for good and it would only ever go for the other two
    const cand = bars.tips.map((tip, m) => ({ m, tip })).filter((c) => c.tip > bars.x0);
    if (!cand.length) return;
    const c = pick(cand);
    this.nextRaidAt = t + rand(RAID_EVERY[0], RAID_EVERY[1]);
    this.raid = { m: c.m, until: t + rand(RAID_LEN[0], RAID_LEN[1]), nextBite: 0, x0: bars.x0, tip: c.tip,
      aim: null, jumpAt: null, bitten: false };
    // its own crumbs must not interrupt the raid: it will eat them right after.
    // A handful of seeds thrown by hand, on the other hand, resets that delay
    // and makes it break off immediately.
    this.feedCooldownUntil = Math.max(this.feedCooldownUntil, this.raid.until);
    this.act = null;
    this.bubble = null;   // the stretched neck crosses the bubble line: free it up
  }

  // Raid: it lines up under the bar, jumps like mad, and every leap tears a
  // piece off — a hole in the bar, a crumb that falls and floats until it gets
  // pecked.
  runRaid(dt, minX, maxX) {
    const t = this.t, r = this.raid;
    if (t > r.until) { this.raid = null; this.peck = null; return; }
    if (r.aim == null) r.aim = r.x0 + Math.floor(rand(0, Math.max(1, r.tip - r.x0)));
    // From behind: the beak is in the middle of the sprite (column 7), and that
    // is the point we line up under the target column. `reach` (0 → 1) tells the
    // UI how far to lift it out of the water: at 1 the beak touches the bar.
    const beakX = () => this.x + 7;
    let reach = 0;
    if (r.jumpAt == null) {
      // Until it is right under its target it swims there normally, side on: a
      // duck moving backwards looks like nothing at all. It only turns around
      // once in place, right before taking off.
      this.moveToward(r.aim - 7, 22, dt, minX, maxX);
      if (Math.abs(beakX() - r.aim) >= 1.2) {
        this.frame = 'stand';
        if (Math.random() < dt * 5) this.spawn({
          x: this.dir < 0 ? this.x + SPR_W - 2 : this.x + 1, y: SPR_H - 1,
          vx: -this.dir * rand(1, 3), vy: -rand(0.5, 2), ch: '·', fg: WATER, life: rand(0.3, 0.7),
        });
        this.peck = { m: r.m, x: Math.round(beakX()), reach: 0 };
        return;
      }
      this.dir = -1;                 // in place: it turns its back to us, facing the gauge
      if (t > r.nextBite) r.jumpAt = t;
    }
    if (r.jumpAt != null) {
      const e = t - r.jumpAt;
      if (e < RAID_UP) reach = e / RAID_UP;                       // the spring
      else if (e < RAID_UP + RAID_HOLD) {                          // l'impact
        reach = 1;
        if (!r.bitten) {
          r.bitten = true;
          const col = Math.round(beakX());
          this.bites.push({ m: r.m, i: Math.max(0, Math.min(r.tip - r.x0, col - r.x0)), born: t });
          while (this.bites.length > 80) this.bites.shift();
          // the crumb torn off: it falls and ends up as a seed on the water
          this.seeds.push({ x: Math.max(1, Math.min(this.canvasW - 2, col)), y: -rand(7, 11), vy: rand(4, 7), landed: false, crumb: true });
          while (this.seeds.length > 28) this.seeds.shift();
          for (let i = 0; i < 3; i++) this.spawn({
            x: col + rand(-1.5, 1.5), y: 0,
            vx: rand(-4, 4), vy: -rand(1, 3), ch: pick(['·', '˙']), fg: SEED, life: rand(0.25, 0.6), rel: false,
          });
        }
      } else if (e < RAID_UP + RAID_HOLD + RAID_DOWN) {            // the fall back
        reach = 1 - (e - RAID_UP - RAID_HOLD) / RAID_DOWN;
      } else {
        // splashdown: spray, then it aims somewhere else
        for (let i = 0; i < 4; i++) this.spawn({
          x: this.x + rand(3, SPR_W - 3), y: SPR_H - 1,
          vx: rand(-4, 4), vy: -rand(2, 5), ch: pick(['∘', '·']), fg: WATER, life: rand(0.3, 0.7), rel: false,
        });
        r.jumpAt = null; r.bitten = false;
        r.nextBite = t + rand(0.25, 0.6);
        r.aim = r.x0 + Math.floor(rand(0, Math.max(1, r.tip - r.x0)));
        // it heads off side on towards the next column from this frame
        this.frame = 'stand';
        this.peck = { m: r.m, x: Math.round(beakX()), reach: 0 };
        return;
      }
    }
    // as soon as it leaves the water it flaps at full speed — three positions
    // cycled every 70 ms, which gives the panicked flutter of a chick
    this.frame = reach > 0.12 ? RAID_FLAP[Math.floor(t / 0.07) % RAID_FLAP.length] : 'raidLow';
    this.peck = { m: r.m, x: Math.round(beakX()), reach };
  }

  // Returns true while the duck is busy eating (which takes priority over all).
  // Pills sit in the same list as the food: it cannot tell the difference.
  tryFeeding(dt, minX, maxX) {
    const t = this.t;
    const edibles = [
      ...this.seeds.filter((s) => s.landed).map((s) => ({ it: s, list: this.seeds, pill: false })),
      ...this.pills.filter((p) => p.landed).map((p) => ({ it: p, list: this.pills, pill: true })),
    ];
    if (!edibles.length || t < this.feedCooldownUntil) { this.feeding = null; return false; }
    if (!this.feeding) {
      this.feeding = { until: t + rand(10, 16) };
      if (Math.random() < 0.5) this.say('quack !', 'calm', 1.2);
      this.act = null;
    }
    if (t > this.feeding.until) {
      // it has had enough for now, the rest will keep floating
      this.feeding = null;
      this.feedCooldownUntil = t + rand(9, 16);
      return false;
    }
    // the piece closest to the beak
    let best = edibles[0], bd = Infinity;
    for (const e of edibles) { const d = Math.abs(e.it.x - this.headX()); if (d < bd) { bd = d; best = e; } }
    if (bd > 2.5) {
      this.moveToward(best.it.x - SPR_W / 2, 13, dt, minX, maxX);
      this.frame = 'stand';
      if (Math.random() < dt * 6) this.spawn({
        x: this.dir < 0 ? this.x + SPR_W - 2 : this.x + 1, y: SPR_H - 1,
        vx: -this.dir * rand(1.5, 3.5), vy: -rand(0.5, 2), ch: '·', fg: WATER, life: rand(0.3, 0.6),
      });
    } else {
      // pecking: head dips, the piece breaks up into crumbs
      this.frame = Math.floor(t / 0.45) % 2 === 0 ? 'dabble' : 'stand';
      this.eatT += dt;
      if (this.eatT > 1.0) {
        this.eatT = 0;
        best.list.splice(best.list.indexOf(best.it), 1);
        for (let i = 0; i < 3; i++) this.spawn({
          x: best.it.x + rand(-1, 1), y: SPR_H - 1 - rand(0, 1),
          vx: rand(-2, 2), vy: -rand(1, 3), ch: pick(['·', '˙']),
          fg: best.pill ? pick([PILL_A, PILL_B]) : SEED, life: rand(0.3, 0.6), rel: false,
        });
        this.eaten = Math.min(6, this.eaten + 1);
        // a crumb torn off a bar is not a meal: it only pushes hunger back one
        // notch, otherwise it would just raid the gauges and never come begging
        // again
        this.lastMealAt = best.it.crumb ? Math.min(t, this.lastMealAt + HUNGRY_AFTER * 0.4) : t;
        this.nextBegAt = 0;   // full: the next slot starts from scratch
        if (this.nextPoopAt < t) this.nextPoopAt = t + rand(70, 165);
        if (best.pill) {
          // swallowed… the effect is immediate: a 5 min nap, even mid-panic
          this.sedatedUntil = t + SEDATE_SEC;
          this.feeding = null;
          this.say('nom nom… zzzz', 'calm', 3);
        } else if (Math.random() < 0.22) {
          this.say(pick(NOMS), 'calm', 1.4);
        }
      }
    }
    return true;
  }

  update(dt, ctx) {
    this.t += dt;
    const t = this.t;
    this.canvasW = ctx.canvasW;
    const minX = 1, maxX = ctx.canvasW - SPR_W - 1;
    const modeChanged = ctx.mode !== this.mode;
    this.mode = ctx.mode;
    if (modeChanged) {
      this.act = null;
      this.phase = null;
      this.nextBubbleAt = t + 0.3;
      if (ctx.mode === 'panic' && t >= this.sedatedUntil) this.say('QUACK !!', 'panic', 2);
    }

    this.updateSeeds(dt);
    this.updateWeather();   // before the sedative: it rains on a sleeping duck too

    // Sedated: a peaceful nap, deaf to the gauges and to the seeds alike.
    if (t < this.sedatedUntil) {
      this.frame = 'sleep';
      this.postponeUrges();   // 5 min of sleep must not all come out at once on waking
      if (Math.random() < dt * 0.9) this.spawn({
        x: this.headX(), y: 1, vx: 1.2, vy: -1.4, ch: 'z', fg: 0x9AA0A6, life: 1.8, grav: 0,
      });
      this.hop = 0;
      if (this.bubble && t > this.bubble.until) this.bubble = null;
      for (const p of this.particles) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.grav) p.vy += 9 * dt;
        p.life -= dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      return;
    }

    // `this.frame` still holds the previous tick's frame: that is exactly what
    // it is doing when we decide whether to fire an urge or not.
    if (POSE_FRAMES.has(this.frame)) this.postponeUrges();
    this.maybePoop();
    this.maybeBeg();
    this.maybeJoy();
    this.maybeRaid(ctx.bars);

    const busy = ctx.mode === 'alert' || ctx.mode === 'panic';

    if (this.tryFeeding(dt, minX, maxX)) {
      // busy eating: panic can wait
      this.beg = null;                 // at the table, nothing left to beg for
    } else if (this.beg) {
      this.runBeg(dt, minX, maxX);
    } else if (this.joy) {
      this.runJoy(dt, minX, maxX);
    } else if (this.raid) {
      this.runRaid(dt, minX, maxX);
    } else if (busy) {
      // ---- cycle: point at the gauge for a while, catch a breath, go back ----
      // ctx.soft (premium gauge): shorter pointing bursts, longer breaks
      const isPanic = ctx.mode === 'panic';
      const pointDur = () => isPanic ? rand(20, 30) : ctx.soft ? rand(9, 15) : rand(15, 25);
      const breakDur = () => isPanic ? rand(8, 14) : ctx.soft ? rand(14, 22) : rand(10, 18);
      if (!this.phase) this.phase = { name: 'point', until: t + pointDur(), tgt: this.pickAlert(ctx) };
      if (t > this.phase.until) {
        if (this.phase.name === 'point') {
          this.phase = { name: 'break', until: t + breakDur() };
          this.act = null;
        } else {
          // each pointing burst takes the next gauge: two limits climbing at the
          // same time are flagged one after the other
          this.phase = { name: 'point', until: t + pointDur(), tgt: this.pickAlert(ctx) };
          if (isPanic) this.say('QUACK !!', 'panic', 1.6);
          this.nextBubbleAt = t + 1;
        }
      }
      const tgt = this.phase.tgt || { tip: ctx.targetX, label: ctx.worstLabel, pct: ctx.worstPct };
      const target = Math.max(minX, Math.min(maxX, (tgt.tip != null ? tgt.tip : ctx.canvasW / 2) - SPR_W / 2));
      if (this.phase.name === 'break') {
        // the lap around the pond, all casual
        this.runIdleLife(dt, 'calm', minX, maxX, true);
      } else if (isPanic) {
        this.moveToward(target + Math.sin(t * 11) * 3, 24, dt, minX, maxX);
        this.frame = (Math.floor(t / 0.12) % 2 === 0) ? 'panicA' : 'panicB';
        if (t > this.nextBubbleAt) {
          this.say(pick([`!! ${tgt.label} ${Math.round(tgt.pct)}% !!`, 'QUACK QUACK !!']), 'panic', 1.8);
          this.nextBubbleAt = t + rand(2, 3.2);
        }
        if (Math.random() < dt * 10) this.spawn({
          x: this.x + rand(2, SPR_W - 2), y: SPR_H - rand(0, 2),
          vx: rand(-4, 4), vy: -rand(3, 8), ch: pick(['∘', '·', '°']), fg: WATER, life: rand(0.4, 0.9),
        });
        if (Math.random() < dt * 3) this.spawn({
          x: this.x + (this.dir < 0 ? 1 : SPR_W - 2), y: 0,
          vx: 0, vy: -2, ch: '!', fg: PAL.R, life: 0.7, grav: 0,
        });
      } else {
        const moving = this.moveToward(target, 14, dt, minX, maxX);
        this.frame = moving ? 'stand' : (Math.floor(t / 0.32) % 2 === 0) ? 'lookA' : 'lookB';
        if (!moving && Math.random() < dt / 1.6) this.hop = 2.4;
        if (t > this.nextBubbleAt) {
          this.say(`${tgt.label} at ${Math.round(tgt.pct)}% !`, 'alert', 3);
          this.nextBubbleAt = t + rand(4.5, 7);
        }
      }
    } else {
      this.runIdleLife(dt, ctx.mode, minX, maxX, false);
    }

    if (this.poopPose) this.runPoopPose();

    this.hop = Math.max(0, this.hop - dt * 6);
    if (this.bubble && t > this.bubble.until) this.bubble = null;

    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grav) p.vy += 9 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  renderInfo() {
    const rows = SPR[this.frame] || SPR.stand;
    const mirror = this.dir > 0;
    // the duck floats: the bobbing pushes it into the water (downwards only),
    // only the hops lift it up
    let yOff;
    if (this.mode === 'panic' && (!this.phase || this.phase.name === 'point') && !this.feeding) {
      yOff = Math.round(((Math.sin(this.t * 10) + 1) / 2) * 2);
    } else if (this.frame === 'sleep') {
      yOff = Math.round(((Math.sin(this.t * 1.1) + 1) / 2) * 1.2);
    } else {
      yOff = Math.round(((Math.sin(this.t * 2.1) + 1) / 2) * 1.4);
    }
    yOff -= Math.round(this.hop);
    return { rows, mirror, x: Math.round(this.x), yOff, particles: this.particles, seeds: this.seeds,
      pills: this.pills, poops: this.poops, t: this.t, rain: this.rainStrength(),
      bites: this.bites, peck: this.raid ? this.peck : null };
  }
}

module.exports = { Duck, PAL, SPR_W, SPR_H, SEED, PILL_A, PILL_B, POOP, POOP_TOP, POOP_OLD, POOP_LIFE, CURRENT, BITE_REGEN };
