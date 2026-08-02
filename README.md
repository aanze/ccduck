# ccduck 🦆

A **Claude Code** usage monitor for your terminal, with a yellow pixel-art debug duck
that lives its own life on the water… and panics when your limits get close. Or a cat 🐈,
if you prefer — `cccat`.

- **Gauges aligned with Anthropic's real limits**: the 5-hour SESSION block, WEEK, and the
  premium family (FABLE or OPUS) over the week — with the **official percentages from
  `/usage`** when Claude Code has them cached locally (marked `•`), estimates `≈` otherwise
- **Everything else**: API-equivalent cost, tokens (in/out/cache), daily total, $/h and
  tok/min burn rates, end-of-block projection, messages today, sub-agent share, per-model
  table
- **The mascot** lives its own life: it swims with a wake, drifts, dabbles head-down,
  preens its feathers, sleeps (naps up to 1 min when everything is below 30 %, 30 s
  otherwise) and only ever speaks in onomatopoeia (“quack”, “zzz…”) — only limit warnings
  get actual words. As soon as the SESSION gauge crosses **70 %**, it swims under that
  gauge's tip and points at it with its wing; at **90 %** it's full **panic** — in 20-30 s
  bursts, broken up by a lap around the pond punctuated with “quack”, then it starts over.
  **The weekly gauges are held to their own, higher thresholds** (**85 %** and **96 %**,
  `weeklyAlert` / `weeklyPanic`): a week fills over seven days, so 80 % of it is not the
  news 80 % of a five-hour block is — and below panic they only get **short pointing
  bursts with long breaks** instead of monopolising the animal.
  **Not in the mood to be watched? `z` switches the alerts off altogether** (or
  `--no-alerts`, or `"alerts": false` in the config): it stops looking at the gauges
  entirely — no pointing, no panic, no markers — and just gets on with its life. Every
  other behaviour carries on, and the gauges are still read and coloured the same.
  **Several gauges above the threshold are handled in turn**, one per pointing burst, and
  a `▲` marker sits over each of them. One exception: the premium gauge (FABLE/OPUS) only
  ever triggers a **soft alert**, never panic — the other models stay usable — and at
  equal severity it steps aside for a global limit, which will block everything. Real
  panic monopolises the cycle: that's no time for a tour. Press `f` to **throw it some
  seeds**: it rushes over (even mid-panic), pecks for a while (“nom nom nom”), then goes
  back to its business — leftover seeds keep floating for later. Press `s` to drop a
  two-tone **sedative pill**: it mistakes it for food, swallows it… and sleeps for
  **5 minutes**, peaceful, even in full panic. And after a good meal, the occasional
  little “plop” — tail up for two or three seconds, the time it takes — then the dropping
  drifts downstream for a minute before sinking. With no food for **10 minutes** it comes
  begging: it crosses the pond, presses its big head against the screen and quacks its
  beak off, picture bubble included, and comes back every 1 to 2 min until you give in.
  If you don't, **it comes back more and more often** (every 35-70 s, then 22-45 s), and
  after **30 minutes** it stops asking: it jumps at the **progress bars**, tears crumbs
  off them to peck from the water, and leaves the gauges **full of holes**. Those close up
  very slowly, in four stages over 4 minutes — and since a crumb isn't a meal, it keeps
  coming back until someone feeds it properly. Two distinctive poses never follow each
  other from one frame to the next: it always straightens up in between.
- **Weather** shows up: every 7 to 25 min, a **shower** lasting 30 s to 5 min crosses the
  pond (raindrops in front of the duck, splashes on the water). After a few seconds it
  raises its beak to the sky, looks left then right, and starts dabbling like mad,
  splashing everywhere — 10 s at most, repeatable while the rain lasts but never twice in
  a row without a 30 s break.
- **Or a cat** (`cccat`, or the `x` key): the same engine frame for frame, different
  drawings and a few habits of its own. It saunters instead of paddling — and mostly does not, spending its time sitting,
  grooming or asleep — naps twice as often as the duck, never for less than 30 s and
  never twice inside two minutes, and does it curled up on a **cat tower** it
  reaches by stopping a stride to the side, wiggling, and jumping across — or, one nap in three, right where it stands, grooms itself in full sessions (several cycles on the
  hindquarters, a pause spent staring at you and blinking, then a front paw), purrs,
  meows, and every 2 to 5 minutes gets **the zoomies**: it stalks, wiggles its rear and
  pounces — in an arc, four beats — on something that is not there. When a shower would
  have fallen on the duck, a **fly** shows up instead — and it keeps after that one for as long as it stays
  within reach, bolting at three times its idle speed whenever the cat closes in, until
  the cat loses interest or it gets away. It never catches it.
  Being on dry land it makes no wake, no splash, and buries its business off screen.
- Built for the narrow terminal panel of the Claude Code window (56 columns and up, mini
  mode below that), zero dependencies, Node ≥ 18.

## Install

Requires [Node.js](https://nodejs.org) ≥ 18 (ships with npm — already there if Claude Code
is running).

### From the repository (recommended)

```bash
git clone https://github.com/aanze/ccduck.git
cd ccduck
npm install -g .
```

> On Windows, `npm install -g <folder>` creates a **junction** to the clone: a plain
> `git pull` in the clone updates the command, no reinstall needed — which is exactly what
> the `u` key does. (Over SSH: `git clone git@github.com:aanze/ccduck.git`.)

### From the bundled package (no clone)

A ready-to-use npm package sits in [`dist/`](dist/) (and is attached to GitHub Releases).
Download the `.tgz`, then:

```bash
npm install -g ./ccduck-2.6.7.tgz
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

(`claude-duck` works too, and `ccduck --cat` / `--duck` pick the animal for one run
without touching the config.) Uninstall with `npm uninstall -g ccduck`.

### Check

```bash
ccduck --version
ccduck --once
```

If the command isn't found: make sure npm's global folder (`npm prefix -g`, typically
`%APPDATA%\npm` on Windows) is on your `PATH`, then reopen the terminal.

### Watching the rare behaviours

Hunger, rain, the fly and the cat's zoomies run on timers of several minutes, so they are
easy to never see. Three environment variables shorten those timers — they change nothing
else, and only for that run:

```bash
CCDUCK_HUNGRY_SEC=20 cccat
```

```bash
CCDUCK_RAIN_EVERY=15 cccat
```

```bash
CCDUCK_ZOOM_EVERY=15 cccat
```

`CCDUCK_HUNGRY_SEC` is the delay before it starts begging (it then escalates and, once
starving, raids the gauges). `CCDUCK_RAIN_EVERY` is the wait between showers for the duck,
and between flies for the cat — same timer. `CCDUCK_ZOOM_EVERY` is the wait between the
cat's zoomies. Each accepts seconds, and the real wait lands between the value and twice
it. They combine, and `ccduck` takes them just the same. On Windows PowerShell the `VAR=x cmd` prefix does not
exist — set the variable first, and clear it afterwards:

```bash
$env:CCDUCK_HUNGRY_SEC=20; cccat
```

```bash
Remove-Item Env:CCDUCK_HUNGRY_SEC
```

## Drawing the sprites yourself

```bash
ccduck --edit
```

```bash
cccat --edit
```

Two panels: the pose at exactly the size and proportion the app draws it — one column
per pixel, half a row tall — and the same pose as its 16×12 grid of
palette letters, with a cursor. Every keystroke redraws both, so the preview *is* the
edit. Arrows or `hjkl` move, any palette letter paints, `.` or space erases, `tab` and
`⇧tab` walk through the poses, `x` swaps between the duck's 22 and the cat's 38.

`s` saves the pose, and the next launch uses it. **`d` puts the current pose back to its
default drawing and `D` restores every pose of both animals**, whatever state anything is
in — because an edit never touches `src/`. It is written to `~/.ccduck-sprites.json` and
laid over the built-in tables at startup, so the drawings compiled into the source remain
the reference copy: reinstalling, pulling, or hand-mangling that file can none of them
lose you the originals. A malformed override is reported and skipped rather than taken,
so a bad edit cannot stop the monitor from starting.

## Where the numbers come from

**Nothing to connect, no key to provide.** Window by window, ccduck keeps **the freshest
reading** among the sources below — never a blend of them:

0. **The Claude app's own reading** (`•`, the bedrock):
   `%APPDATA%/Claude/plan-usage-history.json` (macOS:
   `~/Library/Application Support/Claude/`). The app writes its own reading there **every
   5 min** — `fh` = 5-hour session, `sd` = weekly, as percentages. No token, no network
   call: **no 401 and no 429 possible**. This is what keeps the numbers right at all
   times, even with an expired token.

Then, when available and more recent:

1. **The official `/usage` endpoint** (`•`, real time + Fable counter):
   `api.anthropic.com/api/oauth/usage`, authenticated with the OAuth token **already
   present** on the machine (`~/.claude/.credentials.json`, or the Keychain on macOS).
   This is literally what Claude Code's `/usage` screen shows — **all three gauges, Fable
   bucket included**, with exact reset times. Refreshed roughly every 2 min (with jitter,
   so the endpoint doesn't get hammered), the last value persisted to
   `~/.ccduck-usage.json` across restarts, backoff honoured on 429, and `r` forces an
   immediate refresh. The token is never logged, and never sent anywhere but Anthropic;
   `ccduck --debug-usage` shows the token's expiry date and the raw response. **By
   default the `refreshToken` is never used**: Anthropic rotates it on every use, and
   using it carelessly would sign your Claude Code out. When the token expires (~8 h),
   ccduck watches the credentials file and picks up within seconds of Claude Code renewing
   it; meanwhile the gauges stay correct thanks to source 0, but the Fable bucket falls
   back to an `≈` estimate and the reset times are lost. The `a` key arms
   [auto-reauth](#auto-reauth--the-a-key), which renews the token for you.
2. **Claude Code's local cache**: `~/.claude/vscode-claude-status-cache.json` — used per
   window **only if it is more recent** than the last API response. Careful: that file is
   only fed while the VS Code extension is running; on other machines it goes stale
   (sometimes by hours), hence the “freshest wins” rule.
3. **Local estimate** (`≈`): reading the transcripts
   (`~/.claude/projects/**/*.jsonl`), deduplicating, aggregating per model — the source
   for costs, burn rates, projections and the table (things `/usage` does not provide),
   and the gauges' fallback when no official data is available. For Fable there are two
   fallbacks: if an official reading of the bucket exists but has gone stale (API silent,
   token expired), we start from its last value and move it **like the global weekly**,
   which source 0 keeps refreshing — and only if the transcripts show premium usage since
   that reading, so that switching to another model doesn't push the gauge up. With no
   reading of the bucket at all, the [cccat](https://github.com/Glance-mediametrie/cccat)
   formula: share of fable tokens over a rolling 7 days × official weekly ÷ `premiumShare`
   (~50 % of the envelope).

The age of the official data is shown in the footer as soon as it exceeds 5 minutes.

There is **no daily gauge**: that limit does not exist at Anthropic (the real ones are the
5-hour block and the weekly quotas). The daily total stays in the stats line.

For estimated gauges, the `≈` limit is **auto-calibrated** on your historical peak
(35 days, completed periods only); while you're beating your own record the gauge tops out
around ~87 % instead of a fake 100 %. You can set real limits in the config. The default
metric is **API-equivalent cost** (cache read 0.1×, written 1.25×/2×); press `m` to switch
to raw tokens.

## Keys

| Key | Action |
|---|---|
| `q` | quit |
| `f` | throw a handful of seeds to the duck |
| `s` | drop a sedative pill (5 min nap, even mid-panic) |
| `r` | refresh now (otherwise every 10 s) |
| `m` | metric: cost → tokens → no-cache |
| `c` | show/hide the per-model table |
| `d` | demo: 75 % → 93 % → sweep → off (to watch the duck lose it) |
| `p` / space | pause |
| `u` | install the update when the header offers one |
| `a` | auto-reauth: renew the expired token yourself, or not (default: not) |

## Updates

On startup, ccduck checks whether a newer version exists. When there is one, the header
says so — `CCDUCK v1.11.2 → v1.12.0 [u]` — and the `u` key installs it: `git pull` if the
command points at a clone (the `npm install -g <folder>` case, which creates a junction),
otherwise an npm reinstall from the repository. Outside the interface:

```bash
ccduck --update
```

**Nothing installs itself**: the key or the command decides. Detection reads the
`package.json` of the default branch on `raw.githubusercontent.com` (public repository, no
authentication), at most **once every 6 h** — the result is cached in
`~/.ccduck-update.json`. It is the only network call ccduck makes besides Anthropic's usage
endpoint; `"checkUpdates": false` in the config disables it entirely. Failures are silent:
a network outage must never get in the way of the gauges.

## Auto-reauth — the `a` key

Claude Code's OAuth token lives for ~8 h. Past that, source 1 goes quiet: the SESSION and
WEEK gauges stay correct thanks to the app's file, but **the Fable bucket falls back to an
`≈` estimate and the reset times disappear** — only the API provides those.

The `a` key switches between the two behaviours on the fly, and the footer shows which one
is active:

| Mode | Behaviour |
|---|---|
| `auth:off` (default) | ccduck only ever **reads** the credentials file, and waits for Claude Code to renew the token |
| `auth:auto` | ccduck renews the expired token itself — `POST /v1/oauth/token` on `platform.claude.com`, `grant_type=refresh_token`, then rewrites the file |

The `auto` mode **writes** to `~/.claude/.credentials.json`, which belongs to Claude Code.
Safeguards: a full backup before the first write (`.credentials.json.ccduck-backup`),
**merge and never replace** (`mcpOAuth` and `organizationUuid` stay untouched), atomic
write, and giving up if the file changed between the read and the write — another process
renewed on its side, and its version wins. One attempt per minute at most, and none at all
once the refresh token is dead: only `claude auth login` fixes that.

**The residual risk**, and the reason this mode is off by default: Anthropic rotates the
refresh token on every use. If a `claude` is running in a terminal at the same time and
renews on its side, the last writer wins — the other one ends up with a dead token and
will have to run `claude auth login` again.

To make it permanent: `"autoReauth": true` in the config, or `ccduck --auto-reauth` at
startup. The `a` key only applies to the current session.

## Options

```
ccduck --once          static snapshot (no animation)
ccduck --demo[=95]     force the gauges (guaranteed duck panic)
ccduck --size 80x30    force the size
ccduck --metric total  metric at startup
ccduck --update        update now
ccduck --auto-reauth   renew the expired token instead of waiting for Claude Code
ccduck --help
```

## Configuration — `~/.ccduck.json`

Optional file, to be created in your home folder. Everything in it is optional:

```json
{
  "metric": "cost",
  "historyDays": 35,
  "refreshSec": 10,
  "fps": 10,
  "alert": 70,
  "panic": 90,
  "weeklyAlert": 85,
  "weeklyPanic": 96,
  "planLabel": "Max 20x",
  "premiumFamily": "auto",
  "weeklyReset": { "weekday": 3, "hour": 9 },
  "limits": { "session": "auto", "day": "auto", "week": 250, "premium": "auto" }
}
```

| Key | Role |
|---|---|
| `metric` | `cost` (default), `total` or `billable` — the **display unit** for the figures only; estimated `%` are always computed on weighted cost (press `m` to switch) |
| `historyDays` | how much history is parsed, and the auto-calibration window (default 35) |
| `refreshSec` / `fps` | transcript rescan rate / animation rate |
| `alert` / `panic` | thresholds (%) that trigger the duck's alert and panic |
| `planLabel` | label shown in the header (e.g. `"Max 20x"`) |
| `premiumFamily` | `auto` (fable if used, opus otherwise), `fable` or `opus` |
| `premiumShare` | share of the weekly envelope allocated to the premium model, for the estimation formula (default `0.5`) |
| `weeklyReset` | weekly reset day/hour (`weekday`: 0 = Sunday … 6 = Saturday) — only useful when Claude Code's official cache is missing; otherwise the official reset is used automatically |
| `limits.*` | in **API-equivalent dollars**, or `"auto"` (historical peak) — only used by the estimated `≈` gauges |
| `checkUpdates` | `true` by default: checks twice a day whether a newer version exists. `false` disables every call to GitHub |
| `autoReauth` | `false` by default: at `true`, ccduck renews the expired OAuth token itself (the `a` key, [details](#auto-reauth--the-a-key)) |

## Troubleshooting

**`permission denied` on macOS or Linux** → the launcher needs its executable bit. It is
set in the repository since v1.15.2, so a fresh clone or a `git pull` is enough; on an
older clone, set it by hand:

```bash
chmod +x bin/ccduck.js
```

`npm install -g .` sets it too, which is why the problem only shows up when running
`./bin/ccduck.js` straight from the clone. Running it through node never needs it:
`node bin/ccduck.js`.

**“I pulled but I'm not getting the right numbers”** → check `ccduck --version` first: a
`git pull` only updates the command when the install came from **clone +
`npm install -g .`** (junction). Installed from the `.tgz` or the one-liner, the command is
a frozen copy → reinstall. `ccduck --update` does the right thing in both cases.

**Gauges without `•`**: the footer states the cause (`usage: …`):

| Status | Cause / fix |
|---|---|
| `no token` | no local OAuth token (API-key login or enterprise account) → `≈` estimates only. On macOS the token is read from the Keychain. |
| `rate-limited (retry Xmin)` | delay **imposed by the server** (`retry-after`, sometimes ~1 h): its budget is small, shared with Claude Code's own `/usage` screen and most likely counted per outgoing IP (an office shares one). Don't push (it makes things worse); fall back to cache/`≈` meanwhile, it clears up on its own |
| `tls (proxy? see README)` | corporate proxy intercepting TLS: run with `NODE_OPTIONS=--use-system-ca` (Node ≥ 22.15) or point `NODE_EXTRA_CA_CERTS` at the internal CA bundle |
| `offline` / `timeout` | no network reachable from this machine |

`ccduck --debug-usage` prints the persisted state (`~/.ccduck-usage.json`), then forces a
diagnostic call and shows the raw response.

## Development

```bash
node bin/ccduck.js --frames 40 --size 80x24   # stream frames, outside a TTY
node bin/ccduck.js --once | node tools/ansi2html.js > preview.html   # visual preview
```

Zero dependencies; duck sprites in [src/duck.js](src/duck.js) (16×12 grids, one palette
character per pixel), aggregates in [src/data.js](src/data.js), rendering in
[src/ui.js](src/ui.js).

## Notes

- Local estimate: the percentages are landmarks, not Anthropic's official counters
  (`/usage` inside Claude Code remains the reference).
- Works in Windows Terminal, the Claude Code terminal panel, VS Code, and so on
  (truecolor when available, 256-colour fallback otherwise).
