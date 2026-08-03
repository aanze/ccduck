'use strict';
// The cat: a second pet, sharing the duck's behaviour engine frame for frame.
// Only the drawings change — every frame name the engine uses is resolved here,
// so the behaviour code never needs to know which animal is on screen.
//
// Same 16x12 grid, same convention: drawn facing LEFT, mirrored to look right.
//
// The sprite table below was read back out of a reference rendering of this
// atlas (docs/cat-atlas.png regenerates it). Several attempts to transcribe that
// image failed while its geometry was being fitted to it — the file is a lossy
// re-encode, ~24k distinct colours, every block edge smeared. What made it work
// was noticing the reference is this very atlas redrawn and rescaled: its seven
// band tints are the generator's own and its bands land exactly on multiples of
// the cell height. So the grid is derived, not fitted — cell 178x144, block
// 8.90 px — then each cell searches its own sub-pixel offset, keeping the one
// whose blocks sample most uniformly. All 37 reach full uniformity, and each
// block takes the majority letter over its interior, which is robust because
// there are only seven colours to tell apart. 7096 of 7104 blocks come back
// exact; the other 8 sit between the two browns and snap to the nearer one.
//
// Lesson worth keeping: a blurred picture of pixel art is still readable pixel
// for pixel, provided the grid is known rather than guessed at.
//
// Palette letters (defined in duck.js): M = brown, m = dark brown (stripes and
// shading), T = light tan (belly, inner paws), W = white (paws), P = pink (nose
// and open mouth), p = the dimmer pink of the muzzle, K = eye, N/n = the cat
// tower's wood.
//
// Two cells of the reference repeat another: 'frontBlink' is 'front' and the
// three 'raidFlap' drawings are one image, so the front-view blink cannot show
// and the raid alternates raidFlapUp with raidLow instead (see duck.js).
//
// Several poses are CYCLES rather than single frames — see CYCLES below.
// Walking, washing, licking and the alert meow say nothing as a still image.

const F = (rows) => {
  if (rows.length !== 12) throw new Error('cat sprite: 12 rows expected');
  for (const r of rows) if (r.length !== 16) throw new Error('cat sprite: a row of 16 expected: "' + r + '"');
  return rows;
};

const SPR_CAT = {
  stand: F([
    '.M..M...........',
    '.MM.MM..........',
    '.MMMMM.......mm.',
    '.mMMMM......m.mm',
    '.MMMMM......m...',
    '..MMM.MMMMMmm...',
    '..MMMMMMMMMMm...',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM.....MMM....',
    '..MM.....MM.....',
    '..WW.....WW.....',
  ]),
  blink: F([
    '.M..M.......mm..',
    '.MM.MM.......mm.',
    '.MMMMM........m.',
    '.mMMMM........m.',
    '.MMMMM.......mm.',
    '..MMM.MMMMMmmm..',
    '..MMMMMMMMMMm...',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM.....MMM....',
    '..MM.....MM.....',
    '..WW.....WW.....',
  ]),
  walk1: F([
    '.M..M.......mmm.',
    '.MM.MM......m.m.',
    '.MMMMM.....mm...',
    '.mMMMM.....m....',
    '.MMMMM....mm....',
    '..MMM.MMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM.....MMMMM..',
    '.MMM.....MM.WW..',
    '.WW......WW.....',
  ]),
  walk2: F([
    '................',
    '.M..M.......mmm.',
    '.MM.MM.....mm.m.',
    '.MMMMM.....mm...',
    '.mMMMM.....mm...',
    '.MMMMM....mm....',
    '..MMM.MMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM....MM..MM..',
    '.WW....WW...WW..',
  ]),
  walk3: F([
    '.M..M........mm.',
    '.MM.MM......mm..',
    '.MMMMM.....mm...',
    '.mMMMM.....mm...',
    '.MMMMM....mm....',
    '..MMM.MMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '.MMM.....MMMM...',
    '.MM........MM...',
    '.W..........W...',
  ]),
  walk4: F([
    '................',
    '.M..M.....mm....',
    '.MM.MM......m...',
    '.MMMMM......m...',
    '.mMMMM.....mm...',
    '.MMMMM....mm....',
    '..MMM.MMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMM.....MMM...',
    '..MM........MM..',
    '.WW..........W..',
  ]),
  sit: F([
    '.M..M...........',
    '.MM.MM..........',
    '.MMMMM..........',
    '.KMMMM..........',
    '.MMMMM..........',
    '..MMM.....m.....',
    '.MMMMM.....m....',
    '.MMMMMM....m....',
    '.MMMMMMM..m.....',
    '.M.MMmMMM.m.....',
    '.M.MMmMMMmm.....',
    '.W.W.MMMMm......',
  ]),
  // Not in the reference sheet: the seated blink, derived from 'sit' the exact
  // way the sheet's own 'blink' derives from 'stand' — the eye K becomes an m.
  sitBlink: F([
    '.M..M...........',
    '.MM.MM..........',
    '.MMMMM..........',
    '.mMMMM..........',
    '.MMMMM..........',
    '..MMM...........',
    '.MMMMM......mmm.',
    '.MMMMMM....mm..m',
    '.MMMMMMM..mm....',
    '.M.MMmMMM.m.....',
    '.M.MMmMMMmm.....',
    '.W.W.MMMMm......',
  ]),
  // sitUp: F([
    // '..M..M..........',
    // '.MMMMMM.........',
    // '.MKMMKM.........',
    // '.MMTMMM.........',
    // '.MMKKMM.........',
    // '..MMMM......mm..',
    // '..MMMMM.....mm..',
    // '.MMMMMMM...mm...',
    // '.MMMMMMM..mm....',
    // '.MM.MMmMMmm.....',
    // '.MM.MmMMMM......',
    // '.WW.WWMMMM......',
  // ]),
  sitUp: F([
    '..M..M..........',
    '.MMMMMM.........',
    'MMKMMKMM........',
    'MMMpMMMM........',
    '.MMKKMM.........',
    '..MMMM.....mmm..',
    '..MMMMM.....mm..',
    '.MMMMMMM...mm...',
    '.MMMMMMM..mm....',
    '.MM.MMmMMmm.....',
    '.MM.MmMMMM......',
    '.WW.WWMMMM......',
  ]),
  sitMeow: F([
    '..M...M.........',
    '.MKMMKMM........',
    '.MMpMMMM........',
    '.MMKKMMM........',
    '..MMMMM.........',
    '...MMM......mm..',
    '..MMMMM.....mm..',
    '..MMMMMM....m...',
    '..MMMMMmM...m...',
    '..M.MMmMMM.mm...',
    '..M.M.mMMMmm....',
    '..W.W.MMMM......',
  ]),
  panicA: F([
    '....M...........',
    '...MMM..........',
    '...MKMMM........',
    '...MMKMMM.......',
    '...MMMM.........',
    '..MMmK..........',
    '..MMMM......mm..',
    '.MMMMMM....mm.m.',
    '.MMMMMmM..mm....',
    '.M.MMmMMMmm.....',
    '.M.MMmMMMm......',
    '.W.W.MMMMM......',
  ]),
  panicB: F([
    '................',
    '................',
    '....MMMM........',
    '...MKMM.........',
    '..MMMMM.........',
    '...MKMMM..mm....',
    '....MM.....mm...',
    '..MMMMM....KmK..',
    '.MMMMMmM....mm..',
    '.M.MMmMMM..mm...',
    '.M.MMmMMMmmm....',
    '.W.W.MMMMM......',
  ]),
  wash1: F([
    '................',
    '.MM.MM..........',
    '.MMMMM..........',
    '.MKMKMWW........',
    '.MMMMMWW........',
    '..MMMMmM...Wm...',
    '..MMMMmMm...mm..',
    '..MMMMmMMm...m..',
    '..MMMMmMMm...m..',
    '..MMmMmMMM..mm..',
    '..MMmMMMMMmmm...',
    '..WWmMMMMMm.....',
  ]),
  wash2: F([
    '..MM.MM.........',
    '..MMMMM.........',
    '..MKMKM.........',
    '..MMMmW.........',
    '...MpmWm........',
    '....MpMMm..Wm...',
    '....MMmMmM..mm..',
    '....MMmMMmM..m..',
    '....MMmMMMm..m..',
    '....MMmMMMM.mm..',
    '....MmMMMMMmm...',
    '...WWmMMMMMm....',
  ]),
  wash3: F([
    '..MM.MM.........',
    '..MMMMM.........',
    '..MKMmW.........',
    '..MMMmW.........',
    '...MMmMM........',
    '....MMmMm.....mW',
    '....MMmMmM...mm.',
    '....MMmMMmM..m..',
    '....MMmMMMm..m..',
    '....MmmMMMM.mm..',
    '....MmMMMMMmm...',
    '...WWmMMMMMm....',
  ]),
  lick1: F([
    '.M..M...........',
    '.MMMMM..........',
    '.MMMMMM.........',
    '.MMMMMM.........',
    '.MMMMMmM........',
    '..pMMmMMM...mm..',
    '..pmmMMMMM..mm..',
    '...pMMMMMM..m...',
    '....MMmMMM.mm...',
    '....MmMMMM.m....',
    '....MmMMMMmm....',
    '...WWmMMMMm.....',
  ]),
  lick2: F([
    '.M..M...........',
    '.MMMMM..........',
    '.MMMMMM.........',
    '.MMMMMM.........',
    '.MKMKMmM........',
    '..MTMmMMM...mm..',
    '..MWmMMMMM..mm..',
    '..MmmMMMMM..m...',
    '....MMmMMM..m...',
    '....MmMMMM.mm...',
    '....MmMMMMmm....',
    '...WWmMMMMm.....',
  ]),
  lick3: F([
    '.M..M...........',
    '.MMMMM..........',
    '.MMMMMM.........',
    '.MMMMMM.........',
    '.MKMKMmM........',
    '..MMMmmMM...mm..',
    '...pMmMMMM..mmm.',
    '..MMWMMMMM..m...',
    '...MMMmMMM.mm...',
    '....MmMMMM.m....',
    '....MmMMMMmm....',
    '...WWmMMMMm.....',
  ]),
  sleep: F([
    '................',
    '.....mmmmmm.....',
    '....mMMMMMMm....',
    '...mMMmMMMMMM...',
    '.MmMMmMmMMMMMM..',
    '.MMMMMMmMmmMMMm.',
    '.MMMMMMMmMMMMMm.',
    '.MMMMMMMmMMMMMm.',
    '.mMMMpMmmMMMMMm.',
    '.Mmmmmmmmmmmmm..',
    '..MMWWWmmmmmm...',
    '................',
  ]),
  quack: F([
    '................',
    '.....mmmmm......',
    '...mMMMMMMMm....',
    '..mMMMmMMMMMm...',
    '.MmMMmMmMMMMM...',
    '.MMMMMMmMmMMMm..',
    '.MMMMMMMmMMMMm..',
    '.MMMMMMmmMMMmm..',
    '.mMMpMMMmMMMmm..',
    '..mmmmmmmmmmm...',
    '...mmWWmmmmm....',
    '................',
  ]),
  billUp: F([
    '.M...M......mmm.',
    '.MM.MM.....mm.m.',
    '.mMMMM.....mm...',
    '.MMMMM.....mm...',
    '.MMMMM....mm....',
    '..MMM.MMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM....MMMM....',
    '..MM....MM......',
    '..WW....WW......',
  ]),
  eat1: F([
    '............mmm.',
    '...........mm.m.',
    '...........mm...',
    '...........mm...',
    '...MMMMMMMMm....',
    'm.MMMmmMMMMM....',
    'MmMMmMmMMMMM....',
    'MMMMMMmMMMMM....',
    'MMMMMMmmMM......',
    'MKMMKM..MM......',
    '.MMpMm..MM......',
    '.W...W..WW......',
  ]),
  eat2: F([
    '............mmm.',
    '...........mm.m.',
    '...........mm...',
    '...........mm...',
    '...MMMMMMMMm....',
    'm.MMMmmMMMMM....',
    'MmMMmMmMMMMM....',
    'MMMMMMmMMMMM....',
    'MMMMMMmmMM......',
    'MKMMKMK.MM......',
    '.MMTMm..MM......',
    '.W...W..WW......',
  ]),
  stalkA: F([
    '................',
    '................',
    '................',
    '................',
    '............mmmm',
    'M....M.....mmm..',
    'MMMMMMmMMMMM....',
    'MMMMMMMMMMMMM...',
    'TKMKTMMMMMMMM...',
    '.MTMMmMMMMmMMM..',
    '.mm..MM..mm..M..',
    'WW..WW..WW...W..',
  ]),
  stalkB: F([
    '................',
    '................',
    '................',
    '................',
    '............mmmm',
    'M....M.....mmm..',
    'MMMMMMmMMMMM....',
    'MMMMMMMMMMMMM...',
    'TKMKTMMMMMMMM...',
    '.MTMMmMMMMmMMM..',
    '.mm..MM..mm..M..',
    'WW..WW..WW...W..',
  ]),
  wiggleA: F([
    '................',
    '................',
    '................',
    '................',
    '................',
    'M....M..MMMm....',
    'MMMMMMmMMMMMm...',
    'MMMMMMMMMMMMmm..',
    'KMMMKMMMMmMM.mm.',
    'MMTMMKMM.MMM..m.',
    '..mmmMM...MM.mm.',
    '.WW.WM...WW.....',
  ]),
  wiggleB: F([
    '................',
    '................',
    '................',
    '................',
    '................',
    '.m..m...MMMm....',
    '.MmMMm.MMMMMM...',
    'mMMMMmMMMMMMMm..',
    'MMMMMMmMMMMMMmm.',
    'mmKMMKMMMmMMM.m.',
    '..mmmMMM.mMM..mm',
    '.WWKWM...WW.....',
  ]),
  // Shifted down one row from the reference sheet, which left row 11 empty: at
  // the two ends of the arc the hop is zero and the cat is supposed to be on the
  // floor, and it hung a pixel above it instead. Row 0 was empty, so this moves
  // the drawing without changing a pixel of it.
  leap: F([
    '................',
    '................',
    '.M...M..........',
    '.MM.MM..........',
    'MMMMMM..........',
    'MKMKMMMMM.......',
    '.MMMMMMMMMMmmmmm',
    '...mMMMMMMMMm..m',
    'mmMMMMMMMMMM....',
    '.WM......MMMM...',
    '..........mMMM..',
    '............mW..',
  ]),
  land: F([
    '................',
    '................',
    '.M...M..........',
    '.MM.MM..........',
    '.MMMMM..........',
    '.mMMMMMMM....mmm',
    '.MMMMMMMMMmmmm.m',
    '..MMMMMMMMMm....',
    '..MMMMMMMMM.....',
    '..MM...MMMM.....',
    '...MM...MM......',
    '....W...WW......',
  ]),
  front: F([
    '................',
    '.MM........MM...',
    '.MMM......MMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MKKMMMMMMKKM...',
    '.MMMMMPPMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '..MMMMMMMMMM....',
    '...MMMMMMMM.....',
    '................',
  ]),
  frontBlink: F([
    '................',
    '.MM........MM...',
    '.MMM......MMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MmmMMMMMMmmM...',
    '.MMMMMPPMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '..MMMMMMMMMM....',
    '...MMMMMMMM.....',
    '................',
  ]),
  frontQuack: F([
    '................',
    '.MM........MM...',
    '.MMM......MMM...',
    '.MMMMMMMMMMMM...',
    '.MKKMMMMMMKKM...',
    '.MKKMMMMMMKKM...',
    '.MMMMMPPMMMMM...',
    '.MMMMKKKKMMMM...',
    '.MMMKKKKKKMMM...',
    '.MMMKKpppKMMM...',
    '..MMKppppKMM....',
    '................',
  ]),
  begA: F([
    'MMM..........MMM',
    'MMMM........MMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMWKKMMMMMMWKKMM',
    'MMKKKMMMMMMKKKMM',
    'MMMMMMMPPMMMMMMM',
    'MMMMMMKKKKMMMMMM',
    'MMMMMKKKKKKMMMMM',
    'MMMMMKKKKKKMMMMM',
    '.MMMMKppppKMMMM.',
    '..MMMKppppKMMM..',
  ]),
  begB: F([
    'MMM..........MMM',
    'MMMM........MMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMWKKMMMMMMWKKMM',
    'MMKKKMMMMMMKKKMM',
    'MMMMMMMPPMMMMMMM',
    'MMMMMMKKKKMMMMMM',
    'MMMMMMKKKKMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMM.',
    '..MMMMMMMMMMMM..',
  ]),
  raidLow: F([
    '................',
    '.......mm.......',
    '...MM..mm..M....',
    '...MMMMmmMMM....',
    '...MMMMmmMMM....',
    '....MMMmmMMM....',
    '...MMMMmmMMMM...',
    '...MMMMMMMMMM...',
    '...MMMMTTMMMM...',
    '...MMMTTTTMMM...',
    '..MMMM....MMMM..',
    '.MMMM......MMMM.',
  ]),
  raidFlapUp: F([
    '....M..mm..M....',
    '.m..MMMmmMMM..m.',
    'MM..MMMmmMMM..MM',
    'MMM.MMMmmMMM.MMM',
    '.MMMMMMmmMMMMMM.',
    '..MMMMMmmMMMMM..',
    '...MMMMMMMMMM...',
    '...MMMMTTMMMM...',
    '...MMMTTTTMMM...',
    '...MMMTTTTMMM...',
    '..MMMM....MMMM..',
    '..MMM......MMM..',
  ]),
  raidFlapMid: F([
    '....M..mm..M....',
    '.m..MMMmmMMM..m.',
    'MM..MMMmmMMM..MM',
    'MMM.MMMmmMMM.MMM',
    '.MMMMMMmmMMMMMM.',
    '..MMMMMmmMMMMM..',
    '...MMMMMMMMMM...',
    '...MMMMTTMMMM...',
    '...MMMTTTTMMM...',
    '...MMMTTTTMMM...',
    '..MMMM....MMMM..',
    '..MMM......MMM..',
  ]),
  raidFlapDown: F([
    '....M..mm..M....',
    '.m..MMMmmMMM..m.',
    'MM..MMMmmMMM..MM',
    'MMM.MMMmmMMM.MMM',
    '.MMMMMMmmMMMMMM.',
    '..MMMMMmmMMMMM..',
    '...MMMMMMMMMM...',
    '...MMMMTTMMMM...',
    '...MMMTTTTMMM...',
    '...MMMTTTTMMM...',
    '..MMMM....MMMM..',
    '..MMM......MMM..',
  ]),
};

// Poses the engine names once but that only read as motion when animated.
// Each entry is a list of [frame, seconds]: the durations are deliberately
// uneven, which is what makes a cat look like a cat rather than a metronome.
const CYCLES = {
  walk: [['walk1', 0.30], ['walk2', 0.14], ['walk3', 0.32], ['walk4', 0.14]],
  wash: [['wash1', 0.55], ['wash2', 0.35], ['wash3', 0.45], ['wash2', 0.22], ['wash3', 0.40]],
  // five beats like wash, not four: at equal pass counts a shorter cycle made
  // the front paw visibly the poor relation of the hindquarters
  lick: [['lick1', 0.50], ['lick2', 0.34], ['lick3', 0.38], ['lick2', 0.26], ['lick3', 0.42]],
  eat: [['eat1', 0.26], ['eat2', 0.20]],
  meow: [['sit', 0.45], ['sitUp', 0.40], ['sitMeow', 0.40], ['sitUp', 0.25], ['sitMeow', 0.40], ['sitUp', 0.55]],
  // The mid-groom pause: it holds the sitting pose and looks up, blinking. The
  // blinks last a third of a second, not the tenth a real one would: the panel
  // redraws 10 times a second, so anything shorter shows for a single frame and
  // reads as a glitch. A cat's slow blink is the right length anyway.
  gaze: [['sit', 1.00], ['sitBlink', 0.30], ['sit', 0.55], ['sitBlink', 0.28],
    ['sit', 1.10], ['sitBlink', 0.34], ['sit', 0.75]],
};
const cycleLen = (n) => CYCLES[n].reduce((s, [, d]) => s + d, 0);

// Which frame of a cycle is showing at time t (the cycle loops).
function cycleFrame(name, t) {
  const cyc = CYCLES[name];
  const total = cyc.reduce((s, [, d]) => s + d, 0);
  let x = t % total;
  for (const [frame, d] of cyc) { if (x < d) return frame; x -= d; }
  return cyc[0][0];
}

// A grooming session is one or two legs: the hindquarters ('wash') and a front
// paw ('lick'). Either can happen on its own — a cat that sits down to lick a
// paw does not owe you the rest of the routine — and about two sessions in five
// carry on to the other leg, with the pause in between: same posture, head
// turned to whoever is watching, blinking.
//
// Two or three passes of a leg, either way round — the two cycles are the same
// length now, so the count means the same thing on both sides. Now and then it
// really settles into one and goes on for up to ten, which is the difference
// between a cat tidying itself up and a cat with a job to do. Each leg rolls its
// own length, so a long one can follow a short one.
const GROOM_LEGS = { wash: [2, 3], lick: [2, 3] };
const GROOM_LONG = [4, 10];
const GROOM_LONG_P = 0.22;
const GROOM_CHAIN = 0.8;         // how often a session does both legs

// A leg is built beat by beat rather than looped from a fixed table. Each leg
// has two working poses it alternates between, and one pose where it comes up
// for air — head raised on the hindquarters, eyes shut on the front paw. Looped,
// that third pose lands at the same place every single pass, and the whole thing
// reads as a machine: two licks, pause, two licks, pause. Here it is dropped in
// before a working beat with a probability, so some passes get none, some get
// two, and it is never in the same place twice running.
// `lift` is the beat where it stops working: on the hindquarters that is head up
// and both eyes on whoever is watching, and it holds it for a good two to four
// seconds — a cat interrupting its own wash to stare at you does not do it in
// half a second. On the front paw the same beat has its eyes shut, so it is a
// breath rather than a look, and stays short.
const GROOM_BEATS = {
  wash: {
    work: [['wash2', 0.35], ['wash3', 0.45], ['wash2', 0.22], ['wash3', 0.40]],
    lift: 'wash1', hold: [2.0, 4.0],
  },
  lick: {
    work: [['lick2', 0.34], ['lick3', 0.38], ['lick2', 0.26], ['lick3', 0.42]],
    lift: 'lick1', hold: [0.42, 0.62],
  },
};
// How many pauses in a WHOLE leg, not a coin flip at every beat. Rolling per
// beat meant a long leg practically always had several, and with a stare now
// lasting seconds that ate two thirds of the wash. Drawn this way, two legs in
// five have none at all and the licking simply runs on, which is the thing being
// asked for; the rest get one, occasionally two, dropped at beats picked at
// random so they are never in the same place.
const GROOM_LIFTS = [[0, 40], [1, 44], [2, 16]];
function legBeats(leg, passes, rnd) {
  const r = rnd || Math.random;
  const b = GROOM_BEATS[leg];
  const beats = [];
  for (let i = 0; i < passes; i++) for (const beat of b.work) beats.push(beat);
  let roll = r() * GROOM_LIFTS.reduce((s, [, w]) => s + w, 0);
  let n = 0;
  for (const [k, w] of GROOM_LIFTS) { if (roll < w) { n = k; break; } roll -= w; }
  const at = new Set();
  while (at.size < Math.min(n, beats.length)) at.add(Math.floor(r() * beats.length));
  const out = [];
  beats.forEach((beat, i) => {
    // its own length every time it happens, so two stares are never the same
    if (at.has(i)) out.push([b.lift, b.hold[0] + r() * (b.hold[1] - b.hold[0])]);
    out.push(beat);
  });
  return out;
}
const beatsLen = (beats) => beats.reduce((s, [, d]) => s + d, 0);
// which beat is showing x seconds into a list, looping
function beatAt(beats, x) {
  let k = x % beatsLen(beats);
  for (const [f, d] of beats) { if (k < d) return f; k -= d; }
  return beats[0][0];
}

function groomPlan(t, first, rnd) {
  const r = rnd || Math.random;
  const lead = GROOM_LEGS[first] ? first : 'wash';
  const legs = r() < GROOM_CHAIN ? [lead, lead === 'wash' ? 'lick' : 'wash'] : [lead];
  const phases = [];
  let at = t;
  const push = (beats) => { at += beatsLen(beats); phases.push({ beats, until: at }); };
  legs.forEach((leg, i) => {
    // exactly one pass of the gaze cycle, so all three blinks always play out —
    // a random pause length would cut the last one off half the time
    if (i) push(CYCLES.gaze);
    const [lo, hi] = r() < GROOM_LONG_P ? GROOM_LONG : GROOM_LEGS[leg];
    push(legBeats(leg, lo + Math.floor(r() * (hi - lo + 1)), r));
  });
  // A one-leg session often ends on that same pause rather than opening on the
  // next leg — it has finished, and now it is looking at you. Without this the
  // blinking would only ever show on the sessions that do both legs, which is
  // too rare to notice.
  if (legs.length === 1 && r() < 0.5) push(CYCLES.gaze);
  return { t0: t, phases, until: at };
}
// Each phase runs its own list of beats from its own start, so a leg always
// opens on a working beat and the pause always opens on an open eye.
function groomFrame(g, t) {
  let from = g.t0;
  for (const p of g.phases) {
    if (t < p.until) {
      let x = t - from;
      for (const [f, d] of p.beats) { if (x < d) return f; x -= d; }
      return p.beats[p.beats.length - 1][0];
    }
    from = p.until;
  }
  const last = g.phases[g.phases.length - 1].beats;
  return last[last.length - 1][0];
}

const TOWER_W = 10;
// Where the tower stands: near the LEFT edge of the floor, but not against it.
// The sleeping cat is 16 px wide against a 10 px platform, so centring it puts
// its left edge 3 px left of the tower's — at 2 that landed off screen and the
// cat was clamped to 0, losing its left side and sitting off-centre on its own
// platform.
function towerBaseX() { return 6; }
// Tower height in pixels, adapted to the canvas height (H = rows*2): tall
// terminals get a tall tower. Chosen so the sleeping cat always overflows by
// the same 2 rows, which the ui reserves (the bubble + marker lines).
function towerPx(H) { return Math.max(4, Math.min(12, H - 8)); }
// The cat is 16 px wide and the platform 10: centred, it overhangs by 3.
function towerCatX() { return Math.max(0, towerBaseX() - 3); }

module.exports = {
  SPR_CAT, CYCLES, cycleFrame, cycleLen, groomPlan, groomFrame, legBeats, beatAt,
  TOWER_W, towerBaseX, towerPx, towerCatX,
};
