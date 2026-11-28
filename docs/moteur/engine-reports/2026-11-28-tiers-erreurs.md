# Tiers d'erreurs du Mistake Lab : fatale, critique, moyenne (et anodine)

_28/11/2026, session Engine. Entrée : décision du 28/11 « Tiers d'erreurs » (`docs/DECISIONS.md`). Code relu en lecture
seule : `mistakeRules.ts` / `mistakeDetector.ts` (gravité 1-3 fixée par chaque règle), `mistakeInsights.ts` (classement
et coût en winrate), `mistakeBookmarks.ts` (signet vidéo des gravités 3), `winProbability.ts` (`winZ`, garbage time),
`ledgerCore.ts`. Saison en cours seulement. Aucun code, aucun commit. Rapport court ; le code vient après l'accord._

**En bref.** Le tier d'une erreur est **mesuré** (ce qu'elle a coûté en or à l'équipe et à la lane), pas fixé par la
règle qui la détecte comme l'est la gravité aujourd'hui. Le coût est compté **événement par événement** (prime de la
mort, ce que l'adversaire prend pendant qu'on est mort), pas en lisant la courbe d'or brute, pour ne pas imputer à
l'erreur ce que d'autres ont perdu. Seuils de fatale **de 700 à 1 600 selon l'heure**, critique **500**, snowball =
**3 minutes de baisse**. 4e tier « anodine » pour ce qui suit une fatale. 5 questions (§ 7).

**Mise à jour du 28/11 : réponses de l'utilisateur intégrées** (`DECISIONS.md`, « Tiers d'erreurs, réponses à
Engine »). Rapport final ; la section suivante prime sur les § 1 à 7 quand ils diffèrent.

## Décisions de l'utilisateur (28/11) et ce qu'elles changent

| # | Réponse | Effet |
|---|---|---|
| Nouveau | Un **late back** ou une **mort avec de l'or non dépensé** qui **précède** une erreur fatale ou critique peut prendre ce tier (chaîne causale). | § 3bis : chaîne, fenêtre et lien |
| 1 | **L'or est le critère principal.** L'XP compte un peu moins, et pas avant 5:00. Les objectifs sont convertis en or, **mais le tier dépend de la courbe d'or qui suit** : un objectif de plus de 700 or n'est pas critique ou fatal par défaut (peut-être pas contesté, ou compensé par le crossmap : utiliser les chiffres crossmap de la phase 1). | § 1 : XP à 0,4 or par point dès 5:00 ; objectif plafonné par la baisse réelle de la courbe et net du crossmap |
| 2 | Seuils qui montent avec le temps, **jusqu'à ~3 000 or vers 35:00** (fatale) ; la critique monte aussi, proportionnellement. | § 2 : courbe 700 → 1 600 → 3 000, critique = 0,71 × fatale |
| 3 | Le Labo ne compte que les erreurs **individuelles** : la fatale d'un coéquipier ne déclenche pas « anodine ». L'état anodin dure **jusqu'à la fin de la partie**. | § 4 confirmé (sa propre fatale, jusqu'à la fin) |
| Défaut du Chief | 4e tier « anodine » **visible** (prévu par la maquette) ; critique du jungler contre le jungler adverse, du support (et de l'ADC) contre le duo adverse. | § 2 et § 4 confirmés |

## 1. Attribuer un écart d'or à une erreur

**Unité : l'or** (décision 1). Deux compléments, moins lourds :
- **XP** : **0,4 or par point d'XP** (l'échelle `winZ` donnerait 0,53 ; volontairement plus bas, « compte un peu
  moins »), et **0 avant 5:00** ;
- **objectifs** : convertis avec l'échelle `winZ` (≈ 37 × poids × minutes : Dragon à 10:00 ≈ 370, Baron à 25:00 ≈
  1 870), **mais jamais pris tels quels** : leur part dans le coût est
  `min(valeur de l'objectif − ressources prises par nous en crossmap, baisse réelle de l'écart d'or d'équipe sur les
  3 relevés suivants)`. Le crossmap vient du verdict de la phase 1 (`traded` et valeur de l'échange, rapport
  `2026-11-27-prio-crossmap-duo.md` § 2.2) ; tant qu'il n'est pas codé, seule la baisse de la courbe compte. Un objectif
  non suivi d'une baisse de la courbe ne rend donc **jamais** une erreur critique ou fatale à lui seul.

**Le « sillage » d'une erreur datée** (mort, ou moment sans mort) : de l'erreur jusqu'à **la réapparition + 30 s**
(mort) ou **60 s** (moment sans mort). On additionne ce que la timeline prouve, à la ms :

| Composante | Donnée | Compté |
|---|---|---|
| Prime de la mort | `bounty` + `shutdownBounty` du `CHAMPION_KILL` (présents à 100 % dans le cache) + part des assists | tout |
| Farm perdue pendant la mort | CS/min du joueur sur les 3 min précédentes × durée de mort × or moyen d'un sbire (~21 g) | tout (estimé) |
| Ce que l'adversaire prend dans le sillage | plaques, tours, objectifs (`goldEq`), kills d'autres alliés **à 4 contre 5** près de l'endroit de l'erreur | tout, sauf ce qu'il aurait eu sans l'erreur (§ ci-dessous) |
| Ce que nous prenons en retour | nos kills, plaques, objectifs dans le même sillage | soustrait (échange) |

**Ne pas imputer ce qui vient d'ailleurs :**
- **Fight** (kills à moins de 3 000 et à moins de 20 s les uns des autres, définition des ledgers) : le bilan **net**
  du fight est partagé entre nos morts du fight, au prorata des primes ; la 1re mort (celle qui ouvre le fight à 4
  contre 5) prend la part du 4 contre 5, les suivantes leur prime seulement ;
- **Autre mort alliée indépendante** (plus de 3 000 et plus de 20 s d'écart) : hors du sillage, jamais imputée ;
- **Objectif déjà acquis** : un objectif pris par l'adversaire alors que notre équipe était déjà à 2 morts ou plus
  **avant** l'erreur n'est pas imputé à l'erreur ;
- **Moment sans gain adverse** dans le sillage : coût 0, tier moyenne (le défaut).

La **courbe d'écart** (or des 5 contre 5, et or du joueur contre son vis-à-vis), lue aux relevés de minute, ne sert
qu'au **snowball** (§ 2), jamais au coût immédiat : elle mélange tout ce qui arrive sur la carte.

## 2. Seuils

| Tier | Coût immédiat (sillage) | **ou** snowball |
|---|---|---|
| **Fatale** | net d'équipe ≥ **T_fatal(t)** (décision 2), linéaire par morceaux : **700** jusqu'à 5:00 → **1 600** à 25:00 (+ 45 or/min) → **3 000** à 35:00 (+ 140 or/min) → 3 000 ensuite. Repères : 10:00 = 925, 15:00 = 1 150, 20:00 = 1 375, 30:00 = 2 300 | courbe d'équipe : pente des 2 min **avant** ≥ − 50 or/min (pas déjà en chute) ; puis **3 relevés de suite en baisse** après l'erreur, perte cumulée ≥ **T_fatal(t) / 2** |
| **Critique** | écart de lane (joueur contre vis-à-vis) creusé de ≥ **T_crit(t) = 0,71 × T_fatal(t)** dans le sillage (prime, plaques, CS et XP gagnés par le vis-à-vis pendant la mort). Repères : 500 jusqu'à 5:00, 660 à 10:00, 820 à 15:00, 1 140 à 25:00, 2 140 à 35:00 | courbe de lane : même forme, 3 relevés de baisse, perte cumulée ≥ **T_crit(t)** |
| **Moyenne** | le reste | — |
| **Anodine** | toute erreur moyenne qui suit une fatale du joueur (§ 4) | — |

- Une erreur prend **le tier le plus haut** atteint (une fatale est souvent aussi critique).
- **Snowball partagé** : si plusieurs erreurs précèdent le début de la chute (dans les 60 s), le snowball va **à la
  première** ; les autres gardent leur coût immédiat.
- « Vis-à-vis » : même rôle adverse ; **ADC et support** : le duo contre le duo ; **jungler** : contre le jungler
  adverse (défaut du Chief).
- Exemple, 15:00 : T_fatal = 1 150. Mort seule du mid (prime 300 + farm perdue ≈ 150), l'ennemi prend la tour mid
  (or réel de la tour) puis le Dragon (≈ 560 en valeur) ; l'écart d'or d'équipe baisse de 900 sur les 3 relevés
  suivants et nous n'avons rien pris en crossmap : coût ≈ 300 + 150 + tour + min(560, baisse restante) ≈ 1 200 →
  **fatale**. Même scène avec un Héraut pris par nous de l'autre côté : le Dragon est compensé, coût ≈ 800 → **critique**
  si le vis-à-vis en a tiré ≥ 820 sur la lane, sinon moyenne.

## 3. Erreurs qui ne sont pas des morts

| Type | Tags | Tier |
|---|---|---|
| **Moment daté sans mort** (objectif sans vision, absent d'un objectif, overstay sans mourir, roam / gank perdants) | `no-ward-pre-obj`, `dead-during-objective`, `overstay`, ledgers | sillage de 60 s depuis le moment : objectifs, plaques, kills adverses imputables (§ 1) ; peut être **fatal** (Baron perdu à 25:00 ≈ 1 870) |
| **Retard mesuré sur une durée** (CS, XP, niveaux) | `cs-deficit`, `xp-deficit` | écart de lane qu'il représente (CS × 21 or, XP × 0,53) : **critique** si ≥ 500, sinon moyenne ; **jamais fatale** (pas un instant unique) |
| **Économie** | `late-back`, `unused-gold` | **moyenne** par défaut (l'or non dépensé n'est pas un écart), **sauf chaîne causale** (§ 3bis) : elle prend alors le tier de l'erreur qu'elle a causée |
| **Tags manuels** du joueur | tous | datés : même calcul que l'erreur auto au même instant ; non datés : **moyenne** |

## 3bis. Chaîne causale : late back et or non dépensé (décision du 28/11)

Un `late-back` ou un `unused-gold` **prend le tier** (fatale ou critique) de l'erreur qu'il a causée, si le lien est
prouvé par la timeline :

| Cause | Lien exigé | Fenêtre |
|---|---|---|
| `unused-gold` (mort avec de l'or non dépensé) | **la même mort** : le tag est posé sur cette mort, il prend son tier | — |
| `late-back` (retour tardif) | une **mort** du joueur, ou un **moment** daté où il est impliqué (objectif perdu, fight), **sans passage en base entre les deux** (aucun achat, jamais dans la base) | **90 s** après le late back |
| `late-back` suivi d'un back forcé | mort évitée mais **back forcé** (sous 35 % de PV, achat) pendant lequel l'adversaire prend un objectif ou des plaques : le sillage du back est compté comme un moment sans mort (§ 3) | 90 s |

- La cause ne prend **que** fatale ou critique ; si l'erreur causée est moyenne, la cause reste moyenne.
- **Pas de double compte** : la cause et l'erreur causée partagent un `chainId`. Dans le Labo, chaque tag reste compté
  (ce sont deux erreurs différentes, l'utilisateur veut voir le late back au bon tier) ; dans les chiffres « fatales de
  la partie » et pour l'état anodin, **une chaîne compte une fois** ; le coût en or n'est porté qu'une fois (par
  l'erreur causée). Texte : « Late back à 18:40 → mort à 19:30 (fatale) ».
- La chaîne n'est jamais tirée d'une mort de coéquipier (erreurs individuelles, décision 3).

## 4. « Anodine » après une fatale

Proposé : un **4e tier « anodine »** plutôt qu'une moyenne déclassée, pour que l'app puisse le montrer et le filtrer.

- **Portée** (décision 3) : les erreurs **moyennes** du joueur après **sa propre** fatale, **jusqu'à la fin de la
  partie** (pas de retour en cas de comeback). La fatale d'un coéquipier ne déclenche rien : le Labo ne compte que les
  erreurs individuelles. Le 4e tier est **visible** (défaut du Chief, prévu par la maquette).
  Une erreur critique ou fatale après la fatale **garde** son tier (règle de l'utilisateur).
- **Labo** : les anodines sont affichées en retrait (le design choisit : opacité, couleur) avec la raison « après ta
  fatale de 14:20 » ; **exclues par défaut** du classement par fréquence (filtre pour les voir) et **exclues du coût en
  winrate** (elles n'arrivent que dans des parties déjà mal parties : elles fausseraient la comparaison avec / sans).
- **Micro-review, signets** : jamais un moment ni un signet vidéo.

## 5. Lien avec le ×2 du leader et le garbage time

- **Tier et poids sont indépendants** : le tier décrit **l'erreur** (ce qu'elle a coûté), le poids ×2 décrit **le
  joueur** (leader de la game, rapport `2026-11-27-prio-crossmap-duo.md` § 3ter.6). Le classement compte « occurrences ×
  poids » par tier ; une anodine reste à poids 1 (le ×2 ne la relève pas).
- **Garbage time** (`winProbability` < 0,18 ou > 0,85, déjà exclu de la micro-review) : une erreur en garbage time est
  **anodine**, jamais fatale ni critique (l'écart ne change plus l'issue).
- **Gravité actuelle (1-3)** : gardée en interne (chaque règle la fixe encore) ; **l'affichage et les signets vidéo
  passent au tier** (signet automatique pour les fatales et les critiques au lieu des gravités 3, `mistakeBookmarks.ts`).

## 6. Calibrage (cache, lecture seule, aucune requête Riot)

Script `scripts/calibrate-tiers.ts` (modèle `calibrate-roam-roles.ts`) sur une **copie** du cache : **483 parties
16.x**, les 10 joueurs, règles M\* + morts :

1. répartition par tier, par rôle et par tranche d'heure. **Attendu** (hypothèse à vérifier) : fatales 5-10 % des
   erreurs auto, critiques 20-30 %, moyennes 45-60 %, anodines 10-20 % ;
2. séparation : winrate des parties avec au moins une fatale du joueur **≤ 30 %** (sinon le seuil est trop bas),
   avec une critique 35-45 %, sans les deux ~55 % ;
3. sensibilité : T_fatal à 15:00 = 900 / 1 150 / 1 400, snowball sur 2 ou 3 relevés, critique 0,6 / 0,71 / 0,85 × T_fatal ; poids de l'XP 0,3 / 0,4 / 0,53 ; à 30:00-35:00, vérifier que 2 300-3 000 sépare encore (peu de parties de plus de 35 min dans le cache) ; part des late backs et or non dépensé promus par chaîne (attendu < 15 % de ces tags) ;
4. relecture : 20 fatales et 20 critiques tirées au hasard, données seules puis vidéo sur les parties de
   l'utilisateur ; **≤ 3 désaccords sur 20** par tier ;
5. coût de calcul ajouté (< 2 ms par analyse) ; `ANALYSIS_VERSION` + 1 au code.

**Effort final** : Back ≈ 2,5 j (attribution, courbe de seuils, objectifs plafonnés par la courbe et le crossmap,
chaînes causales, anodines, coût, signets, calibrage), Front ≈ 1 j (filtre et nuances de tier, 4e tier visible, raison
« anodine » et texte de chaîne), Graphic ≈ 0,5 j (nuances de tier dans le classement, déjà prévues par la maquette) :
**≈ 4 j**. Dépendance : le plafond crossmap des objectifs lit le verdict crossmap du rapport du 27/11 ; sans lui, seule
la baisse de la courbe plafonne l'objectif (aucun blocage).

## 7. Questions

Toutes tranchées le 28/11 (réponses de l'utilisateur et défauts du Chief, section « Décisions » en tête). Rapport
final. Seuls les chiffres proposés (XP 0,4 or, critique 0,71 × fatale, fenêtre de chaîne 90 s, snowball 3 relevés)
seront confirmés ou ajustés par le calibrage du § 6.

## 8. Révision de la règle « critique » après calibrage (28/11)

_Entrée : sortie du Back `calibration-tiers-28-11.txt` (dossier de notes partagé du Chief ; 483 parties 16.x, 4 830
parties-joueur, 30 487 erreurs auto). Décision du 28/11 : garbage time jugé **pas avant 20:00** (recalibrage en cours
chez le Back)._

### 8.1 Ce que dit le calibrage

| Constat | Chiffre | Lecture |
|---|---|---|
| Fatale | 6,6 % des erreurs, winrate avec une fatale **28,6 %** | conforme, on n'y touche pas |
| Critique | **6,9 %** (cible 20-30 %), winrate « critique seule » **52,0 %** contre 62,5 % sans les deux | trop rare et sépare mal (− 10,5 points) |
| Par rôle | top 12,3 %, mid 9,0 %, bot 7,5 %, **jungler 3,8 %**, **support 3,1 %** | l'écart « contre le vis-à-vis » ne voit presque rien du jungler et du support : leurs morts nourrissent les laners adverses, pas le jungler ou le duo adverses |
| Par heure | 0-10 : 9,5 % ; 10-20 : 11,6 % ; **20-30 : 2,1 %** ; **30+ : 1,2 %** | le seuil proportionnel (1 633 à 30:00, 2 130 à 35:00) sur un écart **de lane** n'est presque jamais atteint après 20:00 : les lanes n'existent plus, l'or se gagne partout |
| Raisons | lane-snowball 838, lane-gap 713, deficit 602, precedes 64 | 40 % des critiques viennent du snowball de lane, et l'échantillon montre des causes sans lien avec la lane : `forgot-trinket` et `no-ward-pre-obj` du jungler, `behind-on-levels-death` à 3:48, `bad-trade` à 2:00 avec 569 g |
| `cs-deficit` | 461 critiques sur 552 | un état mesuré à 10:00, pas un instant ; presque toujours « critique » dès qu'il existe |
| Sensibilité | 0,6 × fatale : 10,7 % / 53,3 % ; 0,85 × : 5,2 % / 49,5 % | baisser le ratio augmente le nombre **sans** mieux séparer : le problème est la **mesure**, pas le ratio |
| Garbage dès 20:00 | critique 8,7 %, critique seule **56,2 %** contre 65,0 % | plus d'erreurs jugées après 20:00, où la critique de lane ne veut plus rien dire |

**Conclusion** : la critique proportionnelle à la fatale et mesurée « contre le vis-à-vis » toute la partie ne
convient pas. Trois défauts : seuil hors d'échelle après 20:00, jungler et support presque invisibles, snowball de lane
attribué à des erreurs qui ne touchent pas la lane.

### 8.2 Règle révisée proposée

| Point | Avant | Proposé | Pourquoi (chiffres ci-dessus) |
|---|---|---|---|
| **Seuil** | 0,71 × T_fatal (497 → 2 130) | **absolu** : **500** jusqu'à 14:00, **650** de 14:00 à 20:00 | l'écart de lane se joue en or de lane (primes 300-400, plaques, CS) ; il ne croît pas comme l'écart d'équipe. La hausse « proportionnelle » de l'utilisateur est gardée sous une forme bornée (+ 30 %) le temps que la lane existe |
| **Après 20:00** | écart de lane ≥ 0,71 × T_fatal | **écart d'équipe ≥ 0,5 × T_fatal** (« demi-fatale » : 690 à 20:00, 800 à 25:00, 1 150 à 30:00, 1 500 à 35:00), même calcul du sillage que la fatale | après 20:00 il n'y a plus de confrontation directe ; 2,1 % puis 1,2 % de critiques le montrent. Une erreur qui coûte la moitié d'une fatale à l'équipe est le bon équivalent. **Écart à la lettre de la règle de l'utilisateur** (« écart dans la confrontation de lane ») : à lui faire valider (§ 8.4) |
| **Écart de lane mesuré** | gain du vis-à-vis dans le sillage | inchangé pour top, mid, ADC : prime + plaques + CS et XP (0,4) gagnés par le vis-à-vis pendant la mort, moins ce que le joueur reprend | la mesure immédiate (`lane-gap`) donne les bons cas dans l'échantillon (Urgot 10:24 709 g, Sivir 15:20 832 g) |
| **Jungler et support** | contre le jungler adverse / le duo adverse | **coût d'équipe du sillage ≥ le seuil de critique** (500 / 650, puis demi-fatale) | leurs morts profitent aux laners adverses et à l'équipe ; jungler 3,8 % et support 3,1 % de critiques, deux à trois fois moins que les laners, ne reflètent pas leur poids |
| **Snowball de lane : causes admises** | toute erreur | seulement les erreurs **de lane** : morts, `bad-trade`, `overstay`, `dove-tower`, `caught-out`, `bad-lane-opening`, `behind-on-levels-death`, `unused-gold`, `late-back`. **Pas** `forgot-trinket`, `no-ward-pre-obj` ni les tags d'objectif | une ward oubliée ne fait pas perdre 3 minutes de lane ; ces cas sortent de l'échantillon tel quel |
| **Snowball de lane : forme** | pente des 2 min avant ≥ − 50, puis 3 relevés de baisse, total ≥ seuil | **(a)** pas avant **3:00** (avant, 500 g de lane = un niveau 2 perdu, déjà lu par la mort ou le trade) ; **(b)** cassure nette : la pente moyenne des 3 relevés **après** est au moins **2 fois** plus forte que celle des 3 relevés **avant** (un joueur qui perd déjà sa lane au même rythme n'est pas « cassé » par cette erreur) ; **(c)** total ≥ seuil absolu (500 / 650) ; **(d)** jamais après 20:00 (remplacé par le snowball d'équipe de la fatale, au seuil demi-fatale) | 838 snowballs de lane, dont des cas à 526-570 g avant 4:00 ; la cassure de pente sépare une erreur d'une lane déjà perdue |
| **`cs-deficit`, `xp-deficit`** | critique si l'écart vaut ≥ seuil à 10:00 | critique seulement si l'écart est **≥ 500 à 10:00 et ne s'est pas réduit à 14:00** (relevé 14) ; sinon moyenne | 461 critiques sur 552 : la règle actuelle rend critique presque tout retard de CS ; la persistance distingue une lane perdue d'un retard rattrapé |
| **Chaîne causale** | inchangée | inchangée (64 cas, 12,2 % des late backs / or non dépensé) | conforme à la cible (< 15 %) |

### 8.3 Cibles révisées et variantes à faire tourner (Back, script existant)

Les cibles que j'avais posées (critique 20-30 %, « critique seule » 35-45 % de victoires) étaient des hypothèses. Le
calibrage montre deux choses : la base « ni fatale ni critique » est à **62-65 %** (pas 55 %), et la fatale seule est à
28,6 %. Une critique (500 g) laisse la partie jouable ; un winrate de 35-45 % lui demanderait d'être presque une
fatale. **Cibles révisées** :
- critique **12-20 %** des erreurs (avec le garbage time dès 20:00) ;
- winrate « critique seule » **entre la fatale et la base, au moins 12 points sous la base** (≈ 50-53 % pour une base
  à 65 %) ;
- par rôle, jungler et support **au moins la moitié** du taux des laners ;
- après 20:00, critique **≥ 5 %** des erreurs jugées.

Variantes, chacune sur le garbage time dès 20:00, sorties comme aujourd'hui (taux, rôle, heure, raisons, winrate,
20 cas tirés au sort) :

| Variante | Contenu |
|---|---|
| **V1** | seuil absolu 500 / 650, demi-fatale après 20:00 |
| **V2** | V1 + snowball de lane restreint (causes de lane, dès 3:00, cassure × 2, jamais après 20:00) |
| **V3** | V2 + jungler et support au coût d'équipe |
| **V4** | V3 + persistance de `cs-deficit` / `xp-deficit` à 14:00 |
| V4b, V4c | V4 avec cassure × 1,5 et × 3 ; V4 avec 650 → 800 de 14:00 à 20:00 |

On retient la plus simple qui atteint les cibles ; 20 critiques relues à la main (≤ 3 désaccords) avant activation,
comme prévu au § 6.

### 8.4 À valider par l'utilisateur (via le Chief)

1. **Après 20:00**, « critique » = la moitié d'une fatale **en écart d'équipe**, puisque la confrontation de lane
   n'existe plus : d'accord ? (Sinon il n'y aura presque aucune critique après 20:00 : 2,1 % aujourd'hui.)
2. **Seuil de lane** absolu, 500 puis 650 de 14:00 à 20:00, au lieu d'une hausse proportionnelle sans borne : d'accord ?
3. **Jungler et support** jugés au coût d'équipe (pas contre le jungler ou le duo adverses) : d'accord ?
