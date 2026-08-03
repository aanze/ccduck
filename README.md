# ccduck 🦆 🐈

A **Claude Code** usage monitor for your terminal: your real limits as live gauges, and a
pixel-art animal living its own life underneath them — which panics when you get close.

The project is called ccduck and shipped with a duck, but **the cat is not a skin, it is a
second animal**: 38 drawings against the duck's 22, its own habits, its own furniture. Run
`ccduck` or `cccat`, or press `x` to swap at any time.

```
 CCDUCK  v2.8.1 Claude tokens                             21:34:07 · usage 2min
 ─────────────────────────────────────────────────────────────────────────────
 SESSION 5h ████████████████████▊·············  46% • $137 · 118M      ↺ 3h10
 WEEK       ███████████████████████████·······  60% • $870 · 791M      ↺ 2d13h
 FABLE 7d   █████████████████████████████████▎  81% ≈ $652 · 484M      ↺ 2d13h
```

- **Gauges aligned with Anthropic's real limits**: the 5-hour SESSION block, WEEK, and the
  premium family (FABLE or OPUS) over the week — with the **official percentages from
  `/usage`** (marked `•`), estimates `≈` otherwise, and `—` when nothing reliable is
  available. It never invents a percentage.
- **Everything `/usage` does not give you**: API-equivalent cost, tokens (in/out/cache),
  daily total, $/h and tok/min burn rates, end-of-block projection, messages today,
  sub-agent share, per-model table.
- Built for the narrow terminal panel of the Claude Code window (56 columns and up, mini
  mode below that), zero dependencies, Node ≥ 18.

## The animals

Both run on the same engine, frame for frame: the behaviour code is shared, only the
drawings and a few habits differ.

### A life of its own

It swims or saunters, drifts, dabbles head-down, grooms itself, and sleeps — naps up to
1 min when everything is below 30 %, 30 s otherwise. It only ever speaks in onomatopoeia
(“quack”, “meow”, “zzz…”); **only limit warnings get actual words**. After a stroll it
sometimes stops, turns to face you, blinks twice, lets out a QUACK and goes back to its
business. Two distinctive poses never follow each other from one frame to the next: it
always straightens up in between.

### Watching your limits

As soon as the SESSION gauge crosses **70 %**, it moves under that gauge's tip and points
at it; at **90 %** it's full **panic** — in 20-30 s bursts, broken up by a lap around the
pond, then it starts over.

The **weekly gauges have their own, higher thresholds** (**85 %** and **96 %**,
`weeklyAlert` / `weeklyPanic`): a week fills over seven days, so 80 % of it is not the news
80 % of a five-hour block is — and below panic they only get short pointing bursts with
long breaks instead of monopolising the animal. **Several gauges above the threshold are
handled in turn**, one per burst, each with a `▲` marker. One exception: the premium gauge
(FABLE/OPUS) only ever triggers a **soft alert**, never panic — the other models stay
usable — and at equal severity it steps aside for a global limit.

**Not in the mood to be watched?** `z` (or `--no-alerts`, or `"alerts": false`) switches it
off entirely: no pointing, no panic, no markers. Every other behaviour carries on, and the
gauges are still read and coloured the same.

### Feeding it, and what follows

Press `f` to **throw a handful of seeds**: it rushes over (even mid-panic), pecks for a
while (“nom nom nom”), then goes back to its business — leftovers keep floating for later.
Press `s` to drop a two-tone **sedative pill**: it mistakes it for food, swallows it… and
sleeps for **5 minutes**, peaceful, even in full panic.

After a good meal, the occasional little **“plop”** — tail up for two or three seconds —
then the dropping drifts downstream at exactly the speed of the current for a minute before
sinking. Foraging counts as a meal, so this happens on its own; feeding just brings it on
sooner.

With no food for **10 minutes** it comes **begging**: it crosses over, presses its head
against the screen and quacks its beak off, and comes back every 1 to 2 min until you give
in. If you don't, it comes back more and more often (every 35-70 s, then 22-45 s), and
after **30 minutes** it stops asking: it **raids the progress bars**, tearing crumbs off
them to peck from the water and leaving the gauges full of holes. Those close up slowly, in
four stages over 4 minutes — and since a crumb isn't a meal, it keeps coming back until
someone feeds it properly.

### Duck only

**Weather**: every 7 to 25 min a **shower** lasting 30 s to 5 min crosses the pond
(raindrops in front of the duck, splashes on the water). After a few seconds it raises its
beak to the sky, looks left then right, and starts dabbling like mad — 10 s at most,
repeatable while the rain lasts but never twice in a row without a 30 s break.

### Cat only

It saunters instead of paddling — and mostly does not move at all, spending its time
sitting, grooming or asleep. It **naps twice as often** as the duck, never for less than
30 s and never twice inside two minutes, curled up on a **cat tower**: it walks over, stops
a stride and a half to the side, gathers itself in a still crouch, and **jumps across** —
or, one nap in three, curls up right where it is standing.

It **grooms** constantly, alternating the hindquarters and a **front paw**, with pauses
where it holds the pose and stares at whoever is watching, blinking. It purrs and meows,
and every 2 to 5 minutes gets **the zoomies**: it stalks, wiggles its rear — the spring
loading, which belongs to hunting and to nothing else — and pounces in an arc on something
that is not there.

Where a shower would have fallen on the duck, a **fly** shows up instead. It keeps after
that one fly for as long as it stays within reach, bolting at three times its idle speed
whenever the cat closes in, until the cat loses interest or it gets away. It never catches
it. Being on dry land it makes no wake, no splash, and buries its business off screen.

### Skins

`k` cycles the coat of whichever animal is out. A skin is **a colour mapping and nothing
else** — the drawings are untouched, only the palette letters are remapped:

| Animal | Skins |
|---|---|
| Duck | `classic` (yellow) · `green` |
| Cat | `brown` (tabby) · `grey` (dark grey) |

The beak, eyes, white paws and the tower's wood stay put in every skin: they are what the
coat is read against. The cat's greys are pure (equal RGB) on purpose — they land on the
256-colour grey ramp, which is far finer than the colour cube, so the shading survives on a
terminal without truecolor. Session only; `duckSkin` / `catSkin` in the config make it
stick.

## Install

Requires [Node.js](https://nodejs.org) ≥ 18 (ships with npm — already there if Claude Code
is running).

### From the repository (recommended)

```bash
git clone https://github.com/aanze/ccduck.git
```

```bash
cd ccduck && npm install -g .
```

> On Windows, `npm install -g <folder>` creates a **junction** to the clone: a plain
> `git pull` in the clone updates the command, no reinstall needed — which is exactly what
> the `u` key does. (Over SSH: `git clone git@github.com:aanze/ccduck.git`.)

### From the bundled package (no clone)

A ready-to-use npm package sits in [`dist/`](dist/) (and is attached to GitHub Releases).
Download the `.tgz`, then:

```bash
npm install -g ./ccduck-2.8.1.tgz
```

(Frozen copy: to update, reinstall the next version's `.tgz`.)

### One-liner (no clone)

```bash
npm install -g git+https://github.com/aanze/ccduck.git
```

Then, from **any terminal, anywhere**:

```bash
ccduck
```

…or, to start straight in cat mode:

```bash
cccat
```

(`claude-duck` works too, and `ccduck --cat` / `--duck` pick the animal for one run without
touching the config.) Uninstall with `npm uninstall -g ccduck`.

### Check

```bash
ccduck --version
```

```bash
ccduck --once
```

If the command isn't found: make sure npm's global folder (`npm prefix -g`, typically
`%APPDATA%\npm` on Windows) is on your `PATH`, then reopen the terminal.

## Keys

| Key | Action |
|---|---|
| `q` | quit |
| `f` | throw a handful of seeds |
| `s` | drop a sedative pill (5 min nap, even mid-panic) |
| `x` | swap the animal: duck ⇄ cat |
| `k` | next skin for whichever animal is out |
| `z` | alerts off: it stops watching the gauges entirely, and just lives |
| `r` | refresh now (otherwise every 10 s) |
| `m` | metric: cost → tokens → no-cache |
| `c` | show/hide the per-model table |
| `d` | demo: 75 % → 93 % → sweep → off (to watch the animal lose it) |
| `p` / space | pause |
| `u` | install the update when the header offers one |
| `a` | auto-reauth: renew the expired token yourself, or not (default: not) |

Everything toggled by a key is **session only**. The config file makes it permanent.

## Options

| Flag | What it does |
|---|---|
| `--once` | print a static snapshot and exit |
| `--cat`, `--duck` | which animal, for this run only (`cccat` = `ccduck --cat`) |
| `--no-alerts` | the animal ignores the gauges: no pointing, no panic |
| `--metric M` | `cost` \| `total` \| `billable` at startup |
| `--demo[=PCT]` | force the gauges (default: an animated sweep) — guaranteed panic |
| `--size CxR` | force the size, e.g. `90x32` |
| `--frames N` | render N frames as a stream, outside a TTY |
| `--no-color` | 256-colour output even when truecolor is available |
| `--config PATH` | use another config file (default `~/.ccduck.json`) |
| `--edit` | sprite editor (see below) |
| `--update` | update now: `git pull`, or reinstall from the repository |
| `--auto-reauth` | renew the expired OAuth token instead of waiting for Claude Code |
| `--debug-usage` | list every usage source with its state, the token's expiry, then force a call and print the raw response |
| `--mirror` | copy the Claude app's usage file to `~/.ccduck-plan.json` once |
| `--mirror-watch` | same, refreshed every 60 s (leave it running) |
| `--help`, `--version` | |

`--mirror` is a last resort for a shell that cannot reach the app's folder at all; since
ccduck reads the packaged app's physical path it is rarely needed. See
[Troubleshooting](#troubleshooting).

## Environment variables

The rare behaviours run on timers of several minutes, so they are easy to never see. These
shorten them — they change nothing else, and only for that run. Each takes seconds, and the
real wait lands between the value and twice it.

| Variable | Effect |
|---|---|
| `CCDUCK_HUNGRY_SEC` | delay before it starts begging (then escalating, then raiding the bars) |
| `CCDUCK_RAIN_EVERY` | wait between showers (duck) and between flies (cat) — same timer |
| `CCDUCK_ZOOM_EVERY` | wait between the cat's zoomies |
| `CCDUCK_CLAUDE_DIR` | explicit folder holding `plan-usage-history.json`, when auto-detection fails |
| `CCDUCK_STATE` | where the usage state is persisted (default `~/.ccduck-usage.json`) — mainly so tests never touch the real one |
| `CCDUCK_UPDATE_STATE` | same idea for the update-check state |

```bash
CCDUCK_HUNGRY_SEC=20 cccat
```

On Windows PowerShell the `VAR=x cmd` prefix does not exist — set the variable first, and
clear it afterwards:

```bash
$env:CCDUCK_HUNGRY_SEC=20; cccat
```

```bash
Remove-Item Env:CCDUCK_HUNGRY_SEC
```

## Configuration — `~/.ccduck.json`

Optional file, to be created in your home folder. Everything in it is optional:

```json
{
  "pet": "cat",
  "catSkin": "grey",
  "metric": "cost",
  "alert": 70,
  "panic": 90,
  "weeklyAlert": 85,
  "weeklyPanic": 96,
  "planLabel": "Max 20x",
  "limits": { "session": "auto", "week": 250, "premium": "auto" }
}
```

| Key | Role |
|---|---|
| `pet` | `duck` (default) or `cat` — which animal lives in the panel (the `x` key) |
| `duckSkin` / `catSkin` | coat colours, drawings unchanged: `classic`/`green` and `brown`/`grey` (the `k` key) |
| `alerts` | `true` by default. `false` = it never watches the gauges (the `z` key, `--no-alerts`) |
| `alert` / `panic` | thresholds (%) for the 5-hour block: pointing, then panic (70 / 90) |
| `weeklyAlert` / `weeklyPanic` | same for the weekly gauges, deliberately higher (85 / 96) |
| `metric` | `cost` (default), `total` or `billable` — the **display unit** for the figures only; estimated `%` are always computed on weighted cost (press `m` to switch) |
| `limits.*` | in **API-equivalent dollars**, or `"auto"` (historical peak) — only used by the estimated `≈` gauges |
| `premiumFamily` | `auto` (fable if used, opus otherwise), `fable` or `opus` |
| `premiumShare` | share of the weekly envelope allocated to the premium model, for the estimation formula (default `0.5`) |
| `weeklyReset` | weekly reset day/hour (`weekday`: 0 = Sunday … 6 = Saturday) — only useful when no official reset is available; otherwise the real one is used automatically |
| `historyDays` | how much history is parsed, and the auto-calibration window (default 35) |
| `refreshSec` / `fps` | transcript rescan rate / animation rate |
| `planLabel` | label shown in the header (e.g. `"Max 20x"`) |
| `planUsageDir` | explicit folder holding `plan-usage-history.json`, when auto-detection fails |
| `showTable` | `true` by default: the per-model table at the bottom (the `c` key) |
| `checkUpdates` | `true` by default: checks twice a day whether a newer version exists. `false` disables every call to GitHub |
| `autoReauth` | `false` by default: at `true`, ccduck renews the expired OAuth token itself (the `a` key, [details](#auto-reauth--the-a-key)) |

## Where the numbers come from

**Nothing to connect, no key to provide.** Window by window, ccduck keeps **the freshest
reading** among the sources below — never a blend of them. A reading older than 15 minutes
is dropped rather than shown as fact.

**0. The Claude app's own reading** (`•`, the bedrock). The app writes its usage there
**every 5 min** — `fh` = 5-hour session, `sd` = weekly, as percentages. No token, no
network call: **no 401 and no 429 possible**. This is what keeps the numbers right at all
times, even with an expired token. ccduck reads it from, in order:

```
%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\plan-usage-history.json
%APPDATA%\Claude\plan-usage-history.json
~/Library/Application Support/Claude/plan-usage-history.json      (macOS)
```

The first one matters more than it looks: the Windows app is **packaged (MSIX)**, so
`%APPDATA%\Claude` is a *virtualised view* only processes with the same package identity
can see. A shell started by another packaged app — Windows Terminal from the Store, the
Claude Code terminal panel — gets its own empty view and finds nothing there. The physical
path under `Packages\` is readable from any shell, which is why it comes first.

Between two readings the gauge would lag by up to 5 minutes, which is a lot while you are
burning tokens. ccduck closes the gap from the transcripts: consumption since the last
reading, converted into percentage points by a factor **calibrated on the app's own
history** (measured Δ% over measured Δcost). Nothing is invented — with no usable factor,
the raw reading is kept. The footer shows `src:app+live` when that is active.

**1. The official `/usage` endpoint** (`•`, real time + Fable counter):
`api.anthropic.com/api/oauth/usage`, authenticated with the OAuth token **already present**
on the machine (`~/.claude/.credentials.json`, or the Keychain on macOS). This is literally
what Claude Code's `/usage` screen shows — **all three gauges, Fable bucket included**,
with exact reset times. Refreshed every ~25 s while you are consuming and every 90 s when
idle, the last value persisted across restarts, backoff honoured on 429, and `r` forces an
immediate refresh. The token is never logged, and never sent anywhere but Anthropic.

**By default the `refreshToken` is never used**: Anthropic rotates it on every use, and
using it carelessly would sign your Claude Code out. When the token expires (~8 h), ccduck
watches the credentials file and picks up within seconds of Claude Code renewing it;
meanwhile the gauges stay correct thanks to source 0, but the reset times are lost. The `a`
key arms [auto-reauth](#auto-reauth--the-a-key), which renews the token for you.

**2. Claude Code's local cache**: `~/.claude/vscode-claude-status-cache.json` — used per
window **only if it is more recent** than everything else. Careful: that file is only fed
while the VS Code extension is running; on other machines it goes stale, sometimes by
hours, hence the “freshest wins” rule.

**3. Local estimate** (`≈`): reading the transcripts (`~/.claude/projects/**/*.jsonl`),
deduplicating, aggregating per model. This is the source for costs, burn rates, projections
and the table — things `/usage` does not provide — and the gauges' last resort.

For **Fable**, whose bucket only the API exposes: ccduck anchors on the last official
reading of that bucket, even an old one, to derive the **quota in cost** (quota = premium
cost at that moment ÷ its percentage), then applies today's rolling 7-day premium cost.
Deriving the quota rather than ageing the value makes it immune to switching models — go
back to Opus and the Fable gauge stops moving, which is correct. With no official reading of
the bucket ever, it falls back to the [cccat](https://github.com/Glance-mediametrie/cccat)
formula: share of premium cost over a rolling 7 days × official weekly ÷ `premiumShare`.

The age of the official data is shown in the header, and turns orange past 8 minutes.

There is **no daily gauge**: that limit does not exist at Anthropic (the real ones are the
5-hour block and the weekly quotas). The daily total stays in the stats line.

For estimated gauges, the `≈` limit is **auto-calibrated** on your historical peak
(35 days, completed periods only); while you're beating your own record the gauge tops out
around ~87 % instead of a fake 100 %. You can set real limits in the config. The default
metric is **API-equivalent cost** (cache read 0.1×, written 1.25×/2×); press `m` to switch
to raw tokens.

## Drawing the sprites yourself

```bash
ccduck --edit
```

```bash
cccat --edit
```

Two panels: the pose at exactly the size and proportion the app draws it — one column per
pixel, half a row tall — and the same pose as its 16×12 grid of palette letters, with a
cursor. Every keystroke redraws both, so the preview *is* the edit. Arrows or `hjkl` move,
any palette letter paints, `.` or space erases, `tab` and `⇧tab` walk through the poses,
`x` swaps between the duck's 22 and the cat's 38.

`s` saves the pose, and the next launch uses it. **`d` puts the current pose back to its
default drawing and `D` restores every pose of both animals**, whatever state anything is
in — because an edit never touches `src/`. It is written to `~/.ccduck-sprites.json` and
laid over the built-in tables at startup, so the drawings compiled into the source remain
the reference copy: reinstalling, pulling, or hand-mangling that file can none of them lose
you the originals. A malformed override is reported and skipped rather than taken, so a bad
edit cannot stop the monitor from starting.

## Updates

On startup, ccduck checks whether a newer version exists. When there is one, the header
says so — `CCDUCK v2.8.0 → v2.8.1 [u]` — and the `u` key installs it: `git pull` if the
command points at a clone (the `npm install -g <folder>` case, which creates a junction),
otherwise an npm reinstall from the repository. Outside the interface:

```bash
ccduck --update
```

Set `"checkUpdates": false` in the config to disable every call to GitHub.

## Auto-reauth — the `a` key

| Mode | Behaviour |
|---|---|
| `auth:off` (default) | ccduck only ever **reads** the credentials file, and waits for Claude Code to renew the token |
| `auth:auto` | ccduck renews the expired token itself — `POST /v1/oauth/token` on `platform.claude.com`, `grant_type=refresh_token`, then rewrites the file |

Off by default on purpose: Anthropic rotates the refresh token on every use, so a renewal
ccduck performs is one Claude Code did not, and a badly timed one can sign it out. Turn it
on with `a` for the session, or `"autoReauth": true` to keep it.

## Troubleshooting

**Gauges stuck on `— no official data`, `app file: not found`** → the shell cannot see the
Claude app's folder. On Windows this is the MSIX virtualisation described above; ccduck
reads the physical `Packages\Claude_*\...` path first, which normally settles it. Run
`ccduck --debug-usage`: it lists every candidate path with its state. If none is found, set
`planUsageDir` in the config (or `CCDUCK_CLAUDE_DIR`) to the folder that actually holds
`plan-usage-history.json`, or use `--mirror-watch` from a shell that can read it.

**`permission denied` on macOS or Linux** → the launcher needs its executable bit. It is
set in the repository, so a fresh clone or a `git pull` is enough; on an older clone:

```bash
chmod +x bin/ccduck.js
```

`npm install -g .` sets it too, which is why the problem only shows up when running
`./bin/ccduck.js` straight from the clone. Running it through node never needs it.

**“I pulled but I'm not getting the right numbers”** → check `ccduck --version` first: a
`git pull` only updates the command when the install came from **clone +
`npm install -g .`** (junction). Installed from the `.tgz` or the one-liner, the command is
a frozen copy → reinstall. `ccduck --update` does the right thing in both cases. And a
running instance keeps its code in memory: quit it with `q` and relaunch.

**Gauges without `•`**: the footer states the cause (`usage: …`):

| Status | Cause / fix |
|---|---|
| `no token` | no local OAuth token (API-key login or enterprise account) → `≈` estimates only. On macOS the token is read from the Keychain. |
| `token expired` | the ~8 h token has lapsed and Claude Code has not renewed the file yet. Source 0 keeps the gauges right; `a` arms auto-reauth if you'd rather not wait |
| `rate-limited (retry Xmin)` | delay **imposed by the server** (`retry-after`, sometimes ~1 h): its budget is small, shared with Claude Code's own `/usage` screen and most likely counted per outgoing IP (an office shares one). Don't push, it clears up on its own |
| `tls …` | corporate proxy intercepting TLS: run with `NODE_OPTIONS=--use-system-ca` (Node ≥ 22.15) or point `NODE_EXTRA_CA_CERTS` at the internal CA bundle |
| `offline` / `timeout` | no network reachable from this machine |

When no source answers at all, ccduck replaces the stats line with the state of every
candidate path and of the token — the diagnosis is on screen, no command to type.

## Development

```bash
node bin/ccduck.js --frames 40 --size 80x24
```

```bash
node bin/ccduck.js --once | node tools/ansi2html.js > preview.html
```

Zero dependencies. Behaviour engine and duck sprites in [src/duck.js](src/duck.js) (16×12
grids, one palette character per pixel), cat sprites and grooming cycles in
[src/cat.js](src/cat.js), sprite overrides in [src/sprites.js](src/sprites.js), editor in
[src/edit.js](src/edit.js), aggregates and usage sources in [src/data.js](src/data.js),
token renewal in [src/auth.js](src/auth.js), update check in
[src/update.js](src/update.js), rendering in [src/ui.js](src/ui.js).

Tests are deterministic simulations: instantiate a `Duck`, drive `update(dt, ctx)` in a
loop and count the frames or events that come out — that is how the grooming legs, the
poop rhythm and the panic cycle are checked.

## Notes

- Local estimate: the percentages are landmarks, not Anthropic's official counters
  (`/usage` inside Claude Code remains the reference).
- Works in Windows Terminal, the Claude Code terminal panel, VS Code, and so on
  (truecolor when available, 256-colour fallback otherwise).
