# ccduck 🦆 🐈

Your Claude Code limits as live gauges in the terminal — with a pixel-art duck, or a cat,
living its own life underneath them and panicking when you get close.

```
 CCDUCK  v2.9.3 Claude tokens                             21:34:07 · usage 2min
 ─────────────────────────────────────────────────────────────────────────────
 SESSION 5h ████████████████████▊·············  46% • $137 · 118M      ↺ 3h10
 WEEK       ███████████████████████████·······  60% • $870 · 791M      ↺ 2d13h
 FABLE 7d   █████████████████████████████████▎  81% ≈ $652 · 484M      ↺ 2d13h
```

Official `/usage` percentages when they are reachable (`•`), estimates otherwise (`≈`),
`—` when nothing reliable is available: it never invents a number. Same marks on the reset
times, `↺` official and `≈` derived locally. Plus what `/usage` does not give you — cost,
tokens, burn rate, end-of-block projection, per-model table.

Nothing to connect, no API key: everything is read from files Claude Code already keeps on
your machine. Zero dependencies, Node ≥ 18, built for a 56-column panel.

## Install

```bash
git clone https://github.com/aanze/ccduck.git && cd ccduck && npm install -g .
```

Then, from any terminal, anywhere:

```bash
ccduck
```

`cccat` starts in cat mode. On Windows the global install is a junction to the clone, so
`git pull` — or the `u` key — is enough to update. No clone needed? Either
`npm install -g git+https://github.com/aanze/ccduck.git`, or the `.tgz` in [`dist/`](dist/).

Command not found: check that npm's global folder (`npm prefix -g`, typically
`%APPDATA%\npm`) is on your `PATH`, then reopen the terminal.

## Keys

`m`, `c`, `x`, `k`, `z` and `a` are written straight to `~/.ccduck.json` — pick a coat once
and it is still there next launch. The flags below are not: they override the config for
that run only.

| Key | Action |
|---|---|
| `q` | quit |
| `f` / `s` | throw seeds / drop a sedative pill (5 min nap) |
| `x` / `k` | swap duck ⇄ cat / next coat (duck `classic`,`green` — cat `brown`,`grey`) |
| `z` | alerts off: it stops watching the gauges entirely, and just lives |
| `r` / `m` / `c` | refresh now / metric cost→tokens→no-cache / per-model table |
| `d` / `p` | demo (75 % → 93 % → sweep → off) / pause |
| `u` | install the update when the header offers one |
| `a` | auto-reauth: renew the expired token yourself, or not (default: not) |

## Options

| Flag | What it does |
|---|---|
| `--once` | static snapshot, then exit |
| `--cat`, `--duck` | which animal, this run only (`cccat` = `ccduck --cat`) |
| `--no-alerts` | it ignores the gauges: no pointing, no panic |
| `--metric M` | `cost` \| `total` \| `billable` at startup |
| `--demo[=PCT]` | force the gauges (default: an animated sweep) |
| `--size CxR` | force the size, e.g. `90x32` |
| `--frames N` | render N frames as a stream, outside a TTY |
| `--no-color` | 256 colours even when truecolor is available |
| `--config PATH` | another config file (default `~/.ccduck.json`) |
| `--edit` | sprite editor |
| `--update` | update now: `git pull`, or reinstall from the repo |
| `--auto-reauth` | renew the expired OAuth token instead of waiting for Claude Code |
| `--debug-usage` | every usage source with its state, the token's expiry, then a forced call |
| `--mirror`, `--mirror-watch` | copy the app's usage file to `~/.ccduck-plan.json`, once or every 60 s |
| `--help`, `--version` | |

## Configuration — `~/.ccduck.json`

Optional, everything in it is optional.

```json
{ "pet": "cat", "catSkin": "grey", "alert": 70, "panic": 90, "planLabel": "Max 20x" }
```

| Key | Role |
|---|---|
| `pet` | `duck` (default) or `cat` |
| `duckSkin` / `catSkin` | `classic`\|`green` — `brown`\|`grey`. Colours only, drawings untouched |
| `alerts` | `false` = it never watches the gauges |
| `alert` / `panic` | thresholds (%) for the 5-hour block (70 / 90) |
| `weeklyAlert` / `weeklyPanic` | same for the weekly gauges, deliberately higher (85 / 96) |
| `metric` | `cost` (default), `total`, `billable` — display unit only; `%` always on weighted cost |
| `limits.*` | in API-equivalent dollars, or `"auto"` — only used by the `≈` gauges |
| `premiumFamily` / `premiumShare` | `auto`\|`fable`\|`opus`, and its share of the weekly envelope (`0.5`) |
| `weeklyReset` | `{ "weekday": 3, "hour": 9 }` — only when no official reset is available |
| `historyDays` | history parsed and auto-calibration window (35) |
| `refreshSec` / `fps` | transcript rescan rate / animation rate |
| `planLabel` | label shown in the header |
| `planUsageDir` | folder holding `plan-usage-history.json`, when auto-detection fails |
| `showTable` | the per-model table at the bottom |
| `checkUpdates` | `false` disables every call to GitHub |
| `autoReauth` | `true` = ccduck renews the expired OAuth token itself |

## Environment variables

The rare behaviours are on long timers. These shorten them, in seconds, for that run only —
the real wait lands between the value and twice it.

| Variable | Effect |
|---|---|
| `CCDUCK_HUNGRY_SEC` | delay before it begs, then escalates, then raids the bars |
| `CCDUCK_RAIN_EVERY` | rain (duck) / the fly it chases (cat) — same timer |
| `CCDUCK_ZOOM_EVERY` | the cat's zoomies |
| `CCDUCK_CLAUDE_DIR` | explicit folder holding `plan-usage-history.json` |
| `CCDUCK_STATE`, `CCDUCK_UPDATE_STATE` | where state is persisted (so tests never touch the real files) |

```bash
CCDUCK_HUNGRY_SEC=20 cccat
```

PowerShell has no `VAR=x cmd` prefix: `$env:CCDUCK_HUNGRY_SEC=20; cccat`, then
`Remove-Item Env:CCDUCK_HUNGRY_SEC`.

## Where the numbers come from

Freshest reading wins, window by window — never a blend, and anything older than 15 min is
dropped rather than shown as fact.

1. **The Claude app's own reading**, written every 5 min: no token, no network, so no 401
   and no 429. Read from `%LOCALAPPDATA%\Packages\Claude_*\...` first, because the Windows
   app is packaged (MSIX) and `%APPDATA%\Claude` is a virtualised view another packaged
   shell cannot see. The 5-minute gap is filled from the transcripts (`src:app+live`).
2. **The `/usage` endpoint**, with the OAuth token already on the machine — the only source
   carrying the Fable bucket and the exact reset times. The `refreshToken` is never used by
   default: Anthropic rotates it, and using it can sign your Claude Code out.
3. **Claude Code's VS Code cache**, only if more recent than the rest.
4. **The transcripts**: every cost, burn rate and table, and the gauges' last resort.

No daily gauge: that limit does not exist at Anthropic.

## Sprite editor

```bash
ccduck --edit
```

Live preview beside the 16×12 grid of palette letters. `tab` walks the poses, `x` swaps
animals, `s` saves, `d`/`D` restore one pose or all of them. Edits live in
`~/.ccduck-sprites.json` and never touch `src/`, so the originals cannot be lost.

## Troubleshooting

`ccduck --debug-usage` lists every source with its state. When nothing answers, ccduck also
prints that diagnosis on screen instead of the stats line.

| Symptom | Fix |
|---|---|
| `— no official data`, `app file: not found` | the shell cannot see the app's folder (MSIX). Set `planUsageDir` or `CCDUCK_CLAUDE_DIR`, or run `--mirror-watch` from a shell that can |
| `token expired` | normal every ~8 h; the gauges stay right without it. `a` renews it yourself |
| `rate-limited (retry Xmin)` | server-imposed delay, counted per outgoing IP. Don't push, it clears |
| `tls …` | corporate proxy: `NODE_OPTIONS=--use-system-ca`, or point `NODE_EXTRA_CA_CERTS` at the internal CA |
| wrong numbers after a pull | `ccduck --version` — a `.tgz` install is a frozen copy, and a running instance keeps its code in memory |
| `permission denied` (macOS/Linux) | `chmod +x bin/ccduck.js` |

## Development

```bash
node bin/ccduck.js --frames 40 --size 80x24
```

Behaviour engine and duck sprites in [src/duck.js](src/duck.js), cat in
[src/cat.js](src/cat.js), usage sources in [src/data.js](src/data.js), rendering in
[src/ui.js](src/ui.js). Tests are deterministic simulations: drive `update(dt, ctx)` in a
loop and count the frames that come out.

Percentages are landmarks, not Anthropic's official counters — `/usage` remains the
reference.
