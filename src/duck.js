'use strict';
// Le canard de debug. Sprites 16x12 pixels (rendus en demi-blocs), orientés vers la
// gauche ; on inverse les lignes pour regarder à droite. '.' = transparent.
//
// Comportement :
//  - vie tranquille : nage, dérive, barbote tête sous l'eau, se lisse les plumes, dort
//  - alerte/panique : cyclique — il pointe la jauge fautive pendant une longue phase,
//    puis souffle en faisant le tour du bassin, puis y retourne
//  - nourrissage (touche f) : des graines tombent et flottent ; il accourt (même en
//    panique), picore un moment, puis reprend ses activités ; le reste flotte pour plus tard
//  - faim : sans repas depuis 10 min, il vient réclamer plein cadre, à intervalles
//    réguliers, jusqu'à ce qu'on le nourrisse

const PAL = {
  Y: 0xFFD21E, // corps
  H: 0xFFE97A, // reflet
  y: 0xD99E00, // ombre / aile
  O: 0xFF8A00, // bec
  o: 0xC96A00, // bec ombre
  K: 0x26200F, // œil
  W: 0xFFFFFF,
  R: 0xFF5555,
};

const SEED = 0xD9B44A;
const PILL_A = 0xFF5A5A; // gélule bicolore
const PILL_B = 0xF0F0F5;
const SEDATE_SEC = 300;  // 5 min de dodo
const POOP = 0x7A4E22;      // base du monticule
const POOP_TOP = 0x9A6B3C;  // sommet plus clair
const POOP_OLD = 0x5F3E1E;  // semi-immergée avant de couler
const POOP_LIFE = 60;       // dérive au plus ~1 min puis disparaît
const CURRENT = 2.5;        // vitesse du courant (px/s, vers la gauche) — partagée avec l'eau

function F(rows) {
  if (rows.length !== 12) throw new Error('sprite: 12 lignes attendues');
  for (const r of rows) if (r.length !== 16) throw new Error('sprite: ligne de 16 attendue: "' + r + '"');
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
  // barbotage / picorage : tête sous l'eau, croupion en l'air
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
  // commission en cours : queue relevée (deux images pour un léger frémissement)
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
  // réclamation : grosse tête plein cadre, collée à l'écran, bec qui claque
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
  // de face : il nous fixe
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
  // de face, bec grand ouvert : QUACK
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
  // lissage de plumes : tête retournée, bec dans l'aile
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
  // bec en l'air : il savoure l'averse (on le retourne pour qu'il regarde des deux côtés)
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

// Le canard ne commente pas ses activités : onomatopées uniquement.
// Seuls les avertissements de limites (alerte/panique) ont droit à du texte.
const QUACKS = ['quack', 'quack quack', 'squeak', 'wak wak'];
const ZENS = ['zzz…', 'quack… zzz'];
const NOMS = ['nom nom nom', 'crunch crunch', '♥'];

// Activités qui changent franchement la silhouette. Enchaîner deux de ces poses
// sans transition (tête sous l'eau puis sieste dans la même image) casse
// l'illusion : on intercale toujours un temps mort où il se redresse.
const POSED = new Set(['dabble', 'preen', 'sleep', 'gaze']);
// Même idée côté image : tant qu'il tient une de ces poses (ou qu'il panique),
// on ne lui superpose pas la pose de la crotte.
const POSE_FRAMES = new Set(['dabble', 'preen', 'sleep', 'front', 'frontBlink', 'frontQuack',
  'panicA', 'panicB', 'poopA', 'poopB', 'begA', 'begB', 'billUp']);

// Météo : une averse de temps en temps, rare et longue. Elle ne change rien aux
// chiffres, seulement l'ambiance — et l'humeur du canard.
// CCDUCK_RAIN_EVERY raccourcit l'attente entre deux averses (mise au point).
const RAIN_TEST = Number(process.env.CCDUCK_RAIN_EVERY) || 0;
const RAIN_EVERY = RAIN_TEST ? [RAIN_TEST, RAIN_TEST * 2] : [420, 1500]; // 7 à 25 min
const RAIN_LEN = [30, 300];    // l'averse dure de 30 s à 5 min
const JOY_AFTER = [3, 6];      // le temps qu'il s'en aperçoive
const JOY_LEN = [6.5, 10];     // une session de joie, 10 s au plus
const JOY_GAP = [30, 50];      // et jamais deux sessions à moins de 30 s d'écart
const JOYS = ['♥', 'quack quack !', '♥ ♥'];

// Faim : sans repas depuis HUNGRY_AFTER, il vient réclamer plein cadre et remet
// ça toutes les 1-2 min tant qu'on ne lui a rien donné. Barboter ne compte pas :
// c'est justement parce qu'il ne trouve rien qu'il vient nous voir.
// CCDUCK_HUNGRY_SEC raccourcit le délai (mise au point du rendu).
const HUNGRY_AFTER = Number(process.env.CCDUCK_HUNGRY_SEC) || 600;
// La faim monte par paliers d'un HUNGRY_AFTER : il revient réclamer de plus en
// plus souvent, et au troisième palier il ne demande plus, il se sert.
const BEG_STEPS = [[60, 120], [35, 70], [22, 45]];
const STARVING = 3;            // palier à partir duquel il s'attaque aux barres
const RAID_EVERY = [40, 80];   // et il y revient régulièrement tant qu'il a faim
const RAID_LEN = [4, 7];
const BITE_REGEN = 240;        // une barre grignotée met 4 min à se refermer
// Bulle imagée : des graines et un point d'interrogation, pas de phrase — le
// texte reste réservé aux avertissements de limites.
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
    this.act = null;            // activité tranquille en cours {name, until, x, speed}
    this.phase = null;          // cycle alerte/panique {name:'point'|'break', until}
    this.blinkUntil = 0;
    this.bubble = null;         // {text, until, style}
    this.nextBubbleAt = 0;
    this.particles = [];        // {x, y, vx, vy, ch, fg, life, grav, rel}
    this.seeds = [];            // {x, y, vy, landed} — y relatif au haut du sprite
    this.pills = [];            // gélules sédatives (mêmes physiques que les graines)
    this.sedatedUntil = 0;
    this.poops = [];            // {x, born} — dérivent avec le courant
    this.eaten = 0;             // digestion : pas de repas, pas de plop
    this.nextPoopAt = 0;
    this.poopPose = null;       // {until, dropAt, dropped} — queue levée le temps de la commission
    this.feeding = null;        // {until}
    this.feedCooldownUntil = 0;
    this.lastMealAt = 0;        // dernier vrai repas (graine/gélule) — jauge de faim
    this.nextBegAt = 0;
    this.beg = null;            // {phase:'come'|'face', until, comeUntil, nextQuack}
    this.raid = null;           // {m, until, nextBite, x0, tip, aim} — pillage d'une jauge
    this.nextRaidAt = 0;
    this.bites = [];            // {m, i, born} — trous laissés dans les barres (effet gruyère)
    this.rain = null;           // {since, until} — averse en cours
    this.nextRainAt = rand(RAIN_EVERY[0], RAIN_EVERY[1]);
    this.joy = null;            // {lookUntil, endAt, nextTurn, wx} — session de joie sous la pluie
    this.nextJoyAt = 0;
    this.eatT = 0;
    this.hop = 0;
    this.t = 0;
  }

  say(text, style, durSec) {
    this.bubble = { text, style: style || 'calm', until: this.t + (durSec || 2.5) };
  }

  spawn(p) { this.particles.push({ grav: 1, rel: true, ...p }); }

  // Jette une poignée de graines à un endroit aléatoire du bassin.
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
    this.feedCooldownUntil = 0; // de la bouffe fraîche, irrésistible
  }

  // Lâche une gélule sédative : il la prend pour de la nourriture, la gobe… zzz.
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
      // pause pendant l'alerte/panique : on fait le tour du bassin, pas de sieste
      weights = [['swim', 58], ['drift', 14], ['dabble', 14], ['quack', 14]];
    } else if (mode === 'zen') {
      // sleep pèse peu alors que les siestes zen sont longues (jusqu'à 1 min) :
      // au-delà, il passerait les deux tiers du temps les yeux fermés
      weights = [['drift', 30], ['sleep', 10], ['dabble', 10], ['preen', 10], ['swim', 10], ['quack', 6]];
    } else {
      weights = [['swim', 34], ['drift', 16], ['dabble', 14], ['preen', 10], ['quack', 10], ['sleep', 6]];
    }
    // le regard caméra n'arrive qu'APRÈS une promenade : il s'arrête, se tourne,
    // nous fixe, cligne des yeux, lâche un QUACK, puis retourne à ses affaires
    if (!breakMode && (this.lastAct === 'swim' || this.lastAct === 'drift')) {
      weights = weights.concat([['gaze', mode === 'zen' ? 12 : 18]]);
    }
    const name = pickWeighted(weights);
    // Deux poses marquées à la suite : on renonce à celle-ci et on se redresse
    // d'abord. Le tirage repartira de zéro après ce temps mort.
    if (POSED.has(name) && POSED.has(this.lastAct)) {
      this.lastAct = 'settle';
      return { name: 'settle', x: this.x, speed: 1.2, start: t, until: t + rand(0.9, 1.7) };
    }
    this.lastAct = name;
    const a = { name, x: this.x, speed: 5, start: t };
    if (name === 'gaze') { a.until = t + 4.4; return a; }
    if (name === 'swim') {
      // en pause de panique : grandes traversées (le "tour du bassin")
      a.x = breakMode ? (this.x > (minX + maxX) / 2 ? rand(minX, minX + 6) : rand(maxX - 6, maxX)) : rand(minX, maxX);
      a.speed = breakMode ? rand(7, 11) : rand(4, 9);
      a.until = t + rand(3, 7);
    } else if (name === 'drift') { a.x = this.x + rand(-6, 6); a.speed = 1.2; a.until = t + rand(3, 7); }
    else if (name === 'dabble') { a.until = t + rand(1.6, 3); }
    else if (name === 'preen') { a.until = t + rand(1.8, 3.2); }
    // vraies siestes : jusqu'à 1 min quand tout est au vert, 30 s sinon
    else if (name === 'sleep') { a.until = t + (mode === 'zen' ? rand(6, 60) : rand(3.5, 30)); }
    else if (name === 'quack') {
      a.until = t + 0.8;
      // y compris pendant les tours de bassin en alerte/panique : un quack de temps en temps
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
      // barboter, c'est chercher sa nourriture : ça compte comme un repas
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
      // il nous fixe : deux clignements puis un QUACK bec grand ouvert
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
    // les crottes partent avec le courant — exactement à sa vitesse
    for (const p of this.poops) p.x -= CURRENT * dt;
    this.poops = this.poops.filter((p) => this.t - p.born < POOP_LIFE && p.x > -3);
    // les barres grignotées se referment très lentement (cf. BITE_REGEN)
    this.bites = this.bites.filter((b) => this.t - b.born < BITE_REGEN);
  }

  // Digestion : de temps en temps (et seulement s'il a mangé), un petit plop.
  // Il prend la pose (queue levée) avant de s'exécuter — cf. runPoopPose.
  maybePoop() {
    const t = this.t;
    if (this.poopPose || this.eaten <= 0 || t < this.nextPoopAt) return;
    // jamais par-dessus une autre pose : le rendez-vous n'est pas consommé,
    // il ira dès qu'il aura repris une allure normale
    if (this.feeding || POSE_FRAMES.has(this.frame)) return;
    this.eaten--;
    this.nextPoopAt = t + rand(95, 210);
    this.poopPose = { until: t + rand(2.2, 3), dropAt: t + rand(0.7, 1.1), dropped: false };
    if (this.act) this.act.speed = Math.min(this.act.speed, 1.2); // on ralentit, c'est plus digne
  }

  // Queue levée pendant toute la commission, plop à mi-pose. Appelée en fin de
  // update() : elle écrase l'image choisie par l'activité en cours.
  runPoopPose() {
    const t = this.t;
    const p = this.poopPose;
    if (t > p.until) { this.poopPose = null; return; }
    this.frame = (Math.floor(t / 0.45) % 2 === 0) ? 'poopA' : 'poopB';
    if (p.dropped || t < p.dropAt) return;
    p.dropped = true;
    const tailX = this.dir < 0 ? this.x + SPR_W - 3 : this.x + 2; // derrière lui
    this.poops.push({ x: Math.max(0, Math.min(this.canvasW - 2, tailX)), born: t });
    // la goutte qui tombe + l'éclaboussure
    this.spawn({ x: tailX, y: SPR_H - 3, vx: 0, vy: 3, ch: '·', fg: POOP_TOP, life: 0.35, rel: false });
    this.spawn({ x: tailX, y: SPR_H - 1, vx: rand(-1, 1), vy: -rand(1, 2), ch: '∘', fg: WATER, life: 0.4, rel: false });
    this.hop = 1.4;  // petit sursaut de soulagement
    if (Math.random() < 0.5) this.say('plop', 'calm', 1.1);
  }

  // Les envies (crotte, réclamation, joie) sont bloquées tant qu'une pose est
  // tenue — sinon elles s'incrustent par-dessus. Mais un rendez-vous simplement
  // retenu se déclenche à la seconde EXACTE où la pose se termine : le canard
  // se réveillait et faisait sa commission dans la foulée, une fois sur deux en
  // zen. On repousse donc les échéances tant que la pose dure : ce qui n'a pas
  // pu arriver pendant le dodo arrive quelques secondes après, pas pendant le
  // bâillement.
  postponeUrges() {
    const t = this.t;
    this.nextPoopAt = Math.max(this.nextPoopAt, t + rand(2, 8));
    this.nextBegAt = Math.max(this.nextBegAt, t + rand(2, 6));
    this.nextJoyAt = Math.max(this.nextJoyAt, t + rand(2, 5));
  }

  // Météo : rien d'autre qu'un minuteur. L'averse tombe rarement et dure
  // longtemps ; le rendu des gouttes est côté ui, qui connaît la géométrie.
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
    // il lui faut quelques secondes pour s'apercevoir qu'il pleut
    this.nextJoyAt = Math.max(this.nextJoyAt, t + rand(JOY_AFTER[0], JOY_AFTER[1]));
  }

  // Intensité de l'averse : elle s'installe et se calme progressivement.
  rainStrength() {
    if (!this.rain) return 0;
    const t = this.t;
    return Math.max(0, Math.min(1, (t - this.rain.since) / 4, (this.rain.until - t) / 4));
  }

  // Une session de joie s'il pleut, qu'il n'est pas occupé, et que la précédente
  // remonte à au moins JOY_GAP.
  maybeJoy() {
    const t = this.t;
    if (this.joy || !this.rain || this.feeding || this.beg) return;
    if (t < this.nextJoyAt || POSE_FRAMES.has(this.frame)) return;
    if (this.rain.until - t < 3) return;         // averse finissante : pas la peine
    this.joy = {
      lookUntil: t + rand(2, 3), endAt: t + rand(JOY_LEN[0], JOY_LEN[1]),
      nextTurn: 0, wx: this.x, said: false,
      beatUntil: 0, kind: null, flap: 0.22, speed: 0,
    };
    this.act = null;
  }

  // Joie sous la pluie : bec en l'air, il regarde à gauche et à droite, puis
  // barbote deux fois plus vite que d'habitude en s'éclaboussant.
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
    // Pas de tempo fixe : on tire un « temps » à la fois — une pointe de vitesse
    // d'un côté ou de l'autre, un barbotage sur place, ou les deux à la fois.
    // Distance, sens, vitesse et cadence du bec sont retirés à chaque temps :
    // deux sessions de joie ne se ressemblent jamais.
    if (t > j.beatUntil) {
      j.kind = pickWeighted([['dash', 40], ['splash', 42], ['both', 18]]);
      j.beatUntil = t + (j.kind === 'dash' ? rand(0.25, 0.55) : rand(0.5, 1.2));
      j.flap = rand(0.15, 0.3);            // barbotage plus ou moins frénétique
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
      // sillage de la pointe de vitesse
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

  // Déclenche une réclamation si le ventre crie famine et qu'il n'est pas déjà
  // occupé à autre chose. Le créneau n'est armé qu'ici : tant qu'on ne le
  // nourrit pas, il repassera toutes les BEG_EVERY.
  maybeBeg() {
    const t = this.t;
    if (this.beg || this.feeding || t - this.lastMealAt < HUNGRY_AFTER) return;
    if (t < this.nextBegAt || POSE_FRAMES.has(this.frame)) return;
    // plus la faim dure, plus il revient souvent
    const step = BEG_STEPS[Math.min(BEG_STEPS.length - 1, this.hungerLevel() - 1)];
    this.nextBegAt = t + rand(step[0], step[1]);
    this.beg = { phase: 'come', until: 0, comeUntil: t + 6, nextQuack: 0 };
    this.act = null;
  }

  // Réclamation : il traverse le bassin, se plante face à nous et quacke —
  // grosse tête plein cadre, bulle imagée, éclaboussures.
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
    this.hop = 2;                       // il sautille d'impatience
    for (let i = 0; i < 2; i++) this.spawn({
      x: this.x + rand(3, SPR_W - 3), y: SPR_H - 1,
      vx: rand(-3, 3), vy: -rand(2, 5), ch: pick(['∘', '·']), fg: WATER, life: rand(0.4, 0.8), rel: false,
    });
  }

  // Niveau de faim, en paliers de HUNGRY_AFTER : 0 = repu, 1 = il réclame,
  // 2 = il insiste, 3 et plus = il crève la dalle et se sert tout seul.
  hungerLevel() {
    return Math.max(0, Math.floor((this.t - this.lastMealAt) / HUNGRY_AFTER));
  }

  // Dernier stade de la faim : il s'en prend aux barres de progression.
  // `bars` vient de l'interface : {x0, tips} — début des barres et pointe de
  // remplissage de chacune. Sans ça (rendu hors TTY), pas de pillage.
  maybeRaid(bars) {
    const t = this.t;
    if (this.raid || this.beg || this.feeding || this.hungerLevel() < STARVING) return;
    if (t < this.nextRaidAt || POSE_FRAMES.has(this.frame)) return;
    if (!bars || !Array.isArray(bars.tips)) return;
    // il ne vise que les barres qui ont de quoi être grignotées
    const cand = bars.tips.map((tip, m) => ({ m, tip })).filter((c) => c.tip > bars.x0 + 2);
    if (!cand.length) return;
    const c = pick(cand);
    this.nextRaidAt = t + rand(RAID_EVERY[0], RAID_EVERY[1]);
    this.raid = { m: c.m, until: t + rand(RAID_LEN[0], RAID_LEN[1]), nextBite: 0, x0: bars.x0, tip: c.tip, aim: null };
    // ses propres miettes ne doivent pas l'interrompre en plein pillage : il
    // les mangera juste après. Une poignée de graines lancée à la main, elle,
    // remet ce délai à zéro et le fait décrocher immédiatement.
    this.feedCooldownUntil = Math.max(this.feedCooldownUntil, this.raid.until);
    this.act = null;
  }

  // Pillage : il se place sous la barre, saute comme un damné, et à chaque
  // bond il arrache un morceau — un trou dans la barre, une miette qui tombe
  // et flotte jusqu'à ce qu'il la picore.
  runRaid(dt, minX, maxX) {
    const t = this.t, r = this.raid;
    if (t > r.until) { this.raid = null; return; }
    if (t > r.nextBite) {
      r.nextBite = t + rand(0.45, 0.85);
      const i = Math.floor(rand(0, Math.max(1, r.tip - r.x0)));
      this.bites.push({ m: r.m, i, born: t });
      while (this.bites.length > 80) this.bites.shift();
      r.aim = r.x0 + i;
      this.hop = 3.4;                       // le bond qui arrache le morceau
      // la miette : elle tombe de la barre et finit en graine sur l'eau
      this.seeds.push({ x: Math.max(1, Math.min(this.canvasW - 2, r.aim)), y: -rand(7, 11), vy: rand(4, 7), landed: false, crumb: true });
      while (this.seeds.length > 28) this.seeds.shift();
      if (Math.random() < 0.35) this.say(pick(['QUACK !', 'miam !', '∵ !']), 'alert', 1.2);
    }
    this.moveToward((r.aim != null ? r.aim : r.x0) - SPR_W / 2, 22, dt, minX, maxX);
    this.frame = (Math.floor(t / 0.16) % 2 === 0) ? 'quack' : 'stand';
    if (Math.random() < dt * 10) this.spawn({
      x: this.x + rand(2, SPR_W - 2), y: SPR_H - 1,
      vx: rand(-3, 3), vy: -rand(2, 5), ch: pick(['∘', '·']), fg: WATER, life: rand(0.3, 0.6), rel: false,
    });
  }

  // Retourne true si le canard est occupé à manger (prioritaire sur tout).
  // Les gélules sont dans la liste comme la bouffe : il n'y voit que du feu.
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
      // il a assez mangé pour l'instant, le reste flottera
      this.feeding = null;
      this.feedCooldownUntil = t + rand(9, 16);
      return false;
    }
    // le morceau le plus proche du bec
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
      // picore : tête plonge, le morceau disparaît en miettes
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
        // une miette arrachée à une barre n'est pas un repas : elle ne fait
        // reculer la faim que d'un cran, sinon il se contenterait de piller les
        // jauges et ne viendrait plus jamais réclamer
        this.lastMealAt = best.it.crumb ? Math.min(t, this.lastMealAt + HUNGRY_AFTER * 0.4) : t;
        this.nextBegAt = 0;   // rassasié : le prochain créneau repartira de zéro
        if (this.nextPoopAt < t) this.nextPoopAt = t + rand(70, 165);
        if (best.pill) {
          // gobée… l'effet est immédiat : 5 min de dodo, même en pleine panique
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
    this.updateWeather();   // avant le sédatif : il pleut aussi sur un canard qui dort

    // Sous sédatif : dodo paisible, imperméable aux jauges comme aux graines.
    if (t < this.sedatedUntil) {
      this.frame = 'sleep';
      this.postponeUrges();   // 5 min de dodo ne doivent pas s'évacuer d'un coup au réveil
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

    // `this.frame` porte encore l'image du tick précédent : c'est bien ce qu'il
    // est en train de faire quand on décide de déclencher une envie ou non.
    if (POSE_FRAMES.has(this.frame)) this.postponeUrges();
    this.maybePoop();
    this.maybeBeg();
    this.maybeJoy();
    this.maybeRaid(ctx.bars);

    const target = Math.max(minX, Math.min(maxX, (ctx.targetX || ctx.canvasW / 2) - SPR_W / 2));
    const busy = ctx.mode === 'alert' || ctx.mode === 'panic';

    if (this.tryFeeding(dt, minX, maxX)) {
      // en train de manger : la panique attendra
      this.beg = null;                 // à table, plus rien à réclamer
    } else if (this.beg) {
      this.runBeg(dt, minX, maxX);
    } else if (this.joy) {
      this.runJoy(dt, minX, maxX);
    } else if (this.raid) {
      this.runRaid(dt, minX, maxX);
    } else if (busy) {
      // ---- cycle : pointer longuement la jauge, puis souffler, puis y retourner ----
      // ctx.soft (jauge premium) : phases de pointage plus courtes, pauses plus longues
      const isPanic = ctx.mode === 'panic';
      const pointDur = () => isPanic ? rand(20, 30) : ctx.soft ? rand(9, 15) : rand(15, 25);
      const breakDur = () => isPanic ? rand(8, 14) : ctx.soft ? rand(14, 22) : rand(10, 18);
      if (!this.phase) this.phase = { name: 'point', until: t + pointDur() };
      if (t > this.phase.until) {
        if (this.phase.name === 'point') {
          this.phase = { name: 'break', until: t + breakDur() };
          this.act = null;
        } else {
          this.phase = { name: 'point', until: t + pointDur() };
          if (isPanic) this.say('QUACK !!', 'panic', 1.6);
          this.nextBubbleAt = t + 1;
        }
      }
      if (this.phase.name === 'break') {
        // le tour du bassin, l'air de rien
        this.runIdleLife(dt, 'calm', minX, maxX, true);
      } else if (isPanic) {
        this.moveToward(target + Math.sin(t * 11) * 3, 24, dt, minX, maxX);
        this.frame = (Math.floor(t / 0.12) % 2 === 0) ? 'panicA' : 'panicB';
        if (t > this.nextBubbleAt) {
          this.say(pick([`!! ${ctx.worstLabel} ${Math.round(ctx.worstPct)}% !!`, 'QUACK QUACK !!']), 'panic', 1.8);
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
          this.say(`${ctx.worstLabel} at ${Math.round(ctx.worstPct)}% !`, 'alert', 3);
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
    // le canard flotte : l'oscillation l'enfonce dans l'eau (vers le bas uniquement),
    // seuls les sursauts (hop) le soulèvent
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
      pills: this.pills, poops: this.poops, t: this.t, rain: this.rainStrength(), bites: this.bites };
  }
}

module.exports = { Duck, PAL, SPR_W, SPR_H, SEED, PILL_A, PILL_B, POOP, POOP_TOP, POOP_OLD, POOP_LIFE, CURRENT, BITE_REGEN };
