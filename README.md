# ccduck 🦆

Moniteur de consommation **Claude Code** dans le terminal, avec un canard de debug
jaune en pixel art qui vit sa vie sur l'eau… et panique quand tes limites approchent.

- **Jauges alignées sur les vraies limites Anthropic** : bloc SESSION 5h, WEEK, et famille
  premium (FABLE ou OPUS) sur la semaine — avec les **pourcentages officiels de `/usage`**
  quand Claude Code les a mis en cache localement (marqués `•`), estimation `≈` sinon
- **Toutes les infos** : coût équivalent API, tokens (in/out/cache), total du jour, débit
  $/h et tok/min, projection de fin de bloc, messages du jour, part des sous-agents,
  tableau par modèle
- **La mascotte** vit sa vie : elle nage avec un sillage, dérive, barbote tête sous l'eau,
  se lisse les plumes, dort (souvent quand tout est sous 30 %) et ne s'exprime qu'en
  onomatopées (« quack », « zzz… ») — seuls les avertissements de limites ont droit à du
  texte. Dès qu'une jauge passe **70 %**, elle court se placer sous la pointe de la jauge
  fautive et la pointe de l'aile ; à **90 %** c'est la **panique** — par phases de 20-30 s,
  entrecoupées d'un tour du bassin ponctué de « quack », puis ça repart. Exception : la
  jauge premium (FABLE/OPUS) ne déclenche qu'une **alerte douce**, jamais la panique —
  les autres modèles restent utilisables. Touche `f` pour
  lui **jeter des graines** : elle accourt (même en pleine panique), picore un moment
  (« nom nom nom »), puis retourne à ses occupations — les graines restantes flottent
  pour plus tard.
- Optimisé pour le panneau terminal étroit de la fenêtre Claude Code (56 colonnes et plus,
  mode mini en dessous), zéro dépendance, Node ≥ 18. UI en anglais.

## Installation

Prérequis : [Node.js](https://nodejs.org) ≥ 18 (fourni avec npm — déjà présent si Claude Code tourne).

### Depuis le dépôt, en SSH (recommandé)

```bash
git clone git@github.com:Glance-mediametrie/ccduck.git
cd ccduck
npm install -g .
```

> Sous Windows, `npm install -g <dossier>` crée une **jonction** vers le clone :
> un simple `git pull` dans le clone met à jour la commande, sans réinstaller.
> (Sans clé SSH configurée, le clone HTTPS fonctionne aussi :
> `git clone https://github.com/Glance-mediametrie/ccduck.git`.)

### Depuis le package fourni (sans clone)

Un paquet npm prêt à l'emploi est fourni dans [`dist/`](dist/) (et attaché aux
Releases GitHub). Télécharger le `.tgz` puis :

```bash
npm install -g ./ccduck-1.3.0.tgz
```

(Copie figée : pour mettre à jour, réinstaller le `.tgz` de la version suivante.)

### En une ligne (sans clone, via SSH)

```bash
npm install -g git+ssh://git@github.com/Glance-mediametrie/ccduck.git
```

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

**Aucune requête réseau, aucune clé API, aucune connexion** — tout est lu sur le poste :

1. **Pourcentages officiels** (`•`) : Claude Code met en cache les compteurs de `/usage`
   dans `~/.claude/vscode-claude-status-cache.json` (utilisation 5 h et 7 j + heures de
   reset). Quand ce cache existe et couvre la fenêtre en cours, les jauges SESSION et
   WEEK affichent **exactement** ce que montre `/usage`. Le cache se rafraîchit quand
   Claude Code tourne ; s'il date, l'âge est indiqué en pied de page.
2. **Estimation locale** (`≈`) : ccduck lit les transcripts (`~/.claude/projects/**/*.jsonl`),
   déduplique les messages et agrège l'usage réel par modèle. Sert de repli quand le
   cache officiel manque (jauge SESSION en début de bloc, poste sans cache), et alimente
   la jauge premium, les coûts, débits et le tableau — infos que `/usage` ne donne pas.

Il n'y a **pas de jauge journalière** : cette limite n'existe pas chez Anthropic (les
limites réelles sont le bloc de 5 h et les quotas hebdomadaires). Le total du jour reste
affiché dans la ligne de stats.

Pour les jauges estimées, la limite `≈` est **auto-calibrée** sur ton pic historique
(35 jours, périodes révolues uniquement) ; en train de battre ton record, la jauge
plafonne vers ~87 % au lieu d'un faux 100 %. Tu peux fixer des limites réelles dans la
config. La métrique par défaut est le **coût équivalent API** (cache lu 0,1×, écrit
1,25×/2×) ; touche `m` pour basculer en tokens bruts.

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
| `weeklyReset` | jour/heure du reset hebdo (`weekday` : 0 = dimanche … 6 = samedi) — utile seulement si le cache officiel de Claude Code est absent ; sinon le reset officiel est utilisé automatiquement |
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
