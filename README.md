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
  se lisse les plumes, dort (siestes jusqu'à 1 min quand tout est sous 30 %, 30 s sinon)
  et ne s'exprime qu'en onomatopées (« quack », « zzz… ») — seuls les avertissements de
  limites ont droit à du texte. Dès qu'une jauge passe **70 %**, elle court se placer sous la pointe de la jauge
  fautive et la pointe de l'aile ; à **90 %** c'est la **panique** — par phases de 20-30 s,
  entrecoupées d'un tour du bassin ponctué de « quack », puis ça repart. Exception : la
  jauge premium (FABLE/OPUS) ne déclenche qu'une **alerte douce**, jamais la panique —
  les autres modèles restent utilisables. Touche `f` pour
  lui **jeter des graines** : elle accourt (même en pleine panique), picore un moment
  (« nom nom nom »), puis retourne à ses occupations — les graines restantes flottent
  pour plus tard. Touche `s` pour lâcher une **gélule sédative** bicolore : elle la prend
  pour de la nourriture, la gobe… et s'endort **5 minutes**, paisible, même en pleine
  panique. Et après un bon repas, un petit « plop » de temps en temps — queue relevée
  deux ou trois secondes, le temps de la commission — puis la crotte dérive au fil de
  l'eau une minute avant de disparaître. Sans repas depuis **10 minutes**, elle vient
  réclamer : elle traverse le bassin, colle sa grosse tête plein cadre et quacke à
  s'en décrocher le bec, bulle imagée à l'appui, et elle repasse toutes les 1 à 2 min
  jusqu'à ce qu'on cède. Deux poses marquées ne s'enchaînent jamais d'une image à
  l'autre : elle se redresse toujours entre les deux.
- **La météo** s'invite : toutes les 7 à 25 min, une **averse** de 30 s à 5 min traverse
  le bassin (gouttes devant le canard, éclaboussures sur l'eau). Au bout de quelques
  secondes elle lève le bec vers le ciel, regarde à gauche puis à droite, et se met à
  barboter comme une folle en s'éclaboussant — 10 s au plus, renouvelable tant qu'il
  pleut mais jamais deux fois de suite sans 30 s de répit.
- Optimisé pour le panneau terminal étroit de la fenêtre Claude Code (56 colonnes et plus,
  mode mini en dessous), zéro dépendance, Node ≥ 18. UI en anglais.

## Installation

Prérequis : [Node.js](https://nodejs.org) ≥ 18 (fourni avec npm — déjà présent si Claude Code tourne).

### Depuis le dépôt (recommandé)

```bash
git clone https://github.com/aanze/ccduck.git
cd ccduck
npm install -g .
```

> Sous Windows, `npm install -g <dossier>` crée une **jonction** vers le clone :
> un simple `git pull` dans le clone met à jour la commande, sans réinstaller —
> c'est ce que fait la touche `u`. (En SSH : `git clone git@github.com:aanze/ccduck.git`.)

### Depuis le package fourni (sans clone)

Un paquet npm prêt à l'emploi est fourni dans [`dist/`](dist/) (et attaché aux
Releases GitHub). Télécharger le `.tgz` puis :

```bash
npm install -g ./ccduck-1.12.1.tgz
```

(Copie figée : pour mettre à jour, réinstaller le `.tgz` de la version suivante.)

### En une ligne (sans clone)

```bash
npm install -g git+https://github.com/aanze/ccduck.git
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

**Aucune connexion à faire, aucune clé à fournir.** ccduck retient, fenêtre par fenêtre,
**le relevé le plus frais** parmi les sources ci-dessous — jamais un mélange :

0. **Relevé de l'app Claude** (`•`, socle) : `%APPDATA%/Claude/plan-usage-history.json`
   (macOS : `~/Library/Application Support/Claude/`). L'app y écrit son propre relevé
   **toutes les 5 min** — `fh` = session 5 h, `sd` = hebdo, en pourcentage. Aucun token,
   aucun appel réseau : **ni 401 ni 429 possibles**. C'est ce qui garantit des chiffres
   justes en permanence, même token expiré.

Puis, quand c'est disponible et plus récent :

1. **Endpoint officiel `/usage`** (`•`, temps réel + compteur Fable) :
   `api.anthropic.com/api/oauth/usage`, authentifié avec le token OAuth **déjà présent**
   sur le poste (`~/.claude/.credentials.json`, ou le Trousseau sur macOS). C'est
   littéralement ce qu'affiche l'écran `/usage` de Claude Code — **les trois jauges,
   bucket Fable compris**, resets exacts. Rafraîchi toutes les ~2 min (jitter pour ne pas
   marteler l'endpoint), dernière valeur persistée dans `~/.ccduck-usage.json` pour les
   relances, backoff respecté sur 429, `r` force un rafraîchissement immédiat. Le token
   n'est jamais loggé ni envoyé ailleurs que chez Anthropic ; `ccduck --debug-usage`
   affiche la date d'expiration du token et la réponse brute. **Le `refreshToken` n'est
   jamais utilisé** : chez Anthropic il tourne à chaque usage, s'en servir déconnecterait
   ton Claude Code. Quand le token expire (~8 h), ccduck surveille le fichier de
   credentials et repart dans les secondes qui suivent son renouvellement par Claude Code ;
   entre-temps les jauges restent justes grâce à la source 0.
2. **Cache local de Claude Code** : `~/.claude/vscode-claude-status-cache.json` — utilisé
   par fenêtre **uniquement s'il est plus récent** que la dernière réponse API. Attention :
   ce fichier n'est alimenté que quand l'extension VS Code tourne ; sur les autres postes
   il fige (parfois plusieurs heures), d'où la règle « le plus frais gagne ».
3. **Estimation locale** (`≈`) : lecture des transcripts (`~/.claude/projects/**/*.jsonl`),
   déduplication, agrégation par modèle — source des coûts, débits, projections et du
   tableau (infos que `/usage` ne donne pas), et repli des jauges si aucune donnée
   officielle n'est disponible. Pour Fable, deux replis : si un relevé officiel du bucket
   existe mais a vieilli (API muette, token expiré), on repart de sa dernière valeur et on
   la fait bouger **comme l'hebdo globale**, qui, elle, reste rafraîchie par la source 0 —
   et seulement si les transcripts montrent de la conso premium depuis ce relevé, pour
   qu'un passage sur un autre modèle ne fasse pas grimper la jauge. Sans aucun relevé du
   bucket, formule [cccat](https://github.com/Glance-mediametrie/cccat) : part de tokens
   fable sur 7 j glissants × hebdo officiel ÷ `premiumShare` (~50 % de l'enveloppe).

L'âge de la donnée officielle est affiché en pied de page dès qu'elle dépasse 5 minutes.

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
| `s` | lâcher une gélule sédative (dodo 5 min, même en panique) |
| `r` | rafraîchir maintenant (sinon toutes les 10 s) |
| `m` | métrique : cost → tokens → no-cache |
| `c` | afficher/masquer le tableau par modèle |
| `d` | démo : 75 % → 93 % → balayage → off (pour voir le canard s'exciter) |
| `p` / espace | pause |
| `u` | installer la mise à jour quand l'en-tête en propose une |

## Mises à jour

Au lancement, ccduck regarde s'il existe une version plus récente. Quand c'est le cas,
l'en-tête l'annonce — `CCDUCK v1.11.2 → v1.12.0 [u]` — et la touche `u` l'installe :
`git pull` si la commande pointe sur un clone (cas de `npm install -g <dossier>`, qui
crée une jonction), sinon réinstallation npm depuis le dépôt. Hors interface :

```bash
ccduck --update
```

**Rien ne s'installe tout seul** : la touche ou la commande décide. La détection lit le
`package.json` de la branche par défaut sur `raw.githubusercontent.com` (dépôt public,
aucune authentification), au plus **une fois toutes les 6 h** — résultat mis en cache
dans `~/.ccduck-update.json`. C'est le seul appel réseau de ccduck en dehors de
l'endpoint d'usage d'Anthropic ; `"checkUpdates": false` dans la config le coupe
entièrement. Un échec est silencieux : une panne réseau ne doit jamais gêner les jauges.

## Options

```
ccduck --once          instantané statique (sans animation)
ccduck --demo[=95]     force les jauges (canard en panique garanti)
ccduck --size 80x30    taille forcée
ccduck --metric total  métrique au lancement
ccduck --update        mettre à jour maintenant
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
| `metric` | `cost` (défaut), `total` ou `billable` — **unité d'affichage** des chiffres uniquement ; les `%` estimés sont toujours calculés en coût pondéré (touche `m` pour basculer) |
| `historyDays` | fenêtre d'historique parsée et de calibrage auto (défaut 35) |
| `refreshSec` / `fps` | fréquence de rescan des transcripts / d'animation |
| `alert` / `panic` | seuils (%) qui déclenchent l'alerte et la panique du canard |
| `planLabel` | libellé affiché dans l'en-tête (ex. `"Max 20x"`) |
| `premiumFamily` | `auto` (fable si utilisé, sinon opus), `fable` ou `opus` |
| `premiumShare` | part de l'enveloppe hebdo allouée au modèle premium pour la formule d'estimation (défaut `0.5`) |
| `weeklyReset` | jour/heure du reset hebdo (`weekday` : 0 = dimanche … 6 = samedi) — utile seulement si le cache officiel de Claude Code est absent ; sinon le reset officiel est utilisé automatiquement |
| `limits.*` | en **dollars équivalent API**, ou `"auto"` (pic historique) — ne sert qu'aux jauges estimées `≈` |
| `checkUpdates` | `true` par défaut : vérifie une fois par demi-journée s'il existe une version plus récente. `false` coupe tout appel à GitHub |

## Dépannage

**« J'ai pull mais je n'ai pas les bons chiffres »** → vérifier d'abord `ccduck --version` :
un `git pull` ne met à jour la commande que si l'installation vient de **clone +
`npm install -g .`** (jonction). Installé via le `.tgz` ou le one-liner, la commande est
une copie figée → réinstaller. `ccduck --update` fait le bon geste dans les deux cas.

**Jauges sans `•`** : le pied de page indique la cause (`usage: …`) :

| Statut | Cause / remède |
|---|---|
| `no token` | pas de token OAuth local (connexion par clé API ou compte entreprise) → jauges en estimation `≈` uniquement. macOS : le token est lu depuis le Trousseau. |
| `rate-limited (retry Xmin)` | délai **imposé par le serveur** (`retry-after`, parfois ~1 h) : son budget est petit, partagé avec l'écran `/usage` de Claude Code et vraisemblablement compté par IP de sortie (bureau = IP commune). Ne pas insister (ça aggrave) ; repli cache/`≈` en attendant, ça se résorbe seul |
| `tls (proxy? see README)` | proxy d'entreprise qui intercepte TLS : lancer avec `NODE_OPTIONS=--use-system-ca` (Node ≥ 22.15) ou pointer `NODE_EXTRA_CA_CERTS` vers le bundle CA interne |
| `offline` / `timeout` | réseau inaccessible depuis ce poste |

`ccduck --debug-usage` affiche l'état persisté (`~/.ccduck-usage.json`) puis force un
appel de diagnostic et montre la réponse brute.

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
