# Bilan des ganks du jungler

_20/11/2026, session Engine. Règle propre au jungler, en complément du bilan des roams
([`2026-11-20-bilan-des-roams-tous-laners.md`](2026-11-20-bilan-des-roams-tous-laners.md)). Demande de l'utilisateur :
pour chaque gank, compter les camps perdus et l'écart de gold et d'XP avec le jungler ennemi avant et après, puis juger
le gank comme les autres lanes. Valait-il le coup ? La perte a-t-elle été compensée ailleurs ? Le gank a-t-il créé un
avantage ? **Saison en cours seulement (16.x)**, conformément à la règle du 20/11. Lecture seule du code ; les mesures
viennent d'une copie de la base locale (431 parties classées 16.x avec timeline), supprimée après lecture._

## 1. La connaissance

- Un gank se paie en **camps non pris** (gold, XP, progression de la quête de jungle) et en **tempo** : pendant ce
  temps, le jungler ennemi farm, invade ou prend un objectif de l'autre côté. Il est rentable s'il crée plus qu'il ne
  coûte (kill, flash, back forcé, plaques, objectif, prio). Le guide high-elo l'enseigne déjà : « ne gank pas avec tes
  camps prêts, sauf si le gank vaut plus qu'eux ». C'est la fiche Codex `codex_jgl_t25s_recall_camps_up_90rule_weakside_first`
  (guides jungle saison 16, [V01] [V05] [V06] de [`RECHERCHE_CONNAISSANCES.md`](../RECHERCHE_CONNAISSANCES.md) § 4).
- **Mesuré sur nos parties 16.x :**
  - **un camp vaut presque toujours 4 CS de jungle**. Les hausses par minute du compteur tombent sur 8 (2 964 fois),
    4 (2 673) et 12 (1 981) ; 0 (1 934) correspond aux minutes sans camp. Les valeurs impaires sont rares (Carapateur et
    restes, à vérifier) ;
  - CS de jungle médian d'un jungler : 12 à 2:00, 20 à 3:00, 28 à 4:00, 40 à 6:00 ;
  - pendant une minute de farm pur (sans kill ni sbire de lane, entre 4:00 et 14:00), un jungler gagne en médiane
    **39 g et 55 XP par CS de jungle**. Ce chiffre inclut le revenu passif. La valeur d'un camp sera mesurée **sans** le
    passif, par régression, plutôt que figée.
- Timers 2026 utiles : camps à 0:55 (Krugs et Gromp 1:07) ; petits camps de retour 2:15 après leur mort ; fenêtres de
  gank `DETECTOR_SPEC.gank` 1:50-2:25 et 2:40-3:50 ; Carapateur 2:55 (absent des données).
- **Quête de jungle (16.x)** : son objet (1204) est détruit à la fin de la quête, vers 13:41 en médiane. L'écart de fin
  de quête avec le jungler ennemi se mesure comme pour les laners
  ([`2026-11-20-quetes-de-role-dans-le-bilan-des-roams.md`](2026-11-20-quetes-de-role-dans-le-bilan-des-roams.md)).

## 2. Ce que le moteur fait déjà

- **`jungle-camps-up-gank`** (`anomalyDetector.ts`, `DETECTOR_SPEC.gankCost`) : entre 2:00 et 12:00, le jungler est en
  lane près d'un ennemi **sur un relevé**, il n'y a ni kill ni mort dans la minute, et il perd au moins 8 CS de jungle
  sur le jungler ennemi pendant cette minute. Ce schéma ne voit que le gank **raté** qui coûte des camps. Il ne mesure ni
  le gold ni l'XP, ne voit pas le gank réussi, et rate le gank qui tombe entre deux relevés.
- **`jungle-weakside-stolen`**, **`jungle-window-unpunished`**, **`jungle-counter-tempo`** : des morceaux du tempo
  (camps volés, fenêtres non punies), lus séparément.

## 3. Le calcul : un bilan par gank

Le principe est le même que `roamLedger` : **repérer → coût → gain → suite adverse → verdict sur l'échelle de
`winProbability`**. Le jungler n'a pas de lane, donc le repérage et le coût changent. Nouvelle fonction pure
`gankLedger(match, timeline, pid)`, dans `roamLedger.ts` ou à côté.

### 3.1 Repérer le gank (début `tIn`, fin `tOut`, lane visée)

Il y a gank quand le jungler, vivant, est **dans une lane ou dans la rivière à moins de 1 500 d'une lane**, avec un
laner ennemi de cette lane à moins de 2 500. Le moteur le prouve de quatre façons :

1. une position interpolée toutes les 5 s (`posAt`) dans la lane ;
2. **un kill, un assist ou une mort du jungler** dans la lane (événement daté et positionné : la preuve la plus sûre) ;
3. **une hausse de `minionsKilled` du jungler** : il a pris des sbires de lane, donc il y était, même sans relevé au bon
   moment ;
4. un `TURRET_PLATE_DESTROYED` dont il est le tueur.

Le gank va de la première preuve à son retour dans la jungle ou en base. Deux ganks de la même lane à moins de 45 s
d'écart forment un seul gank. Fenêtre : de 1:50 jusqu'à la chute de la T1 de la lane visée, au plus tard 20:00.
Ensuite, ce sont des fights de mid game, déjà lus par d'autres détecteurs.

### 3.2 Le coût : ce que le gank a coûté au jungler

Mesuré du relevé avant `tIn` (minute `a`) au premier relevé au moins 60 s après `tOut` (minute `b`), comme pour les
roams.

| Coût | Calcul |
|---|---|
| **Camps perdus** | `(CS jungle ennemi − CS jungle du joueur)` en `b`, moins le même écart en `a`, ÷ 4 = camps perdus sur le jungler ennemi. Plus un repère absolu : rythme de camps du joueur sur les 3 minutes d'avant × durée, moins les camps réellement pris |
| **Écart de gold** avec le jungler ennemi | `goldGap(a) → goldGap(b)` (`totalGold`) ; on le montre **avant** et **après**, comme demandé |
| **Écart d'XP** avec le jungler ennemi | `xpGap(a) → xpGap(b)`, montré avant et après |
| **Camps volés** pendant le gank | le jungler ennemi gagne au moins 8 CS de jungle dans un quart de notre jungle (lecture `campsStolen` déjà codée) |
| **Mort du jungler** | gold donné (`bounty` + `shutdownBounty` de `CHAMPION_KILL`, présents dans le cache) + camps et XP manqués pendant le respawn (`deathTimerSec`) |
| **Quête de jungle** | retard pris sur le jungler ennemi pendant la fenêtre (même méthode que pour les laners), compté seulement si son poids est calibré non nul |

### 3.3 Le gain : ce que le gank a créé

Fenêtre de `tIn` à `tOut + 30 s`, et **seulement les événements où le jungler est impliqué** (tueur, assistant ou
présent à moins de 2 800 d'un objectif) :

| Gain | Calcul |
|---|---|
| **Kills et assists** | or réel du kill (`bounty` + `shutdownBounty`) |
| **Lane gankée** | écart gold + XP + CS de l'allié (du duo en bot) contre son vis-à-vis, de `a` à `b`. Compté seulement s'il y a eu un kill, un assist ou un back forcé ennemi |
| **Back forcé du laner ennemi** | le laner ennemi fait un achat vivant (preuve d'un passage en base) pendant le gank ou dans les 30 s après, alors qu'il était sous 35 % PV au relevé d'avant. Le gank le fait sortir de lane sans le tuer, et il perd des CS : c'est le gain du « gank qui ne tue pas mais réussit » |
| **Plaques, tour** | prises par l'équipe dans la lane gankée pendant la fenêtre, le jungler présent |
| **Objectif enchaîné** | Dragon, Larves ou Héraut pris par l'équipe dans les 60 s après le gank, le jungler présent (bot → Dragon, top → Larves ou Héraut) |
| **Repère invisible** | Flash brûlé, sorts dépensés : absents des données, donc jamais comptés |

### 3.4 La suite : la compensation de l'autre côté

C'est le cœur de la demande. Pendant le gank et dans les 3 minutes qui suivent, **ce que le jungler ennemi a fait de
son côté** :

- ses camps pris (déjà dans le coût) et les camps **qu'il nous a volés** ;
- ses kills ou assists dans une autre lane (contre-gank, gank de l'autre côté) ;
- les objectifs pris par son équipe avec lui présent : c'est le **trade cross-map**, par exemple un gank top payé par
  un Dragon ennemi ;
- l'écart de gold et d'XP entre junglers à `b + 2`, pour voir s'il continue de se creuser.

On regarde aussi dans l'autre sens : le laner allié gagne-t-il encore sa lane 3 minutes plus tard, ou son avance est-elle
retombée ?

### 3.5 Le verdict

```
net = Δz(gains) − Δz(coût) − Δz(suite adverse)      (échelle de winProbability, jamais affichée)
```

| Verdict | Condition (seuils à calibrer) | Texte |
|---|---|---|
| **Gank rentable** | `net ≥ +s` | « gank rentable » |
| **Échange** | `|net| < s`, avec des gains d'un côté et des pertes de l'autre | « tu as perdu 3 camps, mais ton top a pris 1 kill et 2 plaques : échange équilibré » |
| **Gank perdant** | `net ≤ −s` et au moins 2 camps perdus, ou une mort | moment de micro-review |

**Timer du gank** (il explique le verdict, sans changer le chiffre), lu à `tIn` :

| Timer | Lecture |
|---|---|
| **Bon** : camps déjà pris | le joueur a pris des camps dans la minute avant ; son rythme de farm suit sa médiane |
| **Bon** : sur la fenêtre de gank 2026 | 1:50-2:25 ou 2:40-3:50 (`DETECTOR_SPEC.gank`) |
| **Bon** : laner ennemi bas | laner ennemi sous 50 % PV au relevé d'avant, ou plus bas niveau que l'allié |
| **Bon** : jungler ennemi vu de l'autre côté | jungler ennemi à plus de 8 000 au relevé d'avant (lecture de `tempoWindow`) |
| **Mauvais** : camps prêts | aucun camp pris depuis plus de 2:15 (temps de retour d'un petit camp), et un rythme de farm qui chute pendant le gank |
| **Mauvais** : jungler ennemi tout près | jungler ennemi à moins de 3 000 de la lane visée |

### 3.6 Exemple (partie 16.20)

À 6:20, le jungler gank bot. Avant : −50 g et +30 XP sur le jungler ennemi. Après, à 8:00 : −420 g et −310 XP. Sur la
fenêtre, il perd 3 camps (12 CS de jungle de moins). Il prend un assist sur l'ADC ennemi (300 g pour l'équipe), et le
Dragon tombe 40 s plus tard avec lui à la fosse. De son côté, le jungler ennemi a farmé les camps top et pris 2 camps
dans notre jungle top.

→ Coût : 3 camps et 2 camps volés, soit −370 g et −340 XP environ. Gain : assist (300 g) et Dragon (poids 1 de
`OBJECTIVE_WEIGHT`). **Gank rentable.**

Carte : « Gank bot 6:20 — tu as perdu 3 camps et le jungler ennemi en a volé 2 (écart : −50 g → −420 g, +30 XP → −310
XP) ; gagné : 1 assist et le Dragon. Rentable. »

Sans le Dragon et sans le kill, avec un back forcé de l'ADC ennemi seulement, le verdict serait **échange**. Sans rien
du tout, il serait **perdant** (le cas actuel de `jungle-camps-up-gank`, mesuré cette fois en gold et en XP).

## 4. Ce que le moteur en fera dans l'app

| Écran | Ce que voit le jungler |
|---|---|
| **Micro-review** | Un gank perdant devient un moment (`early-deficit`, schéma `jungle-gank-unpaid`, qui remplace `jungle-camps-up-gank`). Le résumé donne les camps perdus, l'écart avant et après avec le jungler ennemi, le gain et ce que le jungler ennemi a fait. QCM : « Gank avec tes camps prêts » (`cs-deficit`, fiche camps up / règle des 90), « Gank mal exécuté » (`bad-engage-angle`, fiche des étapes du gank), sortie justifiée « Échange assumé ». Ces options existent déjà pour `jgl-gank-camps-up` |
| **Fiches Codex** | `codex_jgl_t25s_recall_camps_up_90rule_weakside_first` (camps up) et `codex_jgl_clear_ministeps_gank_spell_order_int_check` (exécution) : déjà écrites pour 2026. Drill : « 5 prochaines parties : au plus 2 camps perdus par gank sans kill » |
| **Review** | Notes pré-remplies : une ligne par gank (« 6:20 Gank bot : rentable — assist, Dragon ; −3 camps »). Dans l'encart « Bilan des roams », une section « Bilan des ganks » (maquette Penpot d'abord) |
| **Labo d'erreurs** | Rien d'automatique au début ; une règle M\* seulement après calibrage |
| **Assistant / Mon plan** | Indicateurs par partie : `ganks`, `ganksPaid`, `campsLostPerGank`, `gankGoodTimer`. Règle `jungle_gank_unpaid_pattern` (au moins 2 ganks perdants dans 3 des 5 dernières parties) → focus « Farm d'abord, gank sur un timer ». Critère d'expérience : au moins 60 % de ganks rentables ou en échange sur 5 parties |
| **Staff (plus tard)** | Le bilan d'un gank vu aussi par le laner ganké : « ton jungler a payé 3 camps pour ta lane, qu'en as-tu fait ? » |

## 5. Mise en œuvre

**Back-end :**
1. `gankLedger` (fonction pure) et `DETECTOR_SPEC.gank` étendu : `campCs` 4, `laneRadius` 1 500, `enemyRadius` 2 500,
   `mergeSec` 45, `tailSec` 30, `followUpSec` 180, `minCampsLost` 2, `netThreshold` à calibrer, `untilSec` 1 200 ;
2. preuve de présence par les sbires de lane (`minionsKilled` du jungler) ;
3. `jungle-gank-unpaid` dans `MOMENT_PATTERNS`, à la place de `jungle-camps-up-gank`, dans l'ordre des schémas de
   jungle ;
4. contexte `jgl-gank-camps-up` réutilisé avec les nouveaux faits ;
5. `ANALYSIS_VERSION` monte avec le bilan des roams (un seul cran) ;
6. ensuite, l'assistant (`features.ts`, `rules.ts`, critère dans `experiments.ts`).

**Front-end :** textes `microReview.*` (résumé, timers, verdicts) fr + en ; notes de review ; section « Bilan des ganks »
après la maquette.

**Tests :**
- gank raté avec camps prêts → perdant ;
- gank avec assist et Dragon → rentable ;
- gank sans kill mais avec un back forcé du laner → échange ;
- gank payé par un Dragon ennemi de l'autre côté → perdant ;
- gank repéré seulement par les sbires de lane pris ;
- deux ganks fusionnés ;
- mort du jungler pendant le gank ;
- camps volés pendant le gank ;
- jungler ennemi tout près au départ (mauvais timer) ;
- un gank ne produit jamais aussi `jungle-camps-up-gank` ni un deuxième moment.

**Calibrage** (16.x, lecture seule) :
- valeur d'un camp sans le revenu passif ;
- ganks pour 100 parties de jungler ;
- répartition du bilan ;
- winrate selon le verdict et selon le timer ;
- 20 ganks « perdants » relus à la main.

**Effort :** Back-end ≈ 1,5 jour en plus du bilan des roams (il réutilise le même socle). Front-end ≈ 0,25 jour de
textes.

## 6. Risques

- **Relevés de 60 s** : le compteur de camps n'est connu qu'à la minute, donc « camps perdus » se mesure sur 2 à 3
  minutes. Un gank court entre deux relevés n'est vu que par un événement (kill, mort, plaque) ou des sbires de lane pris.
- **Quel camp ?** Riot ne dit pas quel camp a été pris ni quand il réapparaît. « Camps prêts » est une déduction : rien
  pris depuis 2:15, et le rythme qui chute.
- **Flash brûlé, sorts dépensés, pression sans kill** : invisibles. Seul le back forcé est compté. Le moteur penche donc
  vers « échange » plutôt que vers un faux reproche.
- **Attribution du cross-map** : un Dragon ennemi pendant un gank top peut avoir été pris sans le jungler ennemi. On ne
  le compte que s'il y était présent.
- **Carapateur** : absent des données, il peut fausser un peu le compteur (valeurs impaires). À vérifier au calibrage.
