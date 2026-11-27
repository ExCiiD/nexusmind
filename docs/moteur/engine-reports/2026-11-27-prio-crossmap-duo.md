# Prio avant objectif, crossmap quand un objectif n'est pas contesté, responsabilité du duo botlane

_27/11/2026, session Engine. Entrée : règles de l'utilisateur, `docs/moteur/REGLES_OBJECTIFS_PRIO_CROSSMAP.md` § 2 à § 4
(§ 1, la participation, est codé par le Back-end en ce moment). `docs/DECISIONS.md` relu (27/11, 20/11 cross-map soloQ,
21/11 notes pré-remplies et « Not a mistake », 24/11 vitesse). Code relu en lecture seule : `geometry.ts`,
`ledgerCore.ts`, `roamLedger.ts` (timers du support), `anomalyDetector.ts` (`DETECTOR_SPEC`, `absent-objective`,
`tempo-hesitation`), `playerSessionStatsCore.ts` (`buildObjectiveParticipation`), `mistakeTagCatalog.ts`, `codex.json`.
Saison en cours seulement (16.x). Aucun code, aucun commit._

**En bref.** Les trois règles sont calculables sur les timelines en cache, sans requête Riot de plus, **mais avec un
proxy pour la wave** : la timeline ne contient aucun sbire. La « prio » est donc lue sur ce qui la prouve
(plaque ou tour prise, vis-à-vis mort ou en base) puis sur ce qui la suggère (positions des laners aux relevés). Le
moteur produit d'abord des **chiffres de session**, puis, après relecture vidéo, **12 nouveaux tags** du Labo (dont 3 de late game et `objective-wrong-side`). Tout passe par les
ledgers existants (`PLAN_MOTEUR_BILANS.md`) pour ne rien compter deux fois. Les 10 questions du premier jet ont reçu
leur réponse (section suivante) ; 2 points de détail non bloquants restent au § 7.

**Mise à jour du 27/11 (soir)** : l'utilisateur a répondu aux 10 questions (`DECISIONS.md`, « Réponses aux 10 questions
d'Engine »). Le rapport est corrigé en conséquence : voir la section suivante, puis § 1.1, § 1.2, § 2.3, § 3, § 4.3,
le nouveau § 3bis (règles de late game) et § 7. **Deuxième correction (27/11, « Prio et objectif à jouer »)** : prio
mesurée au **climax** de la dernière wave avant l'objectif (§ 0.3, timings des waves vérifiés) ; objectif « à jouer » =
celui du **côté le plus avantagé** (nouveau § 1.4, tag `objective-wrong-side`). **Troisième ajout (27/11)** : concept
« jouer autour de la win condition » (nouveau § 3ter : joueur le plus fed, leader ×2, 2 tags) ; **réponses W1-W5 intégrées**
(§ 3ter.6 : support à dégâts, ×2 expliqué, choix du coach après la game, plusieurs win conditions, win condition adverse).
**Rapport final**, effort total au § 3ter.6.

## Décisions de l'utilisateur (27/11) et ce qu'elles changent

| # | Réponse | Effet dans ce rapport |
|---|---|---|
| 1 | La dérogation du 20/11 (pas de reproche de crossmap avant 14:00 en soloQ) **ne vaut ni pour le mid** (solo lane au centre, pas excentré) **ni pour le support** (pas attaché à la lane, CS / or / XP peu importants). Seuls le top et l'ADC la gardent. | `no-crossmap-trade` s'applique au jungler, au mid et au support, en soloQ comme en équipe, dès la phase de lane (§ 2.3). `DETECTOR_SPEC.soloQLaning.roles` reste `TOP`, `MIDDLE`, `BOTTOM` pour les autres schémas, mais la règle crossmap lit une liste à part : `crossmap.exemptRoles = ['TOP', 'BOTTOM']` avant 14:00 en soloQ |
| 2 | ~~Prio à l'apparition et dans la minute avant que l'objectif soit joué~~ **Remplacé (correction du 27/11)** : prio mesurée **à son climax, environ 30 s avant l'objectif** (dernière wave avant l'objectif), jamais après la prise. | une seule mesure, fenêtre W du climax par objectif (§ 0.3, timings vérifiés) |
| 3 | Après 20:00 les laners sont encore en lane mais l'organisation change : quêtes finies, objectifs plus lourds, botlane au mid, top / bot selon rôle, TP et timers d'objectif (split pusher du côté opposé, tank qui ramasse les waves et revient). En faire des règles, pas seulement des chiffres. | nouveau **§ 3bis**, 3 tags de late game ; la prio après 20:00 est lue sur les règles de late game au lieu de « chiffres seulement » ; gravité + 1 sur les objectifs après 20:00 |
| 4 | Oui : le support aide à la prio seulement sur un bon timing (crash + reset), sinon la règle du duo prime. | § 1.1 (support) |
| 5 | Les wards seules ne « contestent » pas ; un objectif allié non contesté par l'adversaire n'est pas une faute de nos joueurs. | § 2.1 confirmé |
| 6 | « ADC trop en retard » = 1 500 d'or de moins que l'ADC adverse ou 2 niveaux. | § 3.1 confirmé |
| 7 | Faute partagée : tag ADC + chiffre support, **mais** ce peut être la faute du support : l'ADC peut se sentir obligé d'avancer pour ramasser les sbires ; un mauvais timing de roam qui met l'ADC en danger (ADC pas déjà en retard) = faute du support. Définir les critères. | critères au § 3.2 (cas « ADC forcé d'avancer ») |
| 8b | **Objectif « à jouer » = celui du côté le plus avantagé** (correction du 27/11) ; exception si le jungler est lui-même devant. | § 1.4 : `sideEdge`, nouveau tag `objective-wrong-side`, sidelaner sans prio annulé dans ce cas |
| 8 | Sidelane sans prio : aussi en équipe, **et plus important en équipe**. Pas de prio + objectif pris par l'adversaire alors que notre jungler est du côté de ce sidelaner = faute possible du sidelaner (gestion de wave et/ou reset désynchronisé), seulement si l'objectif devait être joué (contesté ou non). | `no-prio-before-objective` étendu au top et à l'ADC, critères au § 1.1, gravité 2 en contexte d'équipe |
| 9 | Prio et duo en soloQ comme en équipe ; crossmap du jungler aussi. | confirmé |
| 10 | Règle du duo **toute la partie**, plus lourde avant 14:00. | § 3 : fenêtre = toute la partie, gravité et poids réduits après 14:00 |

---

## 0. Socle commun aux trois règles

### 0.1 Les objectifs et leur côté

| Objectif | Apparition (16.x) | Côté de la carte | Lanes « du côté » | Source |
|---|---|---|---|---|
| Dragon | 5:00, puis 5:00 après chaque kill | bot | BOT (sidelane), MID | `DETECTOR_SPEC.spawns`, `DONNEES_JEU_2026.md` |
| Larves (grubs) | 8:00, une seule fois, disparaissent à 14:45 | top | TOP, MID | idem |
| Héraut | 15:00 → 19:45 | top | TOP, MID | idem |
| Baron | 20:00, puis 6:00 après le kill | top | TOP, MID | idem |
| Ancestral | 6:00 après l'âme ou le kill précédent | bot | BOT, MID | idem |

Les heures d'apparition se déduisent toutes de la timeline (`ELITE_MONSTER_KILL` + délai) ; `pitObjectiveAt()` dit déjà
quel monstre occupe une fosse à un instant donné. Les premières apparitions (5:00, 8:00, 15:00, 20:00) tombent **pile sur
un relevé de minute** : on y lit les vraies positions, sans interpolation. Les réapparitions du Dragon et du Baron
tombent entre deux relevés : position interpolée (`ledgerCore.posAt`), moins sûre.

### 0.2 Participation (§ 1, aligné sur le Back-end)

Les règles ci-dessous utilisent **la même fonction** que le Back-end pour le § 1, pas une deuxième définition. Ce que
le présent rapport suppose (si le Back-end a retenu d'autres chiffres, les siens priment et on aligne ici) :

- l'objectif revient à **notre équipe** (`killerTeamId` ou équipe du tueur) ;
- le joueur est tueur ou dans `assistingParticipantIds`, **ou** il a « combattu autour » : vivant et à moins de
  `PIT_FIGHT_RADIUS` (3 000) de la fosse au moment du kill (position interpolée), ou impliqué dans un `CHAMPION_KILL`
  à moins de 3 000 de la fosse entre −30 s et +10 s ;
- le « tué par toi » n'est plus une mesure.

Demande au Back-end : exposer cette fonction (par ex. `objectiveParticipationOf(track, event, pid)`) dans un fichier
partagé (`ledgerCore.ts` ou un nouveau `objectiveCore.ts`), pour que les stats de session et les règles § 2-4 lisent la
même chose. Elle sert aussi ici à dire si un objectif a été **contesté** (§ 3).

### 0.3 Le proxy de prio : `laneStateAt(track, lane, team, T)`

**Ce qu'on veut savoir** : avant l'apparition, la wave de cette lane est-elle avancée ou crashée chez l'adversaire
(prio pour nous), ou l'inverse ?
**Ce que la timeline donne** : positions des 10 champions toutes les 60 s (exactes) et entre deux relevés (estimées),
CS par minute, morts et réapparitions, achats (preuve de base), plaques et tours à la ms.
**Ce qu'elle ne donne pas** : position et taille des waves, freeze, slow push, sbires sous la tour, sorts (TP, Flash),
le moment exact d'un recall.

**Quand mesurer : le climax de la prio (correction de l'utilisateur, 27/11, remplace la réponse 2).** La prio se
mesure **à son climax, environ 30 s avant l'objectif** : la dernière wave qui peut être crashée avant l'objectif.
Jamais après que l'objectif a été pris.

*Horloge des waves, saison en cours* (wiki officiel, page « Minion », lue le 27/11/2026, notes 26.1 pour l'heure de
départ ; déjà dans `DONNEES_JEU_2026.md` pour les intervalles) :
- 1re wave à **0:30**, puis une wave toutes les **30 s** ; toutes les **25 s à partir de 14:00** (suite 13:30 / 14:00 /
  14:25) ; toutes les **20 s à partir de 30:00** ;
- vitesse de base des sbires **350** en début de partie (26.1 : 325 → 350), qui monte ensuite par paliers de minutes
  jusqu'à 450 ; le wiki ne donne pas l'heure exacte des paliers (et sa page se contredit entre 325 et 350 :
  **à vérifier à la vidéo**, § 6) ;
- **sidelanes (top, bot), de la 2e wave jusqu'à 14:00** : bonus de vitesse au spawn (+111, puis −4,5 par wave), retiré
  en 4 paliers sur 25 s. C'est ce qui fait arriver les waves des sidelanes au milieu à peu près en même temps que celle
  du mid ;
- le wiki ne donne **ni la longueur des lanes ni l'heure de rencontre des waves**. Calcul sur nos coordonnées
  (`geometry.ts`) : base → milieu du mid ≈ 8 000-8 500 u, soit **≈ 23-25 s** à 350 ; base → milieu d'une sidelane
  (près du coin) ≈ 10 500-11 000 u, soit **≈ 25 s** avec le bonus avant 14:00 et **≈ 28-31 s** sans bonus après 14:00
  (vitesse 350 à 375). **Valeurs estimées, marge ±5 s**, à confirmer sur 10 rencontres de waves filmées (§ 6).

*La wave du climax* : pour un objectif à l'heure de référence T_obj (définie plus bas), c'est la dernière wave S
(heure de spawn sur la grille ci-dessus) telle que **S + trajet + 10 s ≤ T_obj** (trajet jusqu'au milieu, puis ~10 s
pour qu'une wave poussée atteigne la tour adverse et crashe). **Fenêtre de mesure W = [S + trajet − 5 s, S + trajet
+ 20 s]**, coupée à T_obj et, de toute façon, **avant la prise de l'objectif**. Le centre de W tombe vers T_obj − 30 s,
ce qui est le « climax » décrit par l'utilisateur.

| Objectif (1re apparition) | Wave du climax (spawn) | Trajet estimé | **Fenêtre W** | Relevés de minute autour |
|---|---|---|---|---|
| Dragon 5:00 | 4:00 (celle de 4:30 n'arrive au milieu que vers 4:55) | 25 s | **4:20 → 4:45** | 4:00 et 5:00 |
| Larves 8:00 | 7:00 | 25 s | **7:20 → 7:45** | 7:00 et 8:00 |
| Héraut 15:00 | 14:00 (14:25 arrive vers 14:55) | 30 s | **14:25 → 14:50** | 14:00 et 15:00 |
| Baron 20:00 | 19:00 (grille 14:00 + 25 s : 19:00, 19:25, 19:50 ; 19:25 arrive vers 19:55) | 30 s | **19:25 → 19:50** | 19:00 et 20:00 |
| Réapparitions (Dragon 5:00 après le kill, Baron 6:00, Ancestral 6:00) | calculée par la même formule sur la grille | 25 s avant 14:00, 30 s après | S + trajet − 5 s → S + trajet + 20 s | les deux relevés qui encadrent W |

*Heure de référence T_obj.* = l'apparition si l'objectif est joué (premier champion dans la fosse, 900, ou premier
`CHAMPION_KILL` à moins de 3 000 de la fosse, ou kill) moins de 90 s après ; sinon l'heure où il commence à être joué
(un Dragon en place depuis 3 minutes : c'est la wave d'avant le moment où une équipe y va qui compte). **W finit
toujours avant la prise** ; si l'objectif est pris avant même le début de W (prise très rapide), la mesure est
`unknown`. Une seule mesure par objectif : il n'y a plus de « deuxième mesure » (l'ancienne réponse 2 est remplacée).

*Comment on lit W avec des relevés de 60 s.* W tombe **entre deux relevés de minute** (pour les premières
apparitions, juste après le relevé T_obj − 60 s et avant celui de T_obj). Trois sources, de la plus sûre à la moins
sûre :
1. **événements datés à la ms dans W** (plaques, tours, kills, morts) : exacts, ce sont P1 et P2 ci-dessous ;
2. **le relevé qui précède W** (T_obj − 60 s pour une 1re apparition) et **le suivant** (T_obj) : positions exactes,
   mais 20 à 40 s avant ou après le climax ; la position pendant W est **interpolée** entre les deux (`ledgerCore.posAt`,
   qui suit aussi les morts et les achats). Erreur de position : en lane, un laner bouge peu, d'où une erreur typique
   de 1 000 à 2 000 u ; elle devient inutilisable si le laner a reculé en base ou est mort entre les deux relevés
   (`unknown`) ;
3. **CS de la wave du climax** : le relevé suivant W (T_obj) contient les CS de la wave S (6 à 7 sbires avant 14:00,
   un canon toutes les 3 waves). Laner de A avec **≥ 5 CS de plus** entre les deux relevés **et** adversaire à ≤ 2 :
   A a tué la wave vite, signe de push (signal faible, P5).

Marge globale : timing de la wave ±5 s (vitesse et trajet estimés), position ±1 000-2 000 u ; d'où, comme avant,
seuls les signaux datés (P1-P2) et la position près de la tour adverse (P3) peuvent produire une erreur au Labo.

Pour chaque lane L (TOP, MID, BOT), on prend le ou les laners de chaque équipe (rôle `teamPosition`,
BOT = ADC + support), puis on lit les signaux dans cet ordre (le premier qui conclut l'emporte) :

| # | Signal | Lu comme | Fiabilité |
|---|---|---|---|
| P1 | `TURRET_PLATE_DESTROYED` ou `BUILDING_KILL` sur L par l'équipe A dans W ou dans les 30 s avant W | **prio A prouvée** (la wave a crashé) | haute |
| P2 | laner adverse de L **mort** (`deadAt`) ou **en base** (`inBaseBox`, ou achat) pendant au moins 15 s de W, laner de A vivant et pas en base | **prio A probable** (la wave pousse seule chez l'adversaire) | haute, sauf si la wave était déjà sous la tour de A (freeze) |
| P3 | laner de A à moins de 1 500 de la **tour extérieure adverse encore debout** de L (`crashRadius` du support, déjà utilisé) pendant W (position interpolée) ou au relevé qui précède W | **prio A probable** (crash) | moyenne |
| P4 | « front » : laner de A plus avancé que le milieu de L (distance à la tour adverse debout < distance à sa propre tour debout − 1 000) **et** laner adverse en arrière du milieu | **prio A suggérée** | basse : un laner peut zoner devant une wave qui freeze chez lui |
| P5 | CS de la wave du climax (entre les relevés qui encadrent W) : A ≥ +5, adversaire ≤ 2 | départage seulement | basse |

Résultat : `ours` / `theirs` / `even` (aucun signal ou signaux contraires) / `unknown` (laner de A hors de sa lane,
position interpolée à travers une mort ou un recall, lane vide des deux côtés). « Tour debout » = tour extérieure, sinon
intérieure, lue sur les `BUILDING_KILL` : c'est ce qui tient compte des tours déjà tombées.

**Marge d'erreur estimée (à mesurer, § 6)** : une wave traverse une lane en 20 à 30 s ; un relevé de 60 s ne peut donc
pas dire où était la wave à T si seul P4 parle. Attendu : P1-P2 justes dans plus de 90 % des cas ; P3 vers 80 % ; P4 vers
60-70 %. D'où la règle : **seuls P1 à P3 peuvent produire une erreur au Labo** ; P4-P5 ne servent qu'aux chiffres de
session (affichés « prio probable »). Le texte d'une carte reste au conditionnel quand P3 est le seul signal.

**Lane sans laner** (après la phase de lane, Baron, Ancestral) : les rôles ne sont plus dans leur lane. On remplace
« laner de L » par « champion de chaque équipe le plus proche du milieu de L », et le résultat n'est jamais plus fort que
`probable`. Après 20:00, la prio n'est plus jugée par rôle de lane mais par les **règles de late game du § 3bis**
(décision 3) : botlane au mid, split pusher du côté opposé, tank qui ramasse les waves et revient.

### 0.4 Exceptions « l'équipe ne peut pas jouer l'objectif » (`canPlayObjective`)

Données par l'utilisateur pour le mid ; reprises pour toutes les règles :

- **infériorité numérique** : à T, nos champions vivants et hors base < ceux de l'adversaire (morts lus sur les
  réapparitions, base sur `inBaseBox` et les achats) ;
- **jungler à l'opposé** : notre jungler, au relevé le plus proche de T − 30 s, est plus près de l'autre fosse que de
  celle-ci, ou dans la moitié de carte opposée (`laneOf` / `zoneOf`) ;
- **jungler mort ou en base** à T (il ne peut pas mener l'objectif) ;
- **garbage time** : `winProbability` < 0,18 ou > 0,85 (même règle que la micro-review).

Quand une exception joue : la mesure est comptée dans les chiffres (« bonne habitude », comme dit l'utilisateur), mais
**aucune erreur** n'est créée au Labo.

---

## 1. Prio avant objectif (§ 2)

### 1.1 Détection

Pour chaque apparition d'objectif (§ 0.1), on calcule `laneStateAt` des 2 lanes du côté (sidelane + mid) pour les deux
équipes, puis on lit ce que chaque rôle de **notre** équipe a fait.

**Engagement de l'objectif** (pour le jungler) : notre jungler dans la fosse (`PIT_INSIDE_RADIUS` 900) au moins une fois
dans [T, T + 90 s] ou jusqu'à la prise, ou objectif pris par notre équipe, ou un `CHAMPION_KILL` impliquant un allié à
moins de 3 000 de la fosse dans la même fenêtre. Sinon, « pas engagé ».

| Rôle | Attendu (règle de l'utilisateur) | Mesure | Erreur au Labo (après validation) |
|---|---|---|---|
| **Jungler** | engage s'il a au moins la prio mid, ou mieux la sidelane du côté | engagements : avec prio sidelane / avec prio mid seulement / sans prio | **engagé sans aucune prio** (mid et sidelane `theirs` en P1-P3) **et** issue négative : objectif perdu ou volé, ou mort d'un allié au fight de la fosse. Une prise réussie sans prio n'est jamais une erreur (chiffre « risque payé ») |
| **Mid** | joue toujours pour la prio avant un objectif | prio mid à T : `ours` / `even` / `theirs` / absent (mort, base, ailleurs) | prio mid `theirs` (P1-P3) ou mid absent sans raison, **objectif joué par l'équipe et perdu**, aucune exception § 0.4. Mid mort à T → c'est la carte de mort qui lit l'instant, pas celle-ci |
| **Support** | aide la sidelane du côté ou le mid à prendre la prio, et pose la vision avant | présence dans la sidelane du côté ou au mid dans [T − 90 s, T] (hors de la botlane pour un objectif top) ; wards posées dans [T − 90 s, T] à moins de `WARD_RADIUS` (3 500) de la fosse (position du poseur, la ward n'a pas de coordonnées) | prio de la sidelane du côté **et** du mid `theirs`, support absent des deux, objectif perdu, aucune exception. **Objectif côté top (Larves, Héraut) avant 14:00** : le support ne doit quitter son ADC pour aider la prio que sur un **bon timing** (bot crashée P1/P3 puis reset du duo, ou ADC en base / mort) ; sans ce timing, rester bot n'est pas une faute et la règle du duo prime (décision 4). **La vision reste à M6 `no-ward-pre-obj`** (déjà existant) : pas de deuxième erreur pour la même ward |
| **Sidelane du côté** (top pour Larves / Héraut / Baron, ADC pour Dragon) | « encore plus important, ça doit se voir dans ses stats », **plus important encore en équipe** (décision 8) | prio de sa lane au climax (W) sur les objectifs de son côté ; chiffre mis en avant dans ses stats | `no-prio-before-objective` si **toutes** ces conditions : prio de sa lane `theirs` (P1-P3) au climax ; objectif **pris par l'adversaire** ; **notre jungler de son côté** (au relevé le plus proche de T_obj − 30 s, dans la moitié de carte de la fosse, à moins de `OBJECTIVE_RADIUS` 2 800 de la fosse ou dans la jungle de ce côté) ; objectif **à jouer** (§ 1.4) : pas du côté perdant, sauf exception `junglerEdge`, et notre jungler ou un autre allié est allé vers la fosse (participation § 0.2, ou un allié à moins de 2 800 de la fosse dans [T_obj − 30 s, prise]), qu'il ait été contesté ou non. **Annulé** si le jungler a joué le côté perdant (`objective-wrong-side`). Cause dite dans la `note` : **gestion de wave** (wave `theirs` sans reset) ou **reset désynchronisé** (sidelaner en base ou rentré dans [T_obj − 60 s, T_obj] alors que sa wave n'était pas crashée). Pas d'erreur si le sidelaner est mort (la carte de mort lit l'instant) ou si une exception § 0.4 joue. Gravité **2 en contexte d'équipe**, 1 en soloQ. Ce n'est pas un reproche de cross-map : la décision du 20/11 reste intacte pour le top et l'ADC |

### 1.2 Seuils proposés (dans `DETECTOR_SPEC.prio`, horloge 2026)

| Clé | Valeur | Raison |
|---|---|---|
| `waveSpawn` | 0:30, toutes les 30 s ; 25 s dès 14:00 ; 20 s dès 30:00 | wiki Minion + notes 26.1 (§ 0.3) |
| `waveTravelSec` | 25 (avant 14:00) / 30 (après) | estimé sur nos coordonnées, ±5 s, à filmer (§ 6) |
| `crashSec` | 10 | trajet milieu → tour adverse d'une wave poussée |
| `climaxWindow` | [S + trajet − 5 s, S + trajet + 20 s], coupée à T_obj et à la prise | climax ≈ T_obj − 30 s |
| `playDelaySec` | 90 | au-delà, T_obj = début du jeu sur l'objectif, pas l'apparition |
| `plateLookbackSec` | 30 avant W | une plaque juste avant le climax prouve la même wave |
| `crashRadius` | 1 500 | déjà calibré pour les timers du support (`roamLedger.ts`) |
| `frontMargin` | 1 000 | marge autour du milieu de la lane pour P4 |
| `oppAwayMinSec` | 15 | durée minimale vis-à-vis mort ou en base pour P2 |
| `csTieBreak` | +5 / ≤ 2 | P5, CS de la wave du climax |
| `sideGap` | 1 500 (or + XP) | écart minimal entre les deux côtés pour « le plus avantagé » (§ 1.4) |
| `sideMinEdge` | + 500 | le côté avantagé doit être devant, pas seulement moins derrière |
| `sideAbsentBonus` / `sidePrioBonus` | 1 000 par adversaire absent / ± 500 | § 1.4 |
| `junglerEdge` | ≥ 1 500 d'or **et** ≥ 1 niveau sur le jungler adverse | exception de l'utilisateur |
| `otherSideAvailSec` | 60 | objectif du côté avantagé disponible (en place ou dans les 60 s) |
| `engageSec` | 90 | fenêtre d'engagement du jungler après T |
| `fromSec` / `untilSec` des tags de prio | 5:00 → 20:00 | après 20:00, ce sont les règles du § 3bis qui jugent (décision 3) |
| `sideJunglerSec` | 30 | relevé du jungler avant T_obj pour « jungler du côté » (décision 8) |
| `resetDesyncSec` | 60 | reset du sidelaner « désynchronisé » s'il tombe dans la minute avant T_obj, wave non crashée |
| `teamContextGravity` | 2 | gravité de `no-prio-before-objective` (sidelane) en équipe |

### 1.3 Responsabilité

Une seule erreur par objectif et par joueur. Si l'objectif est perdu sans prio : le jungler porte `objective-without-prio`
**seulement s'il a engagé** ; le mid porte `no-prio-before-objective` si sa lane était `theirs` ; le support aussi s'il
n'a aidé aucune des deux lanes (et partait sur un bon timing, décision 4) ; le sidelaner du côté si les conditions de la
décision 8 sont réunies. Ces erreurs peuvent coexister (ce sont trois décisions différentes), mais la micro-review
n'en montre qu'une par joueur.

### 1.4 L'objectif « à jouer » : celui du côté le plus avantagé (correction de l'utilisateur, 27/11)

L'utilisateur : l'objectif à jouer est **celui du côté le plus avantagé**. Si la botlane est devant mais que le jungler
choisit les Larves et perd, c'est **sa** faute (il devait jouer du côté gagnant), et l'absence de prio du top n'est
**pas** une erreur du top, plutôt un bon jugement. **Exception** : la règle s'annule si le jungler qui joue cet
objectif est lui-même devant (gros écart de gold et d'XP).

**Avantage d'un côté, `sideEdge(side)`**, lu au **relevé qui précède la fenêtre W** de l'objectif (positions et
compteurs exacts, jamais après la prise) :

| Composante | Côté top | Côté bot | Pourquoi |
|---|---|---|---|
| écart d'or (`totalGold`), plaques comprises | top contre top adverse | (ADC + support) contre le duo adverse | l'or inclut kills, CS et plaques déjà prises |
| écart d'XP | top contre top | (ADC + support) contre le duo | niveaux, puissance au fight |
| adversaire absent | + 1 000 par laner adverse du côté **mort ou en base** pendant W | idem | un côté sans adversaire est jouable tout de suite |
| prio du climax | + 500 si la lane du côté est `ours` (P1-P3), − 500 si `theirs` | idem | la wave décide qui arrive le premier |

`sideEdge = écart d'or + écart d'XP + bonus`, en unités d'or (1 XP ≈ 1 or, même ordre de grandeur que `winZ` sur cette
période ; à vérifier au calibrage). Le mid n'entre pas dans le calcul : sa prio sert aux deux côtés (§ 1.1).

**Le côté « le plus avantagé »** est celui dont `sideEdge` dépasse l'autre de **≥ 1 500** (`sideGap`) **et** vaut au
moins **+ 500** (un côté « moins perdant » n'est pas un côté gagnant). Sous ce seuil, les deux côtés sont jouables et
les règles du § 1.1 s'appliquent seules. Proposé à partir des ordres de grandeur : un kill avec assist ≈ 450 g + XP,
une plaque 120-160 g, un niveau d'écart ≈ 600-900 XP en phase de lane ; 1 500 ≈ un kill + des CS d'avance des deux
côtés de l'écart. À calibrer (§ 6).

**Il faut un objectif de ce côté.** Le côté avantagé n'est « à jouer » que si son objectif est **disponible** : en
place, ou apparaissant moins de 60 s après T_obj de l'objectif choisi. Exemple de l'utilisateur : Dragon en place (ou
à 8:00 sur sa réapparition) et Larves à 8:00, botlane devant → le Dragon est à jouer. Pas d'objectif disponible du côté
avantagé → la règle ne joue pas.

**Exception : jungler lui-même devant** (`junglerEdge`) : notre jungler a, au même relevé, **≥ 1 500 d'or de plus
que le jungler adverse et au moins 1 niveau d'avance** (les deux). Proposé ainsi pour « gros écart de gold et d'XP » :
il gagne le duel de jungle et le fight de fosse sans l'aide d'une lane. La règle de ce paragraphe s'annule alors, et
le § 1.1 s'applique normalement (y compris au sidelaner).

**Nouveau tag : `objective-wrong-side`** (jungler) : « Objectif joué du côté perdant » / « Played the objective on the
losing side ». Toutes ces conditions :
1. notre jungler **engage** un objectif (§ 1.1) du côté X ;
2. l'autre côté Y est **le plus avantagé** (seuils ci-dessus) et son objectif est **disponible** ;
3. **issue négative** : objectif perdu ou volé, ou mort d'un allié au fight de la fosse, ou fight perdu (plus de morts
   alliées qu'ennemies à moins de 3 000 de la fosse) ;
4. pas d'exception `junglerEdge`, pas d'exception § 0.4.

Gravité 1 (2 si l'objectif perdu est un Baron, l'âme ou l'Ancestral). Une prise réussie du côté perdant n'est pas une
erreur (chiffre « risque payé »). **Ordre de lecture** : `objective-wrong-side` passe **avant** `objective-without-prio`
(un seul tag au jungler pour le même objectif ; s'il a joué le mauvais côté, c'est la cause).

**Effet sur le sidelaner sans prio** (`no-prio-before-objective`, § 1.1) : **annulé** pour le sidelaner du côté X
quand `objective-wrong-side` est vrai (le top qui n'a pas pris la prio pour des Larves qu'il ne fallait pas jouer a bien
jugé ; compté dans ses stats comme « bonne lecture »). Il reste possible si l'exception `junglerEdge` joue (le jungler
avait raison de jouer ce côté). Le mid et le support suivent la même logique : leur « pas de prio » est annulé pour un
objectif du côté perdant, et jugé normalement pour l'objectif du côté gagnant.

**Ce que la règle ne voit pas** : le power spike d'un champion (un top qui scale), les sorts d'invocateur adverses en
recharge, les appels de l'équipe. D'où l'issue négative obligatoire et la marge `sideGap`.

---

## 2. Crossmap quand un objectif n'est pas contesté (§ 3)

### 2.1 « Pas contesté »

Un objectif **pris par l'adversaire** à Tk n'est **pas contesté par nous** si :

- aucun de nos champions n'a « participé » au sens du § 0.2 (personne à moins de 3 000 de la fosse au kill, aucun
  `CHAMPION_KILL` impliquant un allié à moins de 3 000 de la fosse dans [Tk − 60 s, Tk + 10 s]) ;
- et aucun allié n'était dans la fosse (900) dans [Tk − 45 s, Tk].

Les wards posées près de la fosse ne suffisent pas à « contester » (décision 5). La règle porte sur les objectifs
**ennemis** ; l'inverse (l'adversaire ne conteste pas notre objectif) n'est pas une erreur de notre joueur (décision 5).

### 2.2 « Crossmap » : ressources prises du côté opposé

Fenêtre **[Tk − 60 s, Tk + 60 s]** (le crossmap commence pendant que l'adversaire fait l'objectif). Côté opposé = moitié
de carte de l'autre fosse (Dragon → top ; Larves / Héraut / Baron → bot). Ressources **prouvées** par la timeline :

| Ressource | Preuve | Attribuée à |
|---|---|---|
| Objectif opposé (Larves, Héraut contre Dragon ; Dragon contre Baron) | `ELITE_MONSTER_KILL` par notre équipe | tueur + participants (§ 0.2) |
| Plaques, tours du côté opposé | `TURRET_PLATE_DESTROYED`, `BUILDING_KILL` | champions alliés à moins de 1 500 |
| Kill du côté opposé (gank, dive) | `CHAMPION_KILL` allié dans la moitié opposée | tueur + assists |
| Invade | jungler : `jungleMinionsKilled` +8 ou plus entre deux relevés **et** position dans la jungle adverse du côté opposé (`zoneOf`, `nearestCamp`) | jungler |
| Avantage numérique créé | nos vivants > les leurs à moins de `ALLY_RADIUS` (2 500) d'un même point du côté opposé, à un relevé | présents |

Verdict par objectif non contesté : **`traded`** (au moins une ressource prouvée), **`no-trade`**, ou
**`no-trade-justified`** (exceptions § 0.4, ou tous les joueurs concernés morts ou en base). La **valeur** de l'échange
(assez ou pas contre un Dragon) est calculée sur l'échelle `winZ` des ledgers, affichée en chiffre, **jamais en
erreur** dans un premier temps.

Le **dive** (« occasion de dive en cas d'avantage numérique ») n'est compté que comme **occasion** : avantage numérique
près d'une tour adverse du côté opposé. Le moteur ne voit ni les PV entre deux relevés ni les sorts : pas d'erreur
« dive raté ».

### 2.3 Qui est concerné

| Rôle | Mesure | Erreur au Labo |
|---|---|---|
| **Jungler** | présent du côté opposé (≥ 50 % des points à 5 s de la fenêtre) ou dans une ressource prouvée | **`no-crossmap-trade`** si `no-trade`, jungler vivant, hors base, ni à l'objectif ni du côté opposé. Le jungler n'est pas visé par la décision du 20/11 |
| **Mid** | prio mid prise **puis** déplacement ou ressource du côté opposé, ou plaques mid | **`no-crossmap-trade`**, en soloQ comme en équipe, dès la phase de lane (décision 1 : la dérogation du 20/11 ne vaut pas pour le mid). Mêmes conditions que le jungler ; les plaques mid prises pendant la fenêtre comptent comme ressource |
| **Support** | idem jungler ; préférence pour un déplacement avec le jungler et/ou le mid | **`no-crossmap-trade`**, en soloQ comme en équipe (décision 1), **seulement si partir était possible sans mettre l'ADC en danger** : botlane `ours` ou `even`, ou ADC en base / mort (sinon la règle du duo prime, décision 4) |
| **Top, ADC** | non concernés en soloQ avant 14:00 (décision du 20/11, maintenue pour eux seuls) ; après 14:00 et en équipe, voir § 3bis | aucune en soloQ avant 14:00 |

« Il n'en faut pas forcément deux sur trois » : le verdict est **par joueur**, pas par groupe. Un seul joueur qui crée
l'avantage suffit à rendre l'objectif `traded` pour l'équipe ; les autres concernés restent jugés individuellement
seulement s'ils n'ont rien fait d'utile (ni crossmap, ni plaques de leur lane avec prio, ni présence à l'objectif).

---

## 3. Duo botlane (§ 4)

### 3.1 Détection

Les absences sont déjà repérées par le ledger des roams (`roamLedger.ts`, phase 2) : support sorti de la bot lane sans
son ADC, ADC sorti sans son support, avec `tOut`, `tBack`, les timers du support (`after-recall`, `wave-crash-probable`…)
et la mort de l'ADC à 2 contre 1 pendant l'absence. Ce rapport ajoute **la couche d'attribution**, sans nouveau repérage.

Pour chaque **mort de l'ADC pendant une absence du support** (et l'inverse) :

| Signal | Lecture |
|---|---|
| attaquants | tueur + assists ennemis ; « 1v2 ou 1v3 » = au moins 2 |
| **dive** | mort à moins de 1 100 d'une tour alliée debout de la bot lane (portée de tour 750 + marge), ou derrière elle côté base |
| **hors de sa tour** | mort au-delà de cette zone, côté adversaire |
| **ADC déjà trop en retard** | au relevé précédent : or ≤ −1 500 contre l'ADC adverse, ou 2 niveaux de moins (décision 6) |
| **reset après crash, ADC resté** | timer du support `after-recall` précédé d'un crash probable (P1 ou P3) dans les 60 s avant le recall du support, **et** l'ADC n'est pas rentré (aucun achat, jamais dans `inBaseBox`) |
| **ADC avancé sans support** | ADC au-delà du milieu de la lane (P4) pendant au moins un relevé, support à plus de 3 000 (absent, mort ou en base), les deux botlaners adverses vivants et hors base |

### 3.2 Attribution (règle de l'utilisateur, dans cet ordre)

| Cas | Faute | Effet |
|---|---|---|
| ADC déjà trop en retard | aucune (« pas grave ») | chiffre seulement ; la mort garde sa lecture normale |
| Support parti après un reset qui suit un crash, ADC resté | **ADC** | `overextended-without-support` sur l'ADC si sa mort est hors tour ; rien au support |
| Support parti, ADC mort **dive** à 2 ou plus | **support** | `left-adc-alone` sur le support ; la carte de mort de l'ADC dit « ton support était parti », sans tag pour l'ADC |
| Support parti **sur un mauvais timing**, ADC **forcé d'avancer** pour ramasser ses sbires, mort hors de sa tour à 2 ou plus (décision 7, critères ci-dessous) | **support** | `left-adc-alone` sur le support ; rien à l'ADC |
| Support parti, ADC mort **hors de sa tour**, autres cas | **partagée**, plutôt l'ADC | `overextended-without-support` sur l'ADC ; chez le support, chiffre « roam partagé » seulement (décision 7) |
| ADC avancé sans support (pas de roam du support : support mort ou en base) et mort | **ADC** | `overextended-without-support` |
| Inverse : ADC parti (roam, back), support mort seul à 2 ou plus en lane | **ADC** si l'ADC est parti sans reset ni crash ; **support** s'il est resté devant seul | même logique, tags miroirs : `left-adc-alone` n'a pas de miroir, le support qui reste devant reçoit `overextended-without-support` (tag commun aux deux rôles : « avancé sans ton duo ») |

**« ADC forcé d'avancer » : critères de la faute du support (décision 7).** Toutes ces conditions :

1. **mauvais timing** du roam : timer du support `bad` ou `none` (ni `after-kills`, ni `after-recall`, ni `adc-away`,
   ni `enemy-duo-recall`, ni crash probable) au moment du départ `tOut` ;
2. **wave pas crashée** au départ : `laneStateAt(BOT)` à `tOut` n'est ni `ours` prouvé (P1-P2) ni probable (P3). La
   wave revient donc vers l'ADC ou reste au milieu, et il doit avancer pour la farm ;
3. **mort « en farmant »** : l'ADC meurt dans la bot lane (`laneOf` = BOT), entre sa tour et le milieu de la lane
   (+ 1 000 de marge), pas plus loin. Au-delà (sous la tour adverse, dans la jungle ou la rivière adverses), il était
   allé plus loin que la farm ne l'exige : faute de l'ADC ;
4. au moins 2 attaquants, et l'ADC **pas déjà en retard** (moins de 1 500 d'or ou de 2 niveaux de retard, décision 6) ;
5. l'ADC n'a pas fait de kill ni pris de plaque juste avant sa mort (−15 s) : sinon c'est un all-in qu'il a choisi.

Si 1 à 4 sont réunis mais pas 5 : faute partagée (ligne suivante du tableau).

**Fenêtre et poids (décision 10)** : la règle du duo vaut **toute la partie**. Avant 14:00, l'absence se mesure par
rapport à la bot lane (ledger des roams, comme aujourd'hui) ; après 14:00, par rapport à **la position de l'ADC** (le
support est « absent » s'il est à plus de 3 000 de son ADC pendant au moins un relevé, ADC dans une lane), puisque le
duo ne joue plus forcément bot. Poids : gravité **2 avant 14:00, 1 après** pour `left-adc-alone` et
`overextended-without-support` ; dans les chiffres de session, les cas d'après 14:00 sont comptés à part. Les cas
douteux de la calibration des roams (regroupements de 12:00-15:00, `2026-11-26-calibrage-roams-roles.md`) restent à
vérifier en vidéo (§ 6) : un **regroupement** (support et ADC chacun à moins de 2 500 d'au moins deux alliés) n'est
jamais une absence.

---

## 3bis. Après 20:00 : règles de late game (décision 3)

L'utilisateur : les laners sont encore en lane mais l'organisation change ; quêtes finies, objectifs plus lourds,
botlane au mid, top et bot selon leur rôle, le TP et les timers d'objectif (split pusher du côté opposé, tank qui
ramasse les waves et revient). Trois règles, évaluées **autour de chaque objectif après 20:00** (Baron, Dragon,
Ancestral), sur la fenêtre [T_obj − 90 s, prise ou fight + 15 s]. Elles ne s'appliquent que si l'objectif **est joué
par notre équipe** (au moins 2 alliés à moins de 2 800 de la fosse, ou participation § 0.2) ou **pris par
l'adversaire**.

**Qui est split pusher, qui est tank.** La timeline ne donne pas de classe : on ajoute un ensemble `TANKS` dans
`championClasses.ts` (comme `CONTROL_MAGES`), tenu par patch, avec repli sur les tags Data Dragon (« Tank ») si l'app
les a déjà. Split pusher = le top (ou le joueur le plus souvent seul dans une sidelane entre 20:00 et T_obj) qui n'est
**pas** un tank. Un top tank suit la règle du tank.

| Règle | Rôle | Détection | Erreur (tag) |
|---|---|---|---|
| **Botlane au mid** | ADC, support | à T_obj − 60 s et au relevé suivant : ADC (ou support) seul dans une sidelane, aucun allié à moins de 2 500 ; ou mort dans une sidelane, seul, dans les 90 s avant T_obj | `late-botlane-alone-sidelane` : « Seul en sidelane avant l'objectif » / « Alone in a side lane before the objective ». Pas d'erreur s'il ramasse une wave **du côté de l'objectif** et rejoint à temps (présent au fight ou à la prise) |
| **Split pusher du côté opposé** | split pusher | pendant la fenêtre : dans la sidelane **opposée** à la fosse, avec une ressource (plaque, tour, inhibiteur, kill) ou un ennemi retenu (un adversaire au moins à moins de 2 500 de lui), **ou** présent à l'objectif (participation § 0.2, TP compris : arrivée plus rapide que 345 u/s, même lecture que le TP probable du top dans `roamLedger.ts`) | `late-split-no-pressure` : « Split sans pression pendant l'objectif » / « Split push with no pressure during the objective » : ni à l'objectif, ni ressource / adversaire retenu du côté opposé, vivant et hors base. Gravité 2 si l'objectif est perdu |
| **Tank qui revient** | tank (souvent top, parfois support) | farme une sidelane avant l'objectif, puis **présent** au fight ou à la prise (participation § 0.2, TP compris) | `late-missed-rejoin` : « Pas revenu pour l'objectif » / « Did not rejoin for the objective » : tank vivant, hors base, dans une sidelane à T_obj, absent du fight et de la prise. Pas d'erreur s'il était dans la sidelane opposée avec une ressource (il a joué le split : lu par la règle précédente) |

**Ce qui change d'autre après 20:00** :
- prio : `no-prio-before-objective` n'est plus émis par rôle de lane ; le mid garde la règle de prio (mid avancé avant
  l'objectif), les sidelanes sont jugées par les trois règles ci-dessus ;
- crossmap : `no-crossmap-trade` reste pour jungler, mid et support ; le split pusher du côté opposé compte comme
  ressource pour l'équipe ;
- gravité **+ 1** (au plus 3) pour les tags de prio et de crossmap sur un Baron, l'âme ou l'Ancestral (objectifs plus
  lourds) ;
- quêtes finies : le coût d'une wave perdue ne compte plus le retard de quête (`roleQuest.ts` le sait déjà).

**Ce que ces règles ne voient pas** : les appels de l'équipe (qui split, qui group), un TP en recharge, la vision sur
la sidelane. D'où : une seule erreur par joueur et par objectif, texte au conditionnel quand le TP est seulement
probable, et activation après relecture vidéo (§ 6).

## 3ter. Jouer autour de la win condition (concept du moteur, décision du 27/11)

L'utilisateur : en soloQ, la win condition est **le joueur le plus fed** (gold / XP) de l'équipe, quel que soit son
rôle, y compris lui-même ; il est alors le **leader de la game**, ses décisions pèsent lourd et **ses erreurs comptent
double**. En équipe, la win condition dépend de la **draft**. Après la phase de lane, on juge si les plays se font
autour d'elle : mourir seul loin du coéquipier le plus fed = int ; participer aux fights où il se bat = bien jouer la
win condition.

Ce n'est pas un tag de plus : c'est **un état de la partie**, calculé une fois (`winConditionTimeline`, dans
`ledgerCore.ts`), que lisent les règles des § 1 à 3bis, le Labo, les stats et l'assistant.

### 3ter.1 Qui est la win condition (soloQ)

**`fedScore(p, t)`** à chaque relevé de minute, pour chaque joueur de notre équipe :

- **écart contre son vis-à-vis** : (or + XP) du joueur − (or + XP) de l'adversaire du même rôle ;
- **écart à son équipe** : (or + XP) du joueur − moyenne (or + XP) des 4 autres.

`fedScore = 0,5 × écart vis-à-vis + 0,5 × écart équipe`. Les deux termes ensemble évitent deux pièges : un support
+ 1 500 sur le support adverse reste loin derrière un ADC fed en or brut ; un ADC riche « par rôle » mais à égalité
avec son vis-à-vis n'est pas fed. Un support peut quand même être la win condition s'il domine les deux termes (Q-W1).

| Notion | Seuil proposé | Raison |
|---|---|---|
| **Win condition claire** | `fedScore` ≥ **2 000** (le « ≥ 1 000 au-dessus du 2e » est retiré par W4 : plusieurs win conditions possibles, § 3ter.6) | ≈ 2 kills et un niveau d'avance ; sous ce seuil, personne ne porte la partie |
| **Stabilité** | la même personne en tête sur **3 relevés de suite** (3 min) | un kill isolé ne fait pas une win condition |
| **Changement en cours de partie** | un autre joueur la dépasse de ≥ 1 000 pendant 3 relevés de suite (hystérésis) ; elle **se perd** si son `fedScore` passe sous 1 000 pendant 3 relevés | la win condition peut basculer (shutdown, scaling) ; chaque partie garde sa frise « qui, de quand à quand » |
| **Début du calcul** | **10:00** (écarts significatifs) ; l'effet « jouer autour » ne commence qu'à **14:00** (§ 3ter.3) | le statut de leader peut exister avant 14:00 (top qui roule sa lane) |
| **Pas de win condition** | aucun joueur au-dessus du seuil | **aucun** jugement « autour de la win condition » ; c'est le cas sûr |
| Garbage time | `winProbability` < 0,18 ou > 0,85 | même exclusion que la micro-review |

### 3ter.2 Le joueur est la win condition : « leader de la game », erreurs ×2

Quand **le joueur analysé** est la win condition (statut actif à l'heure de l'erreur) :

| Où | Effet de « compte double » |
|---|---|
| **Labo d'erreurs** | nouveau champ `weight` (1 ou 2) sur l'erreur, **distinct de la gravité** (qui reste 1-3 et décrit l'erreur, pas le joueur). Les comptages, le coût en winrate et le classement « erreurs principales » utilisent le poids ; l'erreur porte un badge « leader de la game » et le compte brut reste visible à côté |
| **Stats de session** | « erreurs pondérées » à côté du nombre d'erreurs ; ligne « parties où tu étais le leader : n, erreurs en leader : n (×2) ». Il n'existe aujourd'hui aucun score de session unique : si un score est ajouté, il lit le poids |
| **Assistant** | `features.ts` : indicateurs `leaderGames`, `leaderMistakes` (pondérés) ; dans `diagnosis.ts`, une erreur de leader compte double dans l'évidence (noisy-OR) ; règle possible `leader_throws` (« quand tu es devant, tu meurs seul ») seulement si la distribution la justifie, comme les autres règles |
| **Micro-review** | `pickMoments` met en tête une mort critique du leader ; le résumé dit « tu étais la win condition de ton équipe » |
| **Pas d'effet** | sur les erreurs manuelles du joueur (il les a choisies), sur les tags qui ne visent que les non-leaders (§ 3ter.3) |

### 3ter.3 Après la phase de lane : jouer autour de la win condition

Fenêtre : **de 14:00 à la fin**, hors garbage time, seulement pendant qu'une win condition claire existe et que **le
joueur analysé n'est pas elle**.

**« Loin de »** : à l'heure de la mort (position exacte du `CHAMPION_KILL`) et pour la win condition (position
interpolée, `posAt`) : distance > **5 000** (≈ 15 s de marche à 345, trop loin pour se rejoindre avant la fin d'un
pick). **« Seul »** : aucun allié vivant à moins de `ALLY_RADIUS` (2 500).

**Fight** : groupe de `CHAMPION_KILL` à moins de 3 000 les uns des autres, séparés de moins de 20 s (comme les fights
de fosse, `fightGapSec`). La win condition **est dans le fight** si elle est tueuse, victime, assist ou à moins de 3 000.
Le joueur y **participe** s'il est tueur, victime, assist ou à moins de 3 000 (même définition que la participation
§ 0.2).

| Chiffre (stats de session) | Calcul |
|---|---|
| **Fights avec la win condition** | fights de la win condition où tu étais / fights de la win condition où tu étais vivant et hors base au début |
| **Morts seules loin de la win condition** | nombre, avec heure et lieu en mots |
| **Win condition** | frise : qui (rôle, champion, « toi »), de quand à quand ; nombre de parties où tu étais le leader |

| Tag | Catégorie | FR / EN | Conditions | Gravité |
|---|---|---|---|---|
| `died-far-from-wincon` | macro | « Mort seul loin de ta win condition » / « Died alone far from your win condition » | après 14:00, win condition claire (pas toi), mort **seul**, à > 5 000 d'elle, elle vivante ; pas pendant un trade prouvé (ressource prise par toi dans les 30 s avant, comme le split du § 3bis) | 2 (c'est l'« int » de l'utilisateur), 3 si shutdown donné ou objectif perdu dans les 60 s |
| `missed-wincon-fight` | macro | « Absent du fight de ta win condition » / « Missed your win condition's fight » | après 14:00, fight où la win condition est, toi vivant, hors base, à < 8 000 au début (assez près pour arriver), **absent**, et fight perdu (plus de morts alliées) ou win condition tuée | 1 ; **chiffres seulement** à la livraison, tag après relecture vidéo (risque : TP, appel d'équipe, wave à prendre) |

Codex :
- `codex_play_around_wincon` (any / mid) : « Après 14:00, ton équipe joue autour du plus fed : sois dans ses fights,
  ne meurs pas seul de l'autre côté de la carte » ; drill : ≥ 70 % des fights de la win condition rejoints, 0 mort
  seule loin d'elle sur 5 parties ;
- `codex_leader_of_the_game` (any / mid) : « Tu es la win condition : chaque mort coûte double, joue avec ton équipe
  et la vision, pas de facecheck seul » ; drill : moins d'une mort seule par partie quand tu es le leader.

### 3ter.4 En équipe : la win condition vient de la draft

> **Remplacé par W3 (§ 3ter.6)** : le coach ou le responsable de session choisit après la game ; repli = le plus fed.

Proposé, dans cet ordre :
1. **Plan du coach** (source qui prime) : un champ **structuré** dans la session d'équipe ou le journal de draft :
   « win condition : joueur ou rôle » + « type » (teamfight 5v5, split top, botlane early, pick, protect the carry,
   early dragons). Aujourd'hui, le dossier adverse de l'analyste a un `game_plan` en **texte libre** (≤ 600
   caractères) : le moteur ne peut pas le lire de façon fiable, d'où un champ structuré à ajouter (Back-end +
   maquette, hors de ce rapport).
2. **Repli automatique sur la draft** : archétype de la composition (listes de champions par classe, comme
   `CONTROL_MAGES` : hypercarries, split pushers, engage) ; la win condition par défaut est le carry qui scale le plus.
   Fiabilité faible : affiché « probable », pas de tag.
3. **Repli dynamique** : la règle soloQ (le plus fed), si ni plan ni draft lisible.

En équipe, « jouer autour » suit le **type** : en « split top », le reste de l'équipe joue le côté opposé (crossmap) et
le split n'est jamais « mort loin de la win condition » ; en « protect the carry », la distance au carry compte comme en
soloQ. Les tags et le ×2 s'appliquent de la même façon (Q-W3 à Q-W5).

### 3ter.5 Interactions, sans double compte

| Avec | Règle |
|---|---|
| **Côté le plus avantagé (§ 1.4)** | avant 14:00, `sideEdge` décide seul. **Dès 14:00, s'il y a une win condition claire**, l'objectif « à jouer » est celui **du côté où elle est** (sa lane ou sa position au relevé précédant W) ; `objective-wrong-side` lit ce côté. Sans win condition claire, `sideEdge` reste |
| **`objective-wrong-side`** | inchangé avant 14:00 ; après 14:00, « mauvais côté » = côté opposé à la win condition. Le jungler qui est lui-même la win condition est l'exception `junglerEdge` (déjà prévue) |
| **Crossmap (§ 2)** | un crossmap fait **avec** la win condition, ou du côté où elle est, compte `traded` ; un objectif ennemi lâché parce que l'équipe joue autour de la win condition de l'autre côté n'est pas `no-crossmap-trade` si une ressource y est prise |
| **Duo bot (§ 3)** | si l'ADC est la win condition, `left-adc-alone` prend + 1 de gravité (au plus 3) ; c'est le **même** tag, pas un de plus. Une mort de l'ADC ou du support lue par la règle du duo n'est **jamais** aussi `died-far-from-wincon` |
| **Late game (§ 3bis)** | `late-botlane-alone-sidelane`, `late-split-no-pressure`, `late-missed-rejoin` sont plus précis : ils passent **avant** `died-far-from-wincon` et `missed-wincon-fight`. Si la win condition est le split pusher, `late-split-no-pressure` ne s'applique pas à lui (l'équipe joue autour de lui) |
| **Carte de mort critique** | une mort = une lecture : ordre duo → late game → `died-far-from-wincon` → lectures de mort existantes. La carte cite la win condition (« Jinx, 3 000 d'or d'avance, était bot ») |
| **×2 du leader** | c'est un **poids** sur les erreurs déjà créées par les autres règles, jamais une erreur en plus |

Livraison : `DETECTOR_SPEC.winCondition.enabled` à `false` au départ ; la frise de la win condition et les chiffres
sont calculés et stockés d'abord. `ANALYSIS_VERSION` + 1 avec le reste. Effort en plus : Back ≈ 1,5 j (frise, poids,
2 tags, assistant), Front ≈ 0,5 j (badge leader, chiffres, frise), plus le champ structuré d'équipe si validé (Q-W3).

Validation en plus (§ 6) : 10 parties où l'utilisateur dit qui était la win condition (accord ≥ 80 % avec la frise),
20 `died-far-from-wincon` (≤ 3 faux positifs), 20 `missed-wincon-fight` (≤ 3 faux positifs avant d'activer le tag).

### 3ter.6 Réponses de l'utilisateur (Q-W1 à Q-W5, 27/11) : version finale

Ce paragraphe **prime** sur les § 3ter.1 à 3ter.5 quand ils diffèrent.

**W1. Formule et seuils validés ; support win condition s'il fait des dégâts.** Un joueur au rôle `UTILITY` n'est
éligible que s'il est un **support à dégâts**, à l'heure du relevé :
- son champion est dans une liste `DAMAGE_SUPPORTS` de `championClasses.ts` (mages et carries joués support : Zyra,
  Lux, Zoe, Vel'Koz, Brand, Xerath, Swain, Hwei, Senna, Seraphine, Karma…, tenue par patch comme `CONTROL_MAGES`)
  **et** sa part des dégâts aux champions de l'équipe, cumulée depuis le début, est **≥ 18 %** ;
- **ou**, quel que soit son champion, cette part est **≥ 25 %** (un enchanteur qui fait vraiment les dégâts).

La part des dégâts se lit à chaque relevé de minute dans la timeline (`damageStats.totalDamageDoneToChampions` de
chaque joueur) : mesurable, sans requête de plus. Les autres rôles n'ont pas ce critère.

**W2. ×2 seulement pendant que le joueur est la win condition, sur les erreurs détectées, et l'app le dit.** Ce que
le Back-end écrit sur chaque **occurrence** d'erreur (pas sur le tag) et ce que le Front affiche :

| Champ (occurrence d'erreur) | Contenu | Affiché |
|---|---|---|
| `weight` | 1 ou 2 | « ×2 » à côté de l'erreur (Labo, Review, micro-review, notes) |
| `weightReason.kind` | `'leader'` (seule raison pour l'instant ; le champ permet d'en ajouter) | clé i18n `mistakes.weight.leader` |
| `weightReason.since` / `until` | début et fin (ou `null`) de la période où le joueur était win condition, en secondes de partie | « depuis 18:00 » / « de 18:00 à 27:00 » |
| `weightReason.fedScore` | score au relevé précédant l'erreur | « + 3 100 or/XP » |
| `weightReason.goldGap`, `xpGap` | écart contre le vis-à-vis à ce relevé | dans l'info-bulle |
| `weightReason.coWinCons` | autres win conditions simultanées (W4), ids | « avec Jinx » |

Texte FR / EN proposé : « ×2 — tu étais le leader de la game (+ 3 100 or/XP depuis 18:00) » / « ×2 — you were the
game leader (+3,100 gold/XP since 18:00) ». Stats de session : « Erreurs : 12 (14 pondérées) » avec une ligne
dépliable « 2 erreurs comptées double : tu étais le leader de la game » qui liste chaque erreur ×2 avec son heure et sa
raison. La frise de la win condition (qui, depuis quand, avec quel écart) est montrée dans la Review de la partie, pour
que le ×2 soit vérifiable. **Persistance** : `weight` et `weightReason` vont dans la ligne d'erreur stockée ; si la
table des erreurs est synchronisée avec Supabase, c'est une migration (colonnes ou JSON) → revue Cyber. Une erreur
déjà en cache reçoit son poids au recalcul (`ANALYSIS_VERSION` + 1).

**W3. En équipe : choix après la game par le responsable de session ou le coach.** Remplace le champ structuré
« avant la game » du § 3ter.4 :
- après une partie de session d'équipe, le responsable de session ou le coach **choisit dans la liste des 5 joueurs**
  qui a été la ou les win conditions (W4), avec, en option, « à partir de » une minute (bascule) ;
- stockage : une entrée par partie de session d'équipe (`team_session_games`, colonne ou table liée,
  `[{ participantId, fromSec?, untilSec? }]`, écriture réservée au responsable et au coach : RLS) → migration et revue
  Cyber ;
- **les calculs se font ensuite** : le choix déclenche le recalcul des règles de win condition de cette partie (fonction
  pure sur la timeline en cache, ~ms ; les ×2, `died-far-from-wincon`, `missed-wincon-fight`, côté à jouer et chiffres
  de l'équipe sont recalculés ; rien n'est demandé à Riot) ;
- **tant que personne n'a choisi** : repli sur la règle soloQ (le plus fed), affiché « win condition automatique — à
  confirmer par le coach ». Chiffres et tags sont calculés avec ce repli et marqués « auto » ; ils sont remplacés au
  choix. Le repli par archétype de draft (§ 3ter.4, point 2) est **abandonné** (moins fiable que le plus fed et que le
  choix du coach).

**W4. Bascule et plusieurs win conditions simultanées.**
- SoloQ : est win condition **tout joueur** avec `fedScore` ≥ 2 000 stable 3 relevés (support : critère W1) ; la
  condition « ≥ 1 000 au-dessus du 2e » disparaît. Au plus 3 à la fois (au-delà, l'équipe entière est devant : le
  concept ne départage plus rien, aucun jugement). Bascule : chacun entre et sort de la liste avec l'hystérésis du
  § 3ter.1.
- **« Loin de la win condition »** = à plus de 5 000 de **toutes** les win conditions vivantes (mourir près de l'une
  d'elles n'est pas « loin »).
- **« Fight de la win condition »** = un fight où **au moins une** d'elles est ; `missed-wincon-fight` vaut pour
  n'importe lequel.
- **×2 du leader** : si le joueur est l'une d'elles ; `coWinCons` cite les autres.
- **Côté à jouer** (§ 3ter.5) : si elles sont du même côté, ce côté ; si elles sont de côtés opposés, `sideEdge`
  (§ 1.4) départage.

**W5. Win condition adverse, dès maintenant.** Même calcul (`fedScore`, seuils, support à dégâts, plusieurs possibles)
pour l'équipe adverse : `enemyWinConditionTimeline`. Ce que les données permettent de mesurer, et ce qu'elles ne
permettent pas :

| Mesure | Donnée | Mesurable ? |
|---|---|---|
| Dégâts infligés à lui par chacun de nous | `victimDamageReceived` de **ses morts** seulement ; match-v5 n'a pas de dégâts par cible | **seulement quand il meurt** |
| Focus en teamfight : est-il tué, et tôt ? | ordre des `CHAMPION_KILL` dans le fight (§ 3ter.3) | **oui** |
| Kills et assists sur lui | `CHAMPION_KILL` (victime = lui) | **oui**, par joueur |
| Morts qu'il nous cause | tueur = lui, ou ≥ 40 % des dégâts reçus dans `victimDamageReceived` de nos morts | **oui** |
| Ganks sur sa lane | `gankLedger` : lane visée par notre jungler, avant 14:00 | **oui** |
| Shutdown pris sur lui | `bounty` / `shutdownBounty` du kill (présent à 100 % dans le cache, vérif. du 26/11) | **oui** |
| Jeu à l'opposé de lui | objectifs et ressources pris par nous du côté opposé pendant qu'il est dans une sidelane | **oui** (positions) |
| Peel, dégâts sur lui sans kill, CC posés | — | **non** |

Chiffres (stats de session, et collectifs en équipe) :
- **Focus** : fights où la win condition adverse était / où elle est morte / où elle est morte **en 1re ou 2e** de son
  équipe ;
- **Pression** : kills sur elle (et ta part : kills + assists), shutdowns pris sur elle, ganks de notre jungler sur sa
  lane avant 14:00 (part des ganks) ;
- **Danger** : nos morts causées par elle (et les tiennes) ;
- **Jeu à l'opposé** : ressources prises du côté opposé pendant qu'elle split.

Un seul tag, les autres restent des chiffres (le moteur ne voit ni les dégâts sans kill ni les CC) :

| Tag | Catégorie | FR / EN | Conditions | Gravité |
|---|---|---|---|---|
| `died-alone-to-enemy-wincon` | macro | « Mort seul face à la win condition adverse » / « Died alone to the enemy win condition » | après 14:00, win condition adverse claire, **tueur = elle**, toi **seul** (aucun allié à 2 500), pas pendant un trade prouvé | 2 ; 3 si ta mort lui donne un objectif dans les 60 s |

Ordre de lecture d'une mort (une mort, une lecture) : duo → late game → **`died-alone-to-enemy-wincon`** →
`died-far-from-wincon` → lectures existantes. Codex : `codex_respect_enemy_wincon` (any / mid) : « Le plus fed d'en
face : ne le croise jamais seul, focus-le en teamfight, joue à l'opposé quand il split » ; drill : 0 mort seule face à
lui sur 5 parties. Sans win condition adverse claire, rien n'est mesuré.

**Validation en plus** (§ 6) : 10 parties d'équipe où le coach choisit la win condition (accord avec le repli
automatique, pour savoir si le repli est bon) ; 10 supports à dégâts (le critère W1 désigne-t-il les bons) ; 20
`died-alone-to-enemy-wincon` (≤ 3 faux positifs) ; 10 fights relus pour le « focus » (ordre des kills juste).

**Effort final de tout le rapport** (§ 1 à 3ter) :

| Session | Contenu | Effort |
|---|---|---|
| Back-end | prio (climax, `laneStateAt`), côté avantagé, crossmap, duo, late game, win condition (alliée multiple, adverse, support à dégâts, poids ×2 et sa raison), choix post-game en équipe (stockage + recalcul + IPC), 12 tags, fiches Codex, assistant, scripts de calibrage, tests | **≈ 8,5 j** |
| Front-end | lignes de stats (prio, crossmap, duo, late game, win conditions alliée et adverse), libellés des objectifs, badge et explication « ×2 », frise de la win condition, choix du coach après la game, i18n fr + en | **≈ 3 j** |
| Graphic Design | maquette Penpot : blocs de stats, badge ×2, frise, sélecteur du coach | **≈ 1 j** |
| Cyber | migrations (poids des erreurs si synchronisé, choix de la win condition + RLS) | **≈ 0,5 j** |
| Calibrage + relecture vidéo | scripts sur le cache, ~180 extraits relus par l'utilisateur (≈ 4 h, en plusieurs fois) | **≈ 2,5 j** |
| **Total** | | **≈ 15,5 j**, livrable en 3 releases : (a) prio + crossmap + duo en chiffres ; (b) late game + win condition alliée/adverse en chiffres + ×2 ; (c) activation des tags validés et choix du coach |

---

## 4. Ce que le moteur produit

### 4.1 Stats de session (par joueur)

Bloc « Objectifs » de la page Historique (capture du 27/11 : « Participation aux objectifs ») : trois lignes en plus,
calculées par objectif, puis sommées sur la session comme `sumObjectives`.

| Ligne | Chiffre | Pour |
|---|---|---|
| **Prio avant l'objectif** | objectifs de ton côté avec ta lane en prio / total (prouvée + probable, la part « probable » en gris) ; mid : objectifs avec prio mid ; jungler : objectifs engagés avec prio / engagés ; support : objectifs où tu as aidé une lane du côté ou le mid / total | tous |
| **Objectifs non contestés** | lâchés sans contester / avec crossmap (`traded`) / sans rien ; détail des ressources (kills, plaques, camps, objectif opposé) | jungler, mid, support (chiffre visible pour tous) |
| **Duo botlane** | roams du support, morts de l'ADC pendant ces roams, par faute (support / ADC / partagée / aucune), **avant et après 14:00 séparés** ; avances de l'ADC sans support et morts | ADC, support |
| **Late game (après 20:00)** | objectifs où tu étais au bon endroit : au mid ou à l'objectif (botlane), split avec pression ou à l'objectif (split pusher), revenu à temps (tank) / objectifs joués après 20:00 | tous |

Le chiffre « prio de ta lane avant les objectifs de ton côté » est mis en avant pour le top et l'ADC (décision 8), et
séparé soloQ / équipe dans les sessions d'équipe.

Chaque objectif de la liste « Toute la session » (cliquable, décision du 27/11) reçoit deux libellés en plus :
« prio : nous / eux / ? » et, pour un objectif ennemi, « non contesté : crossmap ✓ / ✗ ».

### 4.2 Stats collectives (sessions d'équipe)

Même calcul pour les 5 joueurs, à côté du « contrôle des objectifs » décidé le 27/11 : % d'objectifs avec prio par type,
objectifs engagés sans prio (et leur issue), objectifs lâchés avec / sans crossmap, fautes du duo par duo. Calculé sur
les timelines déjà chargées (`teamTimelineCore.ts`), zéro requête Riot de plus.

### 4.3 Tags du Labo (nouveaux, catégorie du catalogue entre parenthèses)

| Slug | Catégorie | FR | EN | Rôle | Phase |
|---|---|---|---|---|---|
| `objective-without-prio` | macro | Objectif engagé sans prio | Objective started without prio | JUNGLE | early, mid |
| `objective-wrong-side` | macro | Objectif joué du côté perdant | Played the objective on the losing side | JUNGLE | early, mid |
| `no-prio-before-objective` | macro | Pas de prio avant l'objectif | No lane prio before the objective | MIDDLE, UTILITY, TOP, BOTTOM (sidelane du côté, décision 8) | early, mid |
| `no-crossmap-trade` | macro | Objectif lâché sans crossmap | Objective given up with no cross-map trade | JUNGLE, MIDDLE, UTILITY (décision 1) | early, mid, late |
| `left-adc-alone` | macro | ADC laissé seul (dive à 2+) | Left your ADC alone (dove 2v1) | UTILITY | early, mid, late |
| `overextended-without-support` | macro | Avancé sans ton duo | Pushed up without your duo | BOTTOM, UTILITY | early, mid, late |
| `late-botlane-alone-sidelane` | macro | Seul en sidelane avant l'objectif | Alone in a side lane before the objective | BOTTOM, UTILITY | late |
| `late-split-no-pressure` | macro | Split sans pression pendant l'objectif | Split push with no pressure during the objective | split pusher (TOP surtout) | late |
| `late-missed-rejoin` | macro | Pas revenu pour l'objectif | Did not rejoin for the objective | tank (TOP surtout) | late |
| `died-far-from-wincon` | macro | Mort seul loin de ta win condition | Died alone far from your win condition | tous (sauf la win condition) | mid, late |
| `missed-wincon-fight` | macro | Absent du fight de ta win condition | Missed your win condition's fight | tous (sauf la win condition) | mid, late |
| `died-alone-to-enemy-wincon` | macro | Mort seul face à la win condition adverse | Died alone to the enemy win condition | tous | mid, late |

12 tags (dont `died-far-from-wincon`, `missed-wincon-fight` et `died-alone-to-enemy-wincon`, § 3ter ; la vision avant objectif existe déjà : `no-ward-pre-obj`). Gravité : 1 par défaut ; + 1 (au plus 3) si
l'objectif était un Baron, l'âme ou l'Ancestral ; `no-prio-before-objective` d'un sidelaner : 2 en équipe ; tags du duo :
2 avant 14:00, 1 après, + 1 si l'ADC donne un shutdown. Phase `late` du Codex pour les trois tags de late game. Chaque
erreur porte une `note` factuelle (heure, objectif nommé, lane, signal qui prouve : « plaque mid prise par eux à 4:22 »,
« Viktor en base de 4:30 à 5:00 »), jamais de distance chiffrée (décision du 20/11).

### 4.4 Codex

| Fiche | Tag | Rôle / phase | Contenu |
|---|---|---|---|
| `codex_mid_priority_shove_before_objectives` (**existe**) | ajouter `no-prio-before-objective` | MIDDLE / mid | « shove avant le spawn » ; ajouter la nuance de l'utilisateur (pas obligatoire en infériorité ou jungler à l'opposé, mais bonne habitude) |
| nouvelle `codex_jgl_prio_before_objective` | `objective-without-prio` | JUNGLE / early | « Prio d'abord, objectif ensuite : au moins le mid, idéalement la sidelane du côté » ; drill : sur 5 parties, ≥ 70 % des objectifs engagés avec prio |
| nouvelle `codex_jgl_play_winning_side` | `objective-wrong-side` | JUNGLE / early | « Joue l'objectif du côté qui gagne : lis l'or et l'XP de tes sidelanes avant de choisir Larves ou Dragon ; seul un gros avantage de jungle permet de jouer le côté perdant » ; drill : sur 5 parties, aucun objectif engagé du côté perdant sans avance de jungle |
| nouvelle `codex_sup_objective_setup_prio_vision` | `no-prio-before-objective` (+ `no-ward-pre-obj`) | UTILITY / early | « À T−60 : aider la lane du côté ou le mid à push, puis ward » ; drill : setup sur ≥ 60 % des objectifs |
| `codex_jgl_3camps_mid_cross_bot_invade` (**existe**, voisine) ; nouvelle `codex_jgl_crossmap_uncontested` | `no-crossmap-trade` | JUNGLE / early | « Objectif lâché = ressources de l'autre côté : invade, gank, dive si numbers advantage » ; drill : ≥ 1 ressource sur ≥ 70 % des objectifs lâchés |
| nouvelle `codex_sup_roam_timer_duo` | `left-adc-alone` | UTILITY / early | « Roam sur un timer : crash + reset, ADC rentré ou en sécurité » |
| `codex_adc_roam_leave_support_alone_in_lane` (**existe**) + nouvelle `codex_adc_no_support_no_push` | `overextended-without-support` | BOTTOM / early | « Pas de support, pas d'avance : wave sous ta tour, farm safe » |
| nouvelle `codex_side_wave_reset_sync_objective` | `no-prio-before-objective` | TOP, BOTTOM / early | « Ton jungler vient de ton côté : crash ta wave puis reset, pour être là avec la prio au spawn » ; drill : prio de ta lane sur ≥ 60 % des objectifs de ton côté |
| nouvelle `codex_late_botlane_group_mid` | `late-botlane-alone-sidelane` | BOTTOM / late | « Après 20:00, ADC au mid : ne farme une sidelane que du côté de l'objectif et rejoins avant le spawn » |
| nouvelle `codex_late_split_opposite_side` | `late-split-no-pressure` | TOP / late | « Split du côté opposé avec un timer : prends une ressource ou retiens un ennemi, sinon TP sur l'objectif » |
| nouvelle `codex_late_tank_clear_and_rejoin` | `late-missed-rejoin` | TOP, UTILITY / late | « Tank : ramasse la wave, puis sois au fight 30 s avant le spawn » |

Textes fr + en, jargon LoL en anglais (prio, wave, shove, crash, reset, invade, gank, dive, crossmap, roam), aucun nom
de source. Fiches écrites par le Back-end, relues par le Front-end.

### 4.5 Branchement sur les ledgers sans double compte (`PLAN_MOTEUR_BILANS.md`)

Principe « un événement, une lecture » (ENGINE_NOTES § 3) :

1. **`laneStateAt` devient une brique de `ledgerCore.ts`.** Le ledger des roams l'utilise comme **timer** : un roam du
   mid ou du support qui part après une prio `ours` est un bon timer (comme `wave-crash-probable` aujourd'hui, qui en est
   un cas particulier : le remplacer par `laneStateAt` pour n'avoir qu'un calcul).
2. **Crossmap = contexte, pas un deuxième verdict.** Un gank ou un roam du côté opposé pendant un objectif non contesté
   reste jugé par `gankLedger` / `roamLedger` (coût / gain) ; le verdict crossmap ajoute seulement le contexte
   « objectif lâché » et compte l'objectif `traded`. Il ne crée pas de deuxième carte.
3. **`absent-objective` et `tempo-hesitation`** calculent aujourd'hui leur propre « aucun cross-map de l'équipe »
   (−40 s / +15 s) : les faire lire le verdict § 2.2. Si le joueur concerné a fait un crossmap, aucune carte ; s'il n'a
   rien fait, **une seule** carte, `no-crossmap-trade` pour le jungler, le mid ou le support (qui remplace « absent » dans ce
   cas, décision 1), « absent » ou « hésitation » pour le top et l'ADC selon les règles actuelles (20/11 inchangé pour
   eux).
4. **Duo** : l'attribution décore le verdict de `support-roam-unpaid` / `adc-roam-unpaid` (champ `fault`). La carte du
   ledger reste la seule carte ; le tag du Labo n'est émis que par la règle du duo. La carte de mort critique de l'ADC
   lit `fault` pour son texte et ne tague pas l'ADC quand la faute est au support.
5. **M6 `no-ward-pre-obj`** garde la vision ; `no-prio-before-objective` ne parle jamais de wards.
6. **Ordre des schémas** : sur un objectif perdu, `objective-without-prio` (jungler) passe avant `absent-objective` et
   après les morts critiques ; sur une mort de l'ADC, la lecture duo passe avant `bad-positioning` générique.

**Mise en œuvre** (rappel pour le Chief, pas une délégation) : Back-end = `ledgerCore.ts` (`laneStateAt`,
`canPlayObjective`), un nouveau `objectiveRules.ts` (prio, crossmap, attribution duo), `roamLedger.ts` /
`gankLedger.ts` (timer et `fault`), `anomalyDetector.ts` (branchements § 4.5), `mistakeRules.ts` + catalogue,
`playerSessionStatsCore.ts` / `teamTimelineCore.ts` (chiffres), `codex.json`, tests, `ANALYSIS_VERSION` + 1.
Front-end = blocs de stats, libellés de la liste d'objectifs, i18n. Graphic Design : maquette Penpot des trois lignes
de stats avant le code (règle des maquettes). Ajout du § 3bis : `TANKS` dans `championClasses.ts`, règles de late game
dans `objectiveRules.ts`. Effort : **voir le total final au § 3ter.6** (≈ 15,5 j toutes sessions).
**Livraison en deux temps**, comme les ledgers : chiffres calculés et stockés, tags désactivés (`DETECTOR_SPEC.prio.enabled`,
`crossmap.enabled`, `duo.enabled`, `lateGame.enabled` à `false`) jusqu'à la validation du § 6.

---

## 5. Ce que ces règles ne peuvent pas voir (à dire au joueur si besoin)

- la wave elle-même (taille, freeze, slow push, sbires sous la tour) : la prio est **déduite**, au mieux prouvée par une
  plaque ou un vis-à-vis absent ;
- un TP ou un Flash pour rejoindre (pas de sorts) ;
- la position des wards (seulement celle du poseur) ;
- un appel de l'équipe (« on laisse le Dragon ») : en soloQ, le moteur suppose qu'un objectif non contesté est un choix
  de l'équipe, pas une faute du joueur seul, d'où le verdict par joueur et seulement pour les rôles concernés ;
- la pression sans kill ni ressource (un mid qui fait reculer son vis-à-vis sans plaque) : comptée `even`, jamais
  comme une faute.

---

## 6. Validation avant activation

### 6.1 Calibrage sur le cache (lecture seule, aucune requête Riot)

Script `scripts/calibrate-prio-crossmap.ts`, même modèle que `calibrate-roam-roles.ts` (`cachedCurrentGames` sur une
**copie** du MatchCache ; 483 parties 16.x au 26/11, les deux équipes, soit 966 parties-joueur par rôle) :

1. répartition `ours` / `theirs` / `even` / `unknown` par objectif et par signal (P1 à P5) ; cible `unknown` ≤ 25 % avant
   20:00 ;
2. **cohérence** : l'équipe qui a la prio mid + sidelane prend l'objectif dans au moins 65 % des cas (sinon le proxy ne
   mesure pas la prio) ;
3. taux de chaque tag pour 100 parties-joueur, par rôle et par palier de patch (16.9, 16.16) ;
4. winrate des parties avec / sans chaque tag (le tag doit séparer les victoires des défaites, comme pour les roams) ;
5. temps de calcul ajouté par analyse (les ledgers coûtent ~1 ms ; cible < 5 ms).

### 6.2 Relecture vidéo (seule preuve de la wave)

Sur les **parties enregistrées de l'utilisateur** (Record auto, bouton « Revoir » de la liste d'objectifs, extraits de
45 s avant à 30 s après) :

| Lot | N | Ce que l'utilisateur juge | Cible |
|---|---|---|---|
| Prio | 30 objectifs (10 Dragons, 10 Larves, 10 Hérauts), les deux lanes du côté | prio réelle à T : nous / eux / égale | accord ≥ 80 % sur `ours` / `theirs` lus en P1-P3 ; ≥ 65 % en P4 (sinon P4 reste caché) |
| Climax des waves | 10 rencontres de waves filmées (mid et sidelanes, avant et après 14:00) | heure réelle de rencontre au milieu et du crash | trajet estimé juste à ±5 s, sinon `waveTravelSec` corrigé |
| Côté avantagé | 10 objectifs où les deux côtés étaient disponibles | quel côté fallait-il jouer ? | accord ≥ 80 % avec `sideEdge` ; `objective-wrong-side` ≤ 2 faux positifs sur 10 |
| Tags prio | 20 `objective-without-prio` + `no-prio-before-objective` (dont 8 de sidelaners, la moitié en équipe si possible) | erreur réelle ou pas ; pour un sidelaner : wave ou reset en cause | ≤ 3 faux positifs sur 20 (≤ 15 %), règle des ledgers |
| Crossmap | 20 objectifs non contestés, dont au moins 5 mids et 5 supports en soloQ avant 14:00 (décision 1) | contesté ou non ; crossmap fait ou non | ≤ 3 faux positifs sur 20 pour `no-crossmap-trade` |
| Duo | 20 morts de l'ADC (ou du support) pendant une absence du duo, dont 5 cas « ADC forcé d'avancer » et 5 après 14:00 | qui est fautif | accord ≥ 80 % sur la faute ; `left-adc-alone` ≤ 2 faux positifs sur 20 (faute la plus lourde) |
| Late game | 20 objectifs après 20:00 (botlane, split pusher, tank) | bon placement ou pas | ≤ 3 faux positifs sur 20 par tag ; `TANKS` relu sur les champions du cache |

Soit environ 130 extraits de ~75 s, ≈ 3 h de relecture, à faire en deux ou trois fois. Si un lot n'atteint pas sa cible : seuil
relevé et nouveau lot, ou tag gardé désactivé (chiffres seuls). Les corrections « Not a mistake » après activation
alimentent le registre des corrections (décision du 21/11).

---

## 7. Questions

Les 10 questions du premier jet ont reçu leur réponse le 27/11 (section « Décisions de l'utilisateur » en tête du
rapport, et `DECISIONS.md`). Restent des points de détail, **sans blocage** : le Back-end peut coder avec la valeur
proposée, que la relecture vidéo (§ 6) confirmera ou corrigera.

1. **Qui est « tank »** (règle `late-missed-rejoin`) : liste `TANKS` tenue par patch, ou classe Data Dragon. Proposé :
   liste propre au moteur, relue sur les champions du cache, comme `CONTROL_MAGES`.
2. ~~« Objectif qui devait être joué »~~ : **tranché par la correction du 27/11** (objectif du côté le plus avantagé, § 1.4).
3. **Seuils du côté avantagé** (`sideGap` 1 500, `junglerEdge` 1 500 d'or et 1 niveau) : proposés, non bloquants, à confirmer au calibrage.
4. ~~Win condition, Q-W1 à Q-W5~~ : **répondues le 27/11**, intégrées au § 3ter.6. Le rapport est final ; il reste
   les points 1 et 3 ci-dessus, non bloquants.
