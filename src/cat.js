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
    '.MM.MM......mmm.',
    '.MMMMM.....mm.m.',
    'MMMMMM.....mm...',
    'MKMMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM....MMMM....',
    '..MM....MM......',
    '..WW....WW......',
  ]),
  blink: F([
    '.MM.MM......mmm.',
    '.MMMMM.....mm.m.',
    'MMMMMM.....mm...',
    'MmMMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM....MMMM....',
    '..MM....MM......',
    '..WW....WW......',
  ]),
  walk1: F([
    '.MM.MM......mmm.',
    '.MMMMM.....mm.m.',
    'MMMMMM.....mm...',
    'MKMMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM.....MMMMM..',
    '.MMM.....MM.WW..',
    '.WW......WW.....',
  ]),
  walk2: F([
    '................',
    '.MM.MM......mmm.',
    '.MMMMM.....mm.m.',
    'MMMMMM.....mm...',
    'M.MMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM....MM..MM..',
    '.WW....WW...WW..',
  ]),
  walk3: F([
    '.MM.MM.......mm.',
    '.MMMMM......mm..',
    'MMMMMM.....mm...',
    'MKMMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '.MMM.....MMMM...',
    '.MM........MM...',
    '.W..........W...',
  ]),
  walk4: F([
    '................',
    '.MM.MM.......mm.',
    '.MMMMM......mm..',
    'MMMMMM.....mm...',
    'MKMMMM.....mm...',
    'MMMMMM....mm....',
    '..MMMMMMMMMm....',
    '..MMMMMMMMMM....',
    '..MMMMMMMMMMM...',
    '..MMMMMMMMMMM...',
    '..MM.......MMM..',
    '.WW.........MW..',
  ]),
  sit: F([
    '.MM.MM..........',
    '.MMMMM..........',
    'MMMMMM..........',
    'MKMMMM..........',
    'MMMMMM..........',
    '..MMM.......mm..',
    '.MMMMM......mm..',
    '.MMMMMM....mm...',
    '.MMMMMMM..mm....',
    '.M.MMmMMMmm.....',
    '.M.MMmMMMM......',
    '.W.W.MMMMM......',
  ]),
  // Not in the reference sheet: the seated blink, derived from 'sit' the exact
  // way the sheet's own 'blink' derives from 'stand' — the eye K becomes an m.
  sitBlink: F([
    '.MM.MM..........',
    '.MMMMM..........',
    'MMMMMM..........',
    'MmMMMM..........',
    'MMMMMM..........',
    '..MMM.......mm..',
    '.MMMMM......mm..',
    '.MMMMMM....mm...',
    '.MMMMMMM..mm....',
    '.M.MMmMMMmm.....',
    '.M.MMmMMMM......',
    '.W.W.MMMMM......',
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
    '..MMMM......mm..',
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
    '..MMKMMM........',
    '..MMMKMMM.......',
    '...MMMT.........',
    '..MMmKMM.....mm.',
    '..MMMM......mm..',
    '.MMMMMM....mm...',
    '.MMMMMmM..mm....',
    '.M.MMmMMMmm.....',
    '.M.MMmMMMm......',
    '.W.W.MMMMM......',
  ]),
  panicB: F([
    '................',
    '...MMM..........',
    '..MMMmMM........',
    '..MMMKMMM.......',
    '...MMMT.........',
    '..MMMKMM..mm.mm.',
    '..MMMM.....mm.m.',
    '.MMMMMM....KmK..',
    '.MMMMMmM....mm..',
    '.M.MMmMMM..mm...',
    '.M.MMmMMMmmm....',
    '.W.W.MMMMM......',
  ]),
  wash1: F([
    '................',
    '.MM.MM..........',
    '.MMMMM..........',
    'MMMMMMWW........',
    'MKMMMMWW........',
    'MMMMMMmM...Wm...',
    '..MMMKmMm...mm..',
    '.MMMMMmMMm...m..',
    '.MMMMMmMMmM..m..',
    '.M.MmMmMMMM.mm..',
    '.M.MmMMMMMMmm...',
    '.W.WmMMMMMMM....',
  ]),
  wash2: F([
    '..M..M..........',
    '..MMMMM.........',
    '.MMMMMM.........',
    '.MKMMmW.........',
    '.MMMMmWm........',
    '..pMMmMMm..Wm...',
    '...pMMmMmM..mm..',
    '....MMmMMmM..m..',
    '....MMmMMMm..m..',
    '....MMmMMMM.mm..',
    '....MmMMMMMmm...',
    '...WWmMMMMMm....',
  ]),
  wash3: F([
    '..M..M..........',
    '..MMMMM.........',
    '.MMMMmW.........',
    '.MKMMmW.........',
    '.MMMMmMM........',
    '..pmMMmMm..Wm...',
    '...MMMmMmM..mm..',
    '...MMMmMMmM..m..',
    '...MMMmMMMm..m..',
    '...MmMmMMMM.mm..',
    '...MmMMMMMMmm...',
    '..WWmMMMMMMm....',
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
    '.MMMMMmM........',
    '..MMKmmMM...mm..',
    '...pMmMMMM..mm..',
    '..MMWMMMMM..m...',
    '...MMMmMMM.mm...',
    '....MmMMMM.m....',
    '....MmMMMMmm....',
    '...WWmMMMMm.....',
  ]),
  sleep: F([
    '................',
    '................',
    '.....MMMMMMm....',
    '...mMMmMMMMMM...',
    '.MmMMmMmMMMMMM..',
    '.MMMMMMmMmmMMMm.',
    '.MMMMMMMmMMMMMm.',
    '.MKKMMKMmMMMMMm.',
    '.mMMMpMmmMMMKMm.',
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
    '.mMMpMKMmMMKmm..',
    '..mmmmmKmmmmm...',
    '...mmMMmmmmm....',
    '................',
  ]),
  billUp: F([
    '..MM.MM.....mmm.',
    '..MMMMM....mm.m.',
    '.MMMMMM....mm...',
    '.MKMMMM....mm...',
    '.MMMMMM...mm....',
    '..MMMMMMMMMm....',
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
    'KMMMMMMMMMMMM...',
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
    '........MMMm....',
    '.MMMMM.MMMMMM...',
    'mMMMMmMMMMMMMm..',
    'MMMMMMmMMMMMMmm.',
    'mmMMMKMMMmMMM.m.',
    '..mmmMMM.mMM..mm',
    '.WWKWM...WW.....',
  ]),
  leap: F([
    '................',
    '.M...M..........',
    '.MMMMM..........',
    'MMMMMM..........',
    'MKMMMMMMM.......',
    'TMMMMMMMMMMmmmmm',
    '...mMMMMMMMMm..m',
    'mmMMMMMMMMMM....',
    '.WM......MMMM...',
    '..........mMMM..',
    '............mW..',
    '................',
  ]),
  land: F([
    '................',
    '................',
    '.M...M..........',
    '.MMMMM..........',
    'MMMMMM..........',
    'MKMMMMMMM....mmm',
    'MMMMMMMMMMmmmm.m',
    '.MMMMMMMMMMm....',
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
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '................',
  ]),
  frontBlink: F([
    '................',
    '.MM........MM...',
    '.MMM......MMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MKKMMMMMMKKM...',
    '.MMMMMPPMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
    '.MMMMMMMMMMMM...',
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
    '.MMMKppppKMMM...',
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
    'MMWKKMMMMMMKKKMM',
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
  lick: [['lick1', 0.45], ['lick2', 0.30], ['lick3', 0.32], ['lick2', 0.24]],
  eat: [['eat1', 0.26], ['eat2', 0.20]],
  meow: [['sit', 0.45], ['sitUp', 0.40], ['sitMeow', 0.40], ['sitUp', 0.25], ['sitMeow', 0.40], ['sitUp', 0.55]],
  // the mid-groom pause: it holds the sitting pose and looks up, blinking
  gaze: [['sit', 1.05], ['sitBlink', 0.13], ['sit', 0.62], ['sitBlink', 0.11],
    ['sit', 1.25], ['sitBlink', 0.14], ['sit', 0.80]],
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

// One grooming session. A cat does not wash itself for two seconds: it settles
// down, works the hindquarters for several cycles, stops to look up at whoever
// is watching — same posture, just the head turned, blinking — and only then
// starts on a front paw. The shape of the routine is a drawing concern, so it
// lives here; the behaviour code only asks when the whole thing ends.
function groomPlan(t, rnd) {
  const r = rnd || Math.random;
  const wash = t + cycleLen('wash') * (3 + Math.floor(r() * 3));
  const pause = wash + 2.4 + r() * 1.6;
  return { t0: t, washUntil: wash, pauseUntil: pause, until: pause + cycleLen('lick') * (3 + Math.floor(r() * 3)) };
}
// Each leg restarts its cycle from its first frame, so a session always opens on
// wash1 and the pause always opens on an open eye.
function groomFrame(g, t) {
  if (t < g.washUntil) return cycleFrame('wash', t - g.t0);
  if (t < g.pauseUntil) return cycleFrame('gaze', t - g.washUntil);
  return cycleFrame('lick', t - g.pauseUntil);
}

const TOWER_W = 10;
// Where the tower stands: pinned to the LEFT edge of the floor.
function towerBaseX() { return 2; }
// Tower height in pixels, adapted to the canvas height (H = rows*2): tall
// terminals get a tall tower. Chosen so the sleeping cat always overflows by
// the same 2 rows, which the ui reserves (the bubble + marker lines).
function towerPx(H) { return Math.max(4, Math.min(12, H - 8)); }
// The cat is 16 px wide and the platform 10: centred, it overhangs by 3.
function towerCatX() { return Math.max(0, towerBaseX() - 3); }

module.exports = {
  SPR_CAT, CYCLES, cycleFrame, groomPlan, groomFrame,
  TOWER_W, towerBaseX, towerPx, towerCatX,
};
