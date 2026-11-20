# Bilan des roams du mid : CS perdus contre ce que le roam a rapporté

> **Saison en cours seulement (règle du 20/11/2026)** : ce rapport ne contient que des valeurs 16.x. Les règles générales sans timer restent, les valeurs et timers 2025 sont retirés (voir [`2026-11-20-inventaire-regles-avant-2026.md`](2026-11-20-inventaire-regles-avant-2026.md)).

> **Étendu à tous les laners** (support compris) dans
> [`2026-11-20-bilan-des-roams-tous-laners.md`](2026-11-20-bilan-des-roams-tous-laners.md), qui reprend ce calcul comme
> base commune.

_20/11/2026, session Engine. Demande de l'utilisateur : le moteur sait-il compter les CS perdus pendant un roam ? Peut-il
juger si le roam valait le coup, c'est-à-dire si le mid a créé un avantage ailleurs et si le mid adverse a fait la
différence ensuite ? Lecture seule du code : rien n'est implémenté._

## 1. La connaissance

**Le cas.** Le mid roam sans avoir crash sa wave. Le mid adverse freeze, et le mid qui a roam perd environ 9 CS. Le
roam est bon s'il a créé plus que ce qu'il a coûté : un kill ou un assist, un avantage de gold/XP dans une side lane, un
objectif, un fight gagné. Il faut aussi que le mid adverse ne convertisse pas son avance (plaques, tour, counter-roam).
Sinon, il fallait rester en lane.

**Sources.** La règle « push avant de roam, sinon tu paies la wave » est un fondamental high-elo enseigné partout. La
fiche Codex `codex_mid_roam_budget_next_wave_numbers` en tire déjà une version 2026 : push d'abord, budget sur la wave
suivante, n'y aller que si le roam change le fight. Elle vient des guides mid saison 16 listés dans
[`RECHERCHE_CONNAISSANCES.md`](../RECHERCHE_CONNAISSANCES.md) § 4 ([V03], [V10]). La nouveauté est le **bilan chiffré**
coût contre gain, que proposent la demande de l'utilisateur et l'idée de review « classer chaque mort selon son
contexte » (§ 6 du même document).

**Valeurs 2026 (16.x).**

| | 16.x (2026, `DETECTOR_SPEC`) |
|---|---|
| Waves | 1re à 0:30, toutes les 30 s (25 s dès 14:00) ; canon à la wave 3, puis 1 sur 3 |
| CS max en mid avant 14:00 | ≈ 6,33 sbires par wave → ≈ 12,7 CS/min |
| Plaques | 120 g (−10 g/min dès 11:00, au moins 80 g), **permanentes** |
| Fenêtre du bilan | de 2:00 jusqu'à la chute de la T1 mid ou 20:00 (comme `midRoam`) |
| Quête de rôle | quête mid (~16:05) ; depuis 26.09, 2 min en lane donnent 1 min de roam sans pénalité de quête (sinon −75 % de points hors lane), un recall coupe les points 12 s (wiki Role Quests) |

L'or moyen d'un sbire n'est pas codé : il faut le mesurer sur le cache (régression or gagné / CS sur les relevés, par
saison) au lieu de figer une valeur du wiki.

## 2. Ce que le moteur fait déjà

En partie seulement, dans `src/lib/microReview/anomalyDetector.ts` § 6 « Roams » (l. 1571-1626).

- **`mid-roam-plates`** : le mid est en mid lane à la minute k, puis à plus de 2 600 de la diagonale à k+1, vivant,
  avant 20:00. Le schéma se déclenche s'il n'a **aucun** kill ni assist entre k et k+2, au moins 1
  plaque mid perdue et au moins 10 CS perdus. Les **CS perdus** se calculent déjà ainsi : `csLost = csGap(k) − csGap(k+2)`,
  l'écart de CS contre le vis-à-vis direct sur deux relevés par minute (même calcul pour `xpLost`).
- **`bad-rotation`** : tous les laners, avant 14:00, au moins 30 s hors de la lane, aucun kill ni assist, plus de 8 CS
  et 350 XP perdus.
- **Labo M13** et le déclencheur « retard précoce » ne voient que l'écart total à 10:00, sans savoir qu'un roam l'a causé.

**Ce qui manque :**

1. le **gain** du roam : on teste seulement « 0 kill ou assist » ;
2. la **conversion** par le mid adverse ensuite ;
3. le **roam réussi**, invisible aujourd'hui ;
4. le roam court (moins de 60 s), qui passe entre deux relevés ;
5. le freeze, qui allonge la perte après le retour en lane.

Résultat : un roam qui rapporte un assist mais coûte 12 CS et 2 plaques n'est jamais jugé. À l'inverse, un roam
rentable peut quand même produire une carte « retard à 10:00 ».

## 3. Le calcul proposé : un bilan par roam

Nouvelle fonction pure `roamLedger(match, timeline, pid)` dans un nouveau fichier `src/lib/microReview/roamLedger.ts`,
appelée par `anomalyDetector.ts` à la place des deux tests ci-dessus pour le mid. On pourra l'étendre plus tard au top
(TP) et au support.

### Étape 1 : repérer le roam (début `tOut`, retour `tBack`)

- Position échantillonnée toutes les 5 s avec `posAt`, qui interpole entre les relevés selon les événements, comme
  `DETECTOR_SPEC.jungle.sampleSec`. Le roam commence au premier point hors de la mid lane : à plus de 2 600 de la
  diagonale, hors des bases, joueur vivant et pas en train de revenir d'une mort (`leftAlive`). Il dure au moins 20 s.
- **Roam court** : un `CHAMPION_KILL` où le mid est tueur ou assistant, positionné hors de la mid lane, **prouve** un
  roam même sans relevé pendant l'absence. C'est ainsi qu'on voit les roams réussis de 30-40 s.
- Le roam finit au retour en mid lane (`tBack`). S'il finit en base, avec un achat vivant qui prouve le recall, le roam
  est marqué « roam + reset ». Le coût ne compte alors que jusqu'à l'achat : le temps du back n'est pas imputé au roam.
- Deux roams à moins de 60 s d'écart forment un seul roam.

### Étape 2 : le coût (ce que le mid a perdu)

On mesure entre le relevé juste avant `tOut` (minute `a`) et le premier relevé au moins 60 s après `tBack` (minute
`b`). La minute après le retour capte le freeze et les sbires morts sous la tour.

| Coût | Calcul | Données |
|---|---|---|
| CS perdus contre le vis-à-vis | `csGap(a) − csGap(b)`, c'est le calcul actuel avec une fenêtre ajustée | relevés : `minionsKilled + jungleMinionsKilled` |
| CS manqués (repère absolu) | rythme de CS du mid sur les 3 minutes avant `a` × durée − CS réellement pris, plafonné au CS max des waves de la saison | relevés + horloge des waves |
| XP perdue | `xpGap(a) − xpGap(b)` | relevés : `xp` |
| Or perdu | CS perdus × or moyen d'un sbire (mesuré sur le cache) + plaques mid perdues × valeur de la saison + bonus de 1re tour si la T1 mid tombe | `TURRET_PLATE_DESTROYED`, `BUILDING_KILL` |
| Mort pendant le roam | or donné (bounty) + CS et XP manqués pendant le respawn (`deathTimerSec`) | `CHAMPION_KILL`, `gameClock.ts` |

**Freeze probable** (indice, jamais affirmé) : dans la minute après le retour, le mid prend moins de la moitié des CS de
son vis-à-vis tout en restant de son côté de la mid lane (ligne de tempo D < 0,5). Riot ne donne pas l'état des waves :
la carte dira « la wave est probablement restée de ton côté », pas « il a freeze ».

### Étape 3 : le gain (ce que le roam a créé)

Fenêtre de `tOut` à `tBack + 30 s`. On ne compte **que** les événements où le mid est impliqué : tueur ou assistant, ou
présent à moins de 2 800 d'un objectif (`OBJECTIVE_RADIUS`). Ce qui arrive ailleurs sur la carte n'est pas porté au
crédit du roam.

| Gain | Calcul | Données |
|---|---|---|
| Kills et assists | or du kill pour l'équipe : champs `bounty` + `shutdownBounty` de `CHAMPION_KILL` s'ils sont présents dans le cache (**à vérifier** : le code ne les lit pas encore), sinon `bountyGold(killStreak)` | `CHAMPION_KILL` |
| Avantage dans la lane visitée | lane visitée = zone du roam (top, bot ou rivière, comme `roamSide`). Écart gold + XP de l'allié (ADC + support en bot) contre son vis-à-vis, de `a` à `b`. On ne le compte que si un kill ou un assist du mid a eu lieu dans cette lane | relevés |
| Objectif | Dragon, Larves, Héraut, plaques ou tour pris par l'équipe avec le mid présent ou assistant : poids `OBJECTIVE_WEIGHT` + or connu (plaques, tour) | `ELITE_MONSTER_KILL`, `TURRET_PLATE_DESTROYED`, `BUILDING_KILL` |
| Fight gagné | fight à au moins 3 kills (kills à moins de 10 s, `sameFightSec`) où le mid participe, bilan net du fight pour l'équipe | `CHAMPION_KILL` |
| Mid adverse qui suit | si le vis-à-vis quitte aussi sa lane (counter-roam), le coût en CS disparaît de lui-même (les deux perdent) : on le note « roam croisé » | relevés |

### Étape 4 : la suite, c'est-à-dire ce qu'a fait le mid adverse

Fenêtre de `tBack` à `tBack + 3 min` : ce que le vis-à-vis tire de son avance, **lui** impliqué.

- ses kills et assists hors de la mid lane (counter-roam permis par la prio) ;
- les objectifs pris par son équipe avec lui présent ;
- les plaques ou la T1 mid prises ;
- l'écart de mid qui **continue de se creuser** de `b` à `b + 2` au-delà de ce qui est déjà compté.

### Étape 5 : le verdict, sur une seule échelle

Gold, XP et objectifs n'ont pas la même unité. Le moteur a déjà une formule qui les met sur la même échelle :
l'estimation de partie de `winProbability.ts` (`z = 0,0075 × or / t + 0,004 × XP / t + 0,28 × objectifs`). Chaque
élément du bilan devient un `Δz` à la minute du roam :

```
net = Δz(gains) − Δz(coût) − Δz(suite adverse)
```

| Verdict | Condition (seuils à calibrer, voir § 6) | Affiché |
|---|---|---|
| **Roam rentable** | `net ≥ +s` | aucun reproche ; « roam réussi » en review |
| **Échange neutre** | `|net| < s` | information seulement |
| **Roam perdant** | `net ≤ −s` et au moins 6 CS perdus | un moment de micro-review |

Cette échelle ne sert qu'à comparer coût et gain. Elle n'est jamais affichée comme une note, comme P(win) aujourd'hui.
Le filtre du garbage time (P < 0,18 ou > 0,85) s'applique.

**Exemple (partie 16.x).** À 7:40, le mid part bot sans push. De 7:00 à 10:00, il perd 9 CS et 380 XP sur son
vis-à-vis.
- Cas 1 : il fait un assist sur l'ADC adverse (300 g), et son équipe prend le Dragon 35 s plus tard avec lui à moins de
  2 800 de la fosse. Gain > coût → **rentable**.
- Cas 2 : même assist, mais le mid adverse prend 2 plaques puis tue le top avec le jungler à 9:30. Coût + suite > gain
  → **perdant**, « il fallait push ta wave avant de partir ».
- Cas 3 : aucun kill ni objectif. Le schéma actuel `mid-roam-plates` le voit déjà, mais seulement si au moins une
  plaque est tombée ; le bilan le voit même sans plaque.

## 4. Ce que le moteur en fera dans l'app

| Écran | Ce que le joueur voit |
|---|---|
| **Micro-review** (`MicroReviewPanel.tsx`) | Un roam perdant devient un moment (déclencheur `early-deficit`, nouveau schéma `mid-roam-unpaid`). Il remplace `mid-roam-plates` et, pour le mid, `bad-rotation`. Résumé : « 7:40 · Roam bot — −9 CS, −380 XP face à ton vis-à-vis ; gagné : 1 assist (300 g) ; ensuite ton vis-à-vis a pris 2 plaques et tué ton top ». QCM : « Wave pas poussée avant de partir » (`bad-wave-sync`), « Roam sans cible claire » (`cs-deficit`, fiche roam check), sortie justifiée « Le roam valait le coup ». |
| **Retard à 10:00** | Si l'écart vient surtout d'un roam **rentable**, la carte « retard précoce » n'est pas créée, ou elle propose d'abord la sortie justifiée. C'est le faux positif qu'on corrige aujourd'hui. |
| **Fiche Codex** | `codex_mid_roam_budget_next_wave_numbers` (déjà écrite pour 2026 : push d'abord, budget sur la wave suivante). Il faut l'ajouter à `bad-wave-sync` dans ses `mistakeSlugs` : elle n'est liée aujourd'hui qu'à `overstay`. Drill : « 5 prochaines parties : au plus 4 CS perdus par roam ». |
| **Review** | Notes pré-remplies (`reviewNotes.ts`) : « 7:40 Roam bot : rentable (assist, Dragon) » ou « perdant (−9 CS, 2 plaques) ». Plus tard, un encart « Bilan des roams » (une ligne par roam, coût / gain / suite), à maquetter dans Penpot d'abord. |
| **Labo d'erreurs** | Rien d'automatique dans un premier temps. L'erreur n'entre au Labo que si le joueur la choisit dans le QCM. Une règle M20 auto (`bad-wave-sync`, gravité 2) viendra après calibrage, si le taux de faux positifs est bas. |
| **Assistant / Mon plan** | Nouveaux indicateurs par partie : `roams`, `roamsPaid`, `roamCsLost`. Règle `mid_roam_unpaid_pattern` : mid, au moins 1 roam perdant dans 3 des 5 dernières parties → focus « Push avant de roam ». Critère d'expérience : au moins 60 % de roams rentables ou neutres sur 5 parties. Bilan hebdo : « Tes roams : 7 sur 11 rentables ». |

## 5. Mise en œuvre

**Back-end** (`src/lib/microReview/*.ts`, `electron/main/*`, tests) :

1. `roamLedger.ts` (fonction pure) + `DETECTOR_SPEC.roam` (`minOffAxis` 2 600, `minAwaySec` 20, `sampleSec` 5,
   `tailSec` 30, `followUpSec` 180, `minCsLost` 6, `netThreshold` à calibrer, `untilSec` 1200) ;
2. branchement dans `anomalyDetector.ts` § 6 : nouveau schéma `mid-roam-unpaid` dans `MOMENT_PATTERNS` et dans l'ordre
   des schémas, suppression du « retard précoce » quand un roam rentable explique l'écart ;
3. `smartQcm.ts` : contexte `mid-roam` réutilisé avec les nouveaux faits (`gains`, `followUp`, `freezeLikely`) ;
4. `codex.json` : `bad-wave-sync` ajouté aux `mistakeSlugs` de la fiche roam du mid ;
5. `ANALYSIS_VERSION` 10 → 11 ;
6. ensuite, l'assistant : `features.ts`, `rules.ts`, `problems.ts` (problème `farming` ou `objective-setup`), critère
   dans `experiments.ts`.

**Front-end** (après accord) : textes `microReview.*` fr + en (résumé avec gains et suite, raisons du QCM, sortie
justifiée) et la note pré-remplie. L'encart « Bilan des roams » vient en second temps, après une maquette du Graphic
Design.

**Tests à écrire** (fixtures timeline, `tests/unit/microReviewRoam.test.ts`) :

- roam sans gain avec freeze → perdant, `freezeLikely` ;
- roam avec assist et Dragon → rentable, pas de carte ;
- roam rentable puis conversion du mid adverse (2 plaques + kill top) → perdant ;
- roam court vu par la seule position d'un kill ;
- roam suivi d'un recall ;
- roam croisé (les deux mids sortent) ;
- mort pendant le roam ;
- seuils testés des deux côtés ;
- `MOMENT_PATTERNS` est itéré par les tests existants : le nouveau schéma doit y avoir son cas.

**Calibrage** (avant de fixer `netThreshold`), sur les parties en cache en lecture seule, mid seulement, 16.x :

- nombre de roams pour 100 parties ;
- répartition de `net` ;
- winrate des parties avec roams rentables contre perdants ;
- faux positifs relus à la main sur 20 roams « perdants ».

Le verdict doit séparer les parties gagnées des perdues, comme pour les règles de novembre.

**Effort.** Back-end ≈ 2 jours (bilan + branchement + tests 1,5 j, calibrage 0,5 j), puis l'assistant ≈ 0,5 j.
Front-end ≈ 0,5 j pour les textes, plus l'encart si on le valide.

## 6. Risques et limites

- **Relevés de 60 s** : CS et XP ne sont connus qu'à la minute. Le coût porte sur une fenêtre de 2 à 4 minutes, pas
  exactement sur le roam. Un roam de moins de 60 s sans kill n'est pas vu, et dans ce cas il a peu coûté.
- **Le freeze n'est pas dans les données**, ni l'état des waves au départ. Le « pas crash avant de partir » se lit à sa
  conséquence (CS perdus), et le texte reste au conditionnel.
- **Attribution** : un écart de side lane peut venir du jeu propre de l'allié. On ne le compte que s'il y a un kill ou
  un assist du mid dans cette lane. Une pression sans kill (Flash forcé, wave sauvée) reste invisible, donc le moteur
  sous-estime certains bons roams. Le choix est assumé : mieux vaut un « neutre » qu'un faux reproche.
- **Suite adverse** : 3 minutes, c'est arbitraire. On le vérifie au calibrage (2, 3 ou 4 minutes) pour voir quelle
  durée sépare le mieux les parties gagnées des perdues.
- **Or des kills** : les champs `bounty` / `shutdownBounty` ne sont pas encore lus dans le code. Il faut vérifier qu'ils
  existent dans les timelines en cache, sinon on garde l'estimation `bountyGold`.
- **Double compte** : un roam perdant ne doit pas produire aussi `bad-rotation` ni la carte de 10:00 (règle « un
  événement, une lecture ») ; les tests le vérifient.
