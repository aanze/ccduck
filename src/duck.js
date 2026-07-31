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
    this.feeding = null;        // {until}
    this.feedCooldownUntil = 0;
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
      weights = [['drift', 30], ['sleep', 34], ['dabble', 10], ['preen', 10], ['swim', 10], ['quack', 6]];
    } else {
      weights = [['swim', 36], ['drift', 18], ['dabble', 14], ['preen', 10], ['quack', 12], ['sleep', 6]];
    }
    const name = pickWeighted(weights);
    const a = { name, x: this.x, speed: 5 };
    if (name === 'swim') {
      // en pause de panique : grandes traversées (le "tour du bassin")
      a.x = breakMode ? (this.x > (minX + maxX) / 2 ? rand(minX, minX + 6) : rand(maxX - 6, maxX)) : rand(minX, maxX);
      a.speed = breakMode ? rand(7, 11) : rand(4, 9);
      a.until = t + rand(3, 7);
    } else if (name === 'drift') { a.x = this.x + rand(-6, 6); a.speed = 1.2; a.until = t + rand(3, 7); }
    else if (name === 'dabble') { a.until = t + rand(1.6, 3); }
    else if (name === 'preen') { a.until = t + rand(1.8, 3.2); }
    else if (name === 'sleep') { a.until = t + (mode === 'zen' ? rand(6, 12) : rand(3.5, 6)); }
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
      this.frame = 'dabble';
      if (Math.random() < dt * 5) this.spawn({
        x: this.headX() + rand(-2, 2), y: SPR_H - rand(0, 1),
        vx: rand(-2, 2), vy: -rand(1, 4), ch: pick(['∘', '°', '·']), fg: WATER, life: rand(0.4, 0.8),
      });
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
    for (const s of this.seeds) {
      if (s.landed) continue;
      s.y += s.vy * dt;
      s.vy += 14 * dt;
      if (s.y >= SPR_H - 1) {
        s.y = SPR_H - 1;
        s.landed = true;
        this.spawn({ x: s.x, y: SPR_H - 1, vx: rand(-1.5, 1.5), vy: -rand(1, 3), ch: '∘', fg: WATER, life: 0.4, rel: false });
      }
    }
  }

  // Retourne true si le canard est occupé à manger (prioritaire sur tout).
  tryFeeding(dt, minX, maxX) {
    const t = this.t;
    const landed = this.seeds.filter((s) => s.landed);
    if (!landed.length || t < this.feedCooldownUntil) { this.feeding = null; return false; }
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
    // graine la plus proche du bec
    let best = landed[0], bd = Infinity;
    for (const s of landed) { const d = Math.abs(s.x - this.headX()); if (d < bd) { bd = d; best = s; } }
    if (bd > 2.5) {
      this.moveToward(best.x - SPR_W / 2, 13, dt, minX, maxX);
      this.frame = 'stand';
      if (Math.random() < dt * 6) this.spawn({
        x: this.dir < 0 ? this.x + SPR_W - 2 : this.x + 1, y: SPR_H - 1,
        vx: -this.dir * rand(1.5, 3.5), vy: -rand(0.5, 2), ch: '·', fg: WATER, life: rand(0.3, 0.6),
      });
    } else {
      // picore : tête plonge, la graine disparaît en miettes
      this.frame = Math.floor(t / 0.45) % 2 === 0 ? 'dabble' : 'stand';
      this.eatT += dt;
      if (this.eatT > 1.0) {
        this.eatT = 0;
        this.seeds.splice(this.seeds.indexOf(best), 1);
        for (let i = 0; i < 3; i++) this.spawn({
          x: best.x + rand(-1, 1), y: SPR_H - 1 - rand(0, 1),
          vx: rand(-2, 2), vy: -rand(1, 3), ch: pick(['·', '˙']), fg: SEED, life: rand(0.3, 0.6), rel: false,
        });
        if (Math.random() < 0.22) this.say(pick(NOMS), 'calm', 1.4);
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
      if (ctx.mode === 'panic') this.say('QUACK !!', 'panic', 2);
    }

    this.updateSeeds(dt);

    const target = Math.max(minX, Math.min(maxX, (ctx.targetX || ctx.canvasW / 2) - SPR_W / 2));
    const busy = ctx.mode === 'alert' || ctx.mode === 'panic';

    if (this.tryFeeding(dt, minX, maxX)) {
      // en train de manger : la panique attendra
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
    return { rows, mirror, x: Math.round(this.x), yOff, particles: this.particles, seeds: this.seeds };
  }
}

module.exports = { Duck, PAL, SPR_W, SPR_H, SEED };
