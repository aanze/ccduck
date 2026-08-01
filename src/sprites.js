'use strict';
// Sprite overrides for the editor (`--edit`).
//
// The one rule this file exists to enforce: an edit NEVER touches src/duck.js or
// src/cat.js. Every change lives in ~/.ccduck-sprites.json, and the drawings
// compiled into the source stay the reference copy. So "back to default" is
// always available, for one pose or for the lot, and reinstalling or pulling
// cannot silently lose someone's work either.
//
// Shape of the file:
//   { "cat": { "stand": ["................", … 12 rows of 16], … }, "duck": { … } }
// Anything malformed is dropped with a warning rather than crashing the app:
// a hand-edited file should never stop the monitor from starting.
const fs = require('fs');
const os = require('os');
const path = require('path');

const W = 16, H = 12;

function overridePath() {
  return path.join(os.homedir(), '.ccduck-sprites.json');
}

// A grid is valid if it is 12 rows of 16, and every character is either '.' or a
// letter the palette knows. An unknown letter would render as magenta.
function validate(rows, PAL) {
  if (!Array.isArray(rows) || rows.length !== H) return 'expected ' + H + ' rows';
  for (const r of rows) {
    if (typeof r !== 'string' || r.length !== W) return 'expected rows of ' + W + ' characters';
    for (const c of r) if (c !== '.' && !(c in PAL)) return 'unknown palette letter "' + c + '"';
  }
  return null;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(overridePath(), 'utf8'));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}

function save(all) {
  fs.writeFileSync(overridePath(), JSON.stringify(all, null, 2) + '\n');
}

// Applies the stored overrides onto the live tables. Returns what it did, so the
// caller can say so rather than changing the drawings behind the user's back.
function apply(tables, PAL) {
  const all = load();
  const applied = [], rejected = [];
  for (const pet of Object.keys(all)) {
    const table = tables[pet];
    if (!table) { rejected.push(pet + ': unknown animal'); continue; }
    for (const name of Object.keys(all[pet] || {})) {
      if (!table[name]) { rejected.push(pet + '.' + name + ': unknown pose'); continue; }
      const err = validate(all[pet][name], PAL);
      if (err) { rejected.push(pet + '.' + name + ': ' + err); continue; }
      table[name].splice(0, H, ...all[pet][name]);
      applied.push(pet + '.' + name);
    }
  }
  return { applied, rejected };
}

// The default table, kept aside before anything is applied: this is what "back
// to default" restores from, so it must be captured before apply() runs.
function snapshot(tables) {
  const out = {};
  for (const pet of Object.keys(tables)) {
    out[pet] = {};
    for (const name of Object.keys(tables[pet])) out[pet][name] = tables[pet][name].slice();
  }
  return out;
}

function setOverride(pet, name, rows) {
  const all = load();
  if (!all[pet]) all[pet] = {};
  all[pet][name] = rows.slice();
  save(all);
}

function clearOverride(pet, name) {
  const all = load();
  if (all[pet]) {
    delete all[pet][name];
    if (!Object.keys(all[pet]).length) delete all[pet];
  }
  save(all);
}

function clearAll() {
  try { fs.unlinkSync(overridePath()); } catch (e) { /* already gone */ }
}

function count() {
  const all = load();
  let n = 0;
  for (const pet of Object.keys(all)) n += Object.keys(all[pet] || {}).length;
  return n;
}

module.exports = { overridePath, validate, load, apply, snapshot, setOverride, clearOverride, clearAll, count, W, H };
