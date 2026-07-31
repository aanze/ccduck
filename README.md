# ccduck 🦆

Moniteur de consommation **Claude Code** dans le terminal, avec un canard de debug
jaune en pixel art qui vit sa vie sur l'eau… et panique quand tes limites approchent.

- **Jauges** : bloc SESSION 5h, DAY, WEEK, et famille premium (FABLE ou OPUS) sur 7 jours
- **Toutes les infos** : coût équivalent API, tokens (in/out/cache), débit $/h et tok/min,
  projection de fin de bloc, messages du jour, part des sous-agents, tableau par modèle
- **La mascotte** vit sa vie : elle nage avec un sillage, dérive, barbote tête sous l'eau,
  se lisse les plumes, dort (souvent quand tout est sous 30 %). Dès qu'une jauge passe
  **70 %**, elle court se placer sous la pointe de la jauge fautive et la pointe de l'aile ;
  à **90 %** c'est la **panique** — par phases de 20-30 s, entrecoupées d'un tour du bassin
  pour souffler, puis ça repart. Touche `f` pour lui **jeter des graines** : elle accourt
  (même en pleine panique), picore un moment, puis retourne à ses occupations — les graines
  restantes flottent pour plus tard.
- Optimisé pour le panneau terminal étroit de la fenêtre Claude Code (56 colonnes et plus,
  mode mini en dessous), zéro dépendance, Node ≥ 18. UI en anglais.

## Installation

Prérequis : [Node.js](https://nodejs.org) ≥ 18 (fourni avec npm — déjà présent si Claude Code tourne).

### Depuis le dépôt (recommandé)

```bash
git clone https://github.com/Glance-mediametrie/ccduck.git
cd ccduck
npm install -g .
```

> Sous Windows, `npm install -g <dossier>` crée une **jonction** vers le clone :
> un simple `git pull` dans le clone met à jour la commande, sans réinstaller.

### En une ligne (sans clone)

```bash
npm install -g git+https://github.com/Glance-mediametrie/ccduck.git
```

(Copie figée : pour mettre à jour, relancer la même commande.)

Ensuite, depuis **n'importe quel terminal, n'importe où** :

```bash
ccduck
```

(`claude-duck` fonctionne aussi.) Désinstallation : `npm uninstall -g ccduck`.

### Vérifier

```bash
ccduck --version
ccduck --once
```

Si la commande est introuvable : vérifier que le dossier global npm (`npm prefix -g`,
typiquement `%APPDATA%\npm` sous Windows) est dans le `PATH`, puis rouvrir le terminal.

## D'où viennent les chiffres ?

ccduck lit les transcripts locaux de Claude Code (`~/.claude/projects/**/*.jsonl`),
déduplique les messages et agrège l'usage réel (tokens d'entrée, de sortie, écriture
et lecture de cache) par modèle. **Aucune requête réseau, aucune clé API** — l'outil
fonctionne entièrement hors ligne sur le poste.

Les **limites exactes** de l'abonnement ne sont pas publiées par Anthropic : par défaut,
ccduck **auto-calibre** chaque jauge sur ton **pic historique** (fenêtre de 35 jours) — le
`≈` devant la limite le rappelle. 100 % = « autant que ta pire session/journée/semaine ».
Tu peux fixer des limites réelles dans la config si tu les connais.

La métrique par défaut est le **coût équivalent API** (tarifs officiels par famille,
cache lu compté 0,1×, écrit 1,25×/2×) : c'est ce qui approche le mieux la pondération
réelle des limites Anthropic. Touche `m` pour basculer en tokens bruts.

## Touches

| Touche | Action |
|---|---|
| `q` | quitter |
| `f` | jeter une poignée de graines au canard |
| `r` | rafraîchir maintenant (sinon toutes les 10 s) |
| `m` | métrique : cost → tokens → no-cache |
| `c` | afficher/masquer le tableau par modèle |
| `d` | démo : 75 % → 93 % → balayage → off (pour voir le canard s'exciter) |
| `p` / espace | pause |

## Options

```
ccduck --once          instantané statique (sans animation)
ccduck --demo[=95]     force les jauges (canard en panique garanti)
ccduck --size 80x30    taille forcée
ccduck --metric total  métrique au lancement
ccduck --help
```

## Configuration — `~/.ccduck.json`

Fichier optionnel, à créer dans le dossier utilisateur. Tout est optionnel :

```json
{
  "metric": "cost",
  "historyDays": 35,
  "refreshSec": 10,
  "fps": 10,
  "alert": 70,
  "panic": 90,
  "planLabel": "Max 20x",
  "premiumFamily": "auto",
  "weeklyReset": { "weekday": 3, "hour": 9 },
  "limits": { "session": "auto", "day": "auto", "week": 250, "premium": "auto" }
}
```

| Clé | Rôle |
|---|---|
| `metric` | `cost` (défaut), `total` ou `billable` — unité des jauges et des limites |
| `historyDays` | fenêtre d'historique parsée et de calibrage auto (défaut 35) |
| `refreshSec` / `fps` | fréquence de rescan des transcripts / d'animation |
| `alert` / `panic` | seuils (%) qui déclenchent l'alerte et la panique du canard |
| `planLabel` | libellé affiché dans l'en-tête (ex. `"Max 20x"`) |
| `premiumFamily` | `auto` (fable si utilisé, sinon opus), `fable` ou `opus` |
| `weeklyReset` | jour/heure du reset hebdo affiché par `/usage` (`weekday` : 0 = dimanche … 6 = samedi) ; absent = fenêtre glissante de 7 j |
| `limits.*` | nombre dans l'unité de la métrique (`cost` → dollars, sinon tokens), ou `"auto"` |

## Développement

```bash
node bin/ccduck.js --frames 40 --size 80x24   # rendu en flux, hors TTY
node bin/ccduck.js --once | node tools/ansi2html.js > preview.html   # aperçu visuel
```

Zéro dépendance ; sprites du canard dans [src/duck.js](src/duck.js) (grilles 16×12,
palette par caractère), agrégats dans [src/data.js](src/data.js), rendu dans
[src/ui.js](src/ui.js).

## Notes

- Estimation locale : les pourcentages sont des repères, pas les compteurs officiels
  d'Anthropic (`/usage` dans Claude Code reste la référence).
- Fonctionne dans Windows Terminal, le panneau terminal de Claude Code, VS Code, etc.
  (truecolor si disponible, repli 256 couleurs sinon).
