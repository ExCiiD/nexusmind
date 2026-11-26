# Rapport — le moteur d'Ascend

_19/11/2026. État du dépôt après la recherche de connaissances de novembre 2026 ([`RECHERCHE_CONNAISSANCES.md`](RECHERCHE_CONNAISSANCES.md) :
sources, faits 2026 vérifiés, ce qui a changé et pourquoi), après l'intégration V7 à V10, le retrait du protocole basse
énergie et le passage des détecteurs à l'horloge de la saison 2026 (§ 1.2, règle M15 écrite). Chaque chiffre
ci-dessous est lu dans le code : le fichier source est cité à chaque fois._

## En bref

- **Pas d'IA.** Tout ce que l'application « comprend » d'une partie vient de règles écrites et de calculs
  déterministes, exécutés sur ton PC **après** la partie, à partir des données officielles de Riot. La même partie
  donne toujours le même résultat, et chaque conclusion peut citer sa preuve.
- **Cinq blocs** travaillent ensemble :

| Bloc | Rôle dans l'app | Code |
|---|---|---|
| Détecteur d'erreurs | remplit le **Labo d'erreurs** avec 16 erreurs repérées sans toi | `electron/main/mistakeDetector.ts`, `mistakeRules.ts` |
| Micro-revue | choisit les **3 moments** qui ont coûté le plus, propose un diagnostic en QCM, puis une fiche Codex | `src/lib/microReview/` |
| Comparateur de phase de lane | note ta lane de **S à F** contre ton vis-à-vis sur les 14 premières minutes | `electron/main/lanePhaseAnalyzer.ts` |
| Assistant (moteur de coaching) | conseils après la partie, brief de session, bilan hebdo, page **Mon plan**, expériences mesurées | `electron/main/assistant/` |
| Statistiques | radar des fondamentaux, onglet **Analyse**, classement du Labo | `src/lib/fundamentalsRadarCore.ts`, `statsInsights.ts`, `mistakeInsights.ts` |

- **Quelques chiffres** : 27 erreurs au catalogue, dont 16 détectées automatiquement ; 3 déclencheurs et 41 schémas
  reconnus par la micro-revue ; 109 fiches Codex ; 41 règles et 18 problèmes dans l'assistant ; 8 règles de
  vérification d'objectif de session.

### D'où viennent les données

Riot fournit, une fois la partie finie (Match-V5 + Timeline-V5) :

- **un relevé par minute** de chaque joueur : position, or total et en poche, XP, niveau, CS (sbires et jungle), PV et
  mana (ou énergie) ;
- **des événements horodatés à la milliseconde** : kills (position, tueur, assistants, dégâts reçus par la victime),
  monstres épiques, tours et inhibiteurs, plaques, wards posées (sans coordonnées), objets achetés et détruits, montées de
  niveau et de sorts.

Ce qui **n'existe pas** dans ces données, et que le moteur ne prétend donc jamais savoir : les sorts lancés (Flash,
Smite, dash, ultime), les vagues de sbires, quel camp de jungle a été pris, les Carapateurs (Scuttle Crab), le moment
où tu lances un recall, la position d'une ward, les positions entre deux relevés, les dégâts hors des morts, le temps de
réapparition (il est recalculé avec la formule du wiki : attente de base selon le niveau × facteur de temps, voir M15).
Quand les données ne prouvent rien, le moteur se tait.

---

## 1. Les connaissances de jeu, par catégorie

### 1.1 La carte

`src/lib/microReview/geometry.ts`, `electron/main/mistakeDetector.ts`

| Connaissance | Valeur codée | Utilisée pour |
|---|---|---|
| Taille de la Faille | 15 000 × 15 000 unités, base bleue en (0, 0), rouge en (14 800, 14 800) | toutes les distances |
| Fontaines | bleue (400, 450), rouge (14 400, 14 400) ; rayon de fontaine 2 200 | recalls, réapparitions |
| Fosses | Baron / Héraut / Larves (5 007, 10 471) ; Dragon / Ancien (9 866, 4 414) | objectifs, fights de fosse |
| Moitiés de carte | x + y < 14 500 = côté bleu, > 15 500 = côté rouge, entre les deux = rivière ; les deux fosses (1 500 autour du centre) comptent comme rivière pour les deux équipes | « ton côté / côté ennemi » |
| Lanes | top = bord gauche et haut (x < 2 200 ou y > 12 800), bot = bord bas et droit, mid = diagonale (\|x − y\| < 1 700) ; le reste est la jungle | lane d'un moment |
| Zones nommées | base, top / mid / bot lane, rivière haute / basse, ta jungle / jungle adverse | la phrase résumé de la micro-revue |
| Plateforme de base | x et y < 2 000 (bleu), > 12 800 (rouge) | « en base » |
| Tours | coordonnées des tours extérieures, intérieures et d'inhibiteur des deux camps ; T1 par lane | dives, tours de side lane |
| Ligne de tempo | D = (x + y) / 30 000 (miroir pour le côté rouge) : 0 = ta fontaine, 1 = la fontaine adverse | « trop en avant / resté en base » |
| Rayons utiles | objectif proche 2 800 ; allié « présent » 2 500 ; recherche de ward autour d'une fosse 3 500 ; fight de fosse 3 000 ; « dans la fosse » 900 | tous les détecteurs |

### 1.2 Objectifs et timers

| Connaissance | Valeur codée | Code |
|---|---|---|
| Premier Dragon | 5:00, puis 5:00 après chaque Dragon tué (vérifié sur les parties 16.x en cache) | `DETECTOR_SPEC.spawns` |
| Larves du Néant | un camp de 3 Larves à 8:00, sans réapparition | idem |
| Valeur d'un objectif dans l'estimation de la partie | tour 1 · inhibiteur 1,5 · Dragon 1 · Ancien 2,5 · Héraut 0,5 · Larves 0,3 · Baron 2 | `winProbability.ts` |
| Œil du Héraut | objet 3513 ; il disparaît de l'inventaire à l'usage ou environ 300 s après le kill (son ramassage n'est pas journalisé). Héraut de 15:00 à 19:45. Fenêtre de la règle : 15:00-22:00 (l'œil quitte son porteur avant 21:52 dans 95 % des 108 cas en cache) | V7, jungler mort avec l'œil en poche |
| Retour au premier camp | le premier camp réapparaît : un jungler encore sur la carte à 3:30 a raté le recall à T−25 s | V7 |
| Premier Carapateur (2:55) | absent des données : lu à travers une mort de ton jungler dans la rivière basse entre 2:50 et 3:15 | V10 support |
| Réapparition | attente de base par niveau 10 / 10 / 12 / 12 / 14 / 16 / 20 / 25 / 28 / 32,5 … 52,5 s (wiki « Death ») × (1 + facteur de temps : 0 avant 15:00, puis +0,425 % par 30 s jusqu'à 30:00, +0,30 % par 30 s jusqu'à 45:00, +1,45 % par 30 s ensuite, plafond +50 %) | `gameClock.ts`, positions des morts (micro-revue), M15 |
| Baron | buff de Baron de ton équipe, fights à moins de 3 000 de la fosse | V4, V6 |
| Saison 2026 (patch 26.1 et suivants) | Baron à **20:00** ; sbires à 0:30, camps à 0:55, Carapateur à 2:55 ; plates à 120 g qui restent jusqu'à la chute de la tour ; Smite 1 000 / 1 400 ; vérifié sur 128 timelines 2026 en cache | fiches Codex, règles de l'assistant et détecteurs (voir ci-dessous) |

**Saison analysée.** Le moteur ne connaît que la saison en cours. Il lit la saison dans `info.gameVersion` de Match-V5
(`gameClock.ts`, `seasonOf`) : version 16 et plus (ou inconnue) → saison en cours ; 15.x et avant → **non analysée**
(ni micro-revue, ni erreurs automatiques du Labo). Les analyses et erreurs déjà enregistrées sur ces parties ne sont pas
touchées (décision de l'utilisateur du 20/11/2026, `docs/moteur/engine-reports/2026-11-20-inventaire-regles-avant-2026.md`).
Repères du début de partie : sbires 0:30, camps 0:55, Carapateur 2:55. Ils fixent les fenêtres de gank, Carapateur,
premier back du jungler, première ward et all-in niveau 2 du support, pic de niveau 2/3, cheater recall, overchase, full
clear passif, contre-tempo, fenêtre de tempo et course aux niveaux (M19). Vérifié sur les parties 16.x en cache
(médianes) : niveau 2 d'un laner 1:40, niveau 2 du support 1:44, niveau 3 du jungler 1:59, premier back du jungler 3:45,
première ward du support 1:10, premier back d'un laner 3:25. `ANALYSIS_VERSION` 11 : chaque analyse en cache est
recalculée une fois.

**Plaques (19/11, `ANALYSIS_VERSION` 9).** Les plaques restent jusqu'à la chute de la tour : sur les parties 16.x en cache,
elles sont prises jusqu'à 47:47 (7 098 plaques, 128 parties, dont 5 336 après 14:00). Les trois règles liées aux plaques
suivent donc la T1 debout, avec une limite à 20:00 (apparition du Baron, la carte se regroupe) : dive 1 pour 1 et roam mid
payé en plaques jusqu'à 20:00 ; tour de side lane dès que la première tour est tombée, sans heure de début (le dernier
coup prend aussi les plaques restantes). La note de phase de lane garde sa fenêtre de 14 minutes. M12 compte une mort
avant 3:25 : 28,9 % des laners 16.x en cache meurent avant 3:25.

| Schéma (pour 100 parties-joueur, 16.x) | avant le 19/11 | après |
|---|---|---|
| Dive 1 pour 1 | 1,33 | 1,48 (2 après 14:00) |
| Roam mid payé en plaques | 0,16 | 0,31 (2 après 14:00) |
| Tour de side lane du jungler | 0,39 | 0,39 |
| Gank sur timer | 5,43 | 5,96 |
| Support sans ward à temps | 4,43 | 6,13 |
| Premier back du jungler en retard | 1,11 | 3,57 |
| Contre-tempo | 0,72 | 0,88 |
| Full clear passif | 0,07 | 0,23 |
| All-in niveau 2 du support | 0,51 | 0,23 |
| Cheater recall | 0,02 | 0,07 |
| Absent au Carapateur | 0,07 | 0,09 |

Le premier back du jungler en retard touche ≈ 18 % des parties de jungler : le seuil suit la règle (premier camp réapparu
à 3:10, + 20 s), pas la fréquence. À surveiller avec les retours des joueurs. Le cheater recall se lit sur un achat entre
2:00 et 2:40 : aucun relevé par minute ne tombe dans cette fenêtre.

### 1.3 Économie et objets

| Seuil | Signification | Où |
|---|---|---|
| > 1 500 or en poche à ta mort (> 2 500 = grave) | mort avec de l'or non dépensé | Labo, M1 |
| > 2 000 or en arrivant en base, sans achat depuis 4 min | back trop tardif | Labo, M3 |
| ≥ 1 400 or en poche | « tu aurais dû recall » dans le QCM | micro-revue |
| < 35 % PV avec ≥ 800 or en lane, puis mort dans les 40 s | back timer raté | V5 |
| Objet 1001 (Bottes) acheté par le jungler avant 8:00 sans kill | bottes trop tôt | V7 |
| 10 000 or dépensés | « 3 objets complets » (Riot ne donne pas de catalogue d'objets) | V6 |
| Un achat fait vivant | prouve un passage en base (la boutique ne vend qu'en base, vérifié) ; les objets de départ (avant 1:00) ne comptent pas | recalls V6, V7 |

### 1.4 Phase de lane

| Connaissance | Valeur codée | Où |
|---|---|---|
| Phases de la partie | début 0–14:00, milieu 14:00–25:00, fin 25:00+ | partout |
| Course aux niveaux | entre 0:55 et 3:55, mourir contre un adversaire qui a au moins 1 niveau de plus | Labo, M19 |
| Pic de niveau 2 / 3 | tué par ton vis-à-vis dans les 10 s après qu'il a pris son niveau 2 ou 3, toi encore en dessous (avant 3:55) | V5 |
| Distance contre mêlée | avant 8:00 : distance sous 60 % PV au niveau ≤ 3, ou mêlée sous 50 % au niveau ≤ 4 face à un distance au-dessus de 85 % | V5 (`championClasses.ts` : type d'attaque par champion) |
| Cheater recall | back entre 2:00 et 2:40 (un achat) avec plus de 75 % PV à 2:00, sans Téléportation, 1 niveau de retard ou plus à 4:00 | V5 |
| Dive 1 pour 1 | tu tues ton vis-à-vis à moins de 850 d'une T1 ennemie encore debout et tu meurs dans les 4 s, sans le jungler adverse, avant 20:00 | V5 |
| Ouverture de lane | à 5:00 : mort avant 3:25, ou −8 CS, ou −400 or face au vis-à-vis | Labo, M12 |
| Retard à 10:00 | −15 CS (Labo M13, grave à −25) ; −15 CS ou −400 XP (micro-revue, sauf 2 kills/assists ou plus) | Labo, micro-revue |
| Retard de niveaux | 2 niveaux de moins que le vis-à-vis à 10:00 ou 15:00 (grave à 3) | Labo, M14 |
| Mid à 6:00 | −12 CS, aucun sort de base à 2 points au niveau 3, moins de 2 kills/assists | V7 |
| Plaques | plaques prises et perdues sur la lane : avant 14:00 pour la note de lane ; jusqu'à 20:00 pour le roam mid | note de lane, roam mid |

### 1.5 Jungle

| Situation reconnue | Règle | Version |
|---|---|---|
| Overchase | entre 1:55 et 8:00, 20 s de l'autre côté de la rivière ou dans la jungle adverse, sans kill ni camp, puis mort | V2 |
| Full clear passif | la bot lane a 250 or d'avance à 3:00 et le mid n'est pas derrière, mais tu restes dans ta jungle jusqu'à 3:25 sans kill, et tu n'es pas devant en XP à 6:00 : l'invade à 3 camps était là | V2 |
| Contre-tempo | un play en rivière vers 2:40–3:40, puis retour dans ton quart de départ, et plus de 150 XP de retard sur le jungler adverse à 6:00 | V2 |
| Fenêtre de tempo non punie | entre 1:55 et 12:00, le jungler adverse se montre à plus de 8 000 de toi et rien n'est pris dans les 45 s | V3 |
| Timers de gank | fenêtres 1:50–2:25 et 2:40–3:50 ; une ward profonde dure 150 s | V3 |
| Premier back | encore sur la carte à 3:30 (aucun back après 1:00, ni kill, ni mort) | V7 |
| Gank qui coûte les camps | entre 2:00 et 12:00 : en lane avec un ennemi à moins de 2 500, aucun kill ni mort dans la minute, et 8 CS de jungle perdus sur le jungler adverse pendant cette minute | V7 |
| Camps volés | le jungler adverse gagne 8 CS de jungle entre deux relevés en restant dans le même quart de ta jungle | V7 (weak side) |
| Mort en invade | avant 16:00, dans la jungle adverse, seul ou avec un allié, après avoir pris un camp (4 CS), sans kill dans les 30 s avant | V7 |
| Dragon tanké | mort entre 5:00 et 12:00 à moins de 3 000 de la fosse, le Dragon t'ayant infligé 60 % de tes PV max | V7 |
| Mort de compensation | un allié tombe à moins de 3 000 dans les 15 s avant, tu meurs à 2 contre 1 de plus, et l'ennemi prend un monstre épique à cette fosse dans les 60 s | V7 |
| Tour de side lane | T1 de side lane détruite par toi avant 20:00 alors qu'une tour était déjà tombée | V7 |
| Smite volé | Dragon, Ancien, Héraut ou Baron pris par l'ennemi alors que tu étais vivant à moins de 900 de la fosse | V7 |
| Recall sous Baron | jungler en avance (KDA > 3 ou 10 000 or dépensés) en base ou dans sa jungle pendant le Baron de l'équipe, alors que 3 alliés sont en avant et que 2 meurent | V6 |
| Dive après inhibiteur | tué dans la base ennemie dans les 15 s qui suivent la chute d'un inhibiteur ennemi | V6 |

### 1.6 Mid lane

| Situation reconnue | Règle |
|---|---|
| Roam payé en plaques | roam avant 20:00 (à plus de 2 600 de la diagonale), aucun kill/assist, au moins 1 plaque mid et 10 CS perdus |
| Devant sa vague | mort en mid avant 12:00, au plus 45 s après être sorti de base |
| Piège du reset | l'adversaire rentre en premier ; toi, sous 30 % PV ou de mana (réserve de plus de 200, donc pas d'énergie ni de rage), tu restes et tu meurs dans les 90 s |
| Lane donnée à 6:00 | voir 1.4 ; remplace le retard de 10:00 pour la même lane |

### 1.7 Support et ADC

| Situation reconnue | Règle |
|---|---|
| Première ward | aucune ward posée par toi avant 1:10 (les wards d'objets de champion ne comptent pas) |
| All-in niveau 2 | tué entre 1:30 et 2:05 sous le niveau d'un ennemi du fight |
| Goulet ou fosse | à partir de 15:00, dans la fosse (moins de 900) pendant les 15 s avant le premier kill au lieu de tenir l'entrée (support ou mage de contrôle mid) |
| Collé à l'ADC après 6 | niveau 6 à 9:00, à moins de 2 000 de l'ADC sur 6 des 7 relevés de 9:00 à 15:00, moins de 45 % de participation aux kills à 15:00 |
| Absent au premier Carapateur | ton jungler meurt dans la rivière basse entre 2:50 et 3:15, toi à plus de 2 000 |
| Weak side non wardée | camps volés côté bot pendant que ton jungler est top, sans ward de toi dans ta jungle bot dans les 120 s avant (avant 18:00) |
| ADC qui rouvre une side lane | après 14:00, tué seul dans une side lane de l'autre côté de la rivière au plus 45 s après l'avoir atteinte |
| Carry donné en premier | prime de 450 or, KDA 4 ou 25 % de l'or de l'équipe, mort la première dans un fight à 3 ennemis |

### 1.8 Combats

| Situation | Règle |
|---|---|
| Premier mort d'un fight | aucun kill dans les 15 s avant ta mort, et au moins 3 kills dans les 15 s après |
| Pris seul | après 14:00, hors fight d'objectif (±30 s), 2 ennemis ou plus sur le kill, aucun allié à moins de 2 500 |
| Mort au Baron | à moins de 1 800 de la fosse du haut, après 8:00, avec au plus un allié à moins de 3 000 |
| Mort sous une tour | à moins de 700 d'une tour ennemie |
| Même fight | des kills à moins de 10 s d'écart |
| En infériorité | aucun allié à moins de 2 500 et au moins 2 ennemis |

### 1.9 Vision

| Règle | Valeur |
|---|---|
| Ward avant un objectif (Labo) | aucune ward posée dans les 90 s avant un objectif ; support et jungler responsables de tous les objectifs, un laner seulement de ceux que l'équipe perd ; pas de reproche si tu étais mort |
| Ward avant un objectif (micro-revue) | une ward à toi à moins de 3 500 de la fosse dans les 90 s avant, ou dans les 60 s avant ta mort |
| Trinket oublié | plus de 4 min sans ward (2 min 30 pour un support), plus 1 min par mort dans l'intervalle, à partir de 3:00, 3 fois par partie au plus |
| Position d'une ward | Riot ne la donne pas : la position du joueur au moment de la poser sert de position |

### 1.10 Tempo et macro

| Règle | Valeur |
|---|---|
| Lignes de tempo (après 15:00) | 3 alliés avancés (D > 0,55) pendant que tu es en base (D < 0,15), ou toi seul devant (D > 0,65) pendant que 3 alliés sont rentrés (D < 0,30) |
| Gank pendant un reset d'équipe | avant 14:00, tué dans la moitié ennemie de ta lane alors que 2 alliés (dont le jungler ou un bot laner) étaient en base dans les 15 s avant |
| Recall avant objectif après un trade | back sous 40 % PV 0 à 35 s avant l'apparition d'un Dragon ou des Larves, l'adversaire sous 60 %, puis fight perdu à cette fosse avant ton retour |
| Hésitation | vivant, à plus de 2 800 de la fosse 30 s avant l'objectif, sans rien pris par l'équipe ailleurs (de 40 s avant à 15 s après), puis : une tour ou une plaque prise par toi dans les 75 s, ou 1 200 unités parcourues vers la fosse dans les 25 dernières secondes (arrivé trop tard), ou resté dans la rivière sans l'atteindre |
| Mauvaise rotation | avant 14:00, hors de ta lane pendant 30 s ou plus, sans kill ni assist sur deux minutes, et plus de 8 CS et 350 XP perdus sur le vis-à-vis |
| Side lane après 15:00 | la profondeur en side lane dépend de la priorité mid |

### 1.11 Lire l'état de la partie

`src/lib/microReview/winProbability.ts`

Le moteur estime à chaque instant les chances de victoire de ton équipe, **uniquement** pour écarter le « garbage
time ». Le résultat n'est jamais affiché comme une note (règle Riot : aucun MMR alternatif).

```
z = 0,0075 × écart d'or / t + 0,004 × écart d'XP / t + 0,28 × écart d'objectifs     (t = minutes, au moins 5)
P(victoire) = 1 / (1 + e^(−z))
```

Un écart de 3 000 or pèse donc plus à 15 minutes qu'à 35. Un moment pris quand P < 18 % ou P > 85 % est écarté : la
partie était déjà jouée. Seule exception au-dessus de 85 % : le jungler qui recall sous Baron ou force un dive après un
inhibiteur, deux façons de perdre une partie gagnée.

### 1.12 Les fiches Codex (109)

`src/lib/microReview/codex.json`

Par rôle : toutes 63 · jungle 19 · support 10 · ADC 7 · mid 5 · top 5. Par phase : début 47 · milieu 33 · fin 17 · toute
la partie 12. Chaque tag du catalogue a maintenant une fiche pour chaque rôle et chaque phase (la recherche de novembre
2026 a comblé `solo-baron-died`, `bad-rune-choice`, le kiting et les dégâts hors ADC et jungler, et la plupart des erreurs
de milieu et de fin de partie qui renvoyaient à une fiche de phase de lane). Trois tags retombent encore sur une fiche
d'une autre phase en fin de partie : `walked-into-ward`, `xp-deficit` et `behind-on-levels-death`.

Chaque fiche relie **une erreur** (un tag, parfois plusieurs), **une phase** (début, milieu, fin ou toute la partie) et
éventuellement **un rôle** à : un titre, une règle tactique (quoi faire, quand, où), un objectif mesurable pour la
prochaine session, le fondamental à travailler et l'axe du radar concerné. Les règles d'équipe écrites par un coach
passent avant les fiches intégrées. Aucune vidéo n'est montrée sauf des extraits officiels LoL Esports en liste
blanche ; aucun nom de coach ou de créateur n'apparaît.

---

## 2. Les calculs, et ce qu'ils représentent dans l'app

### 2.1 Micro-revue

| Calcul | Formule ou règle | Ce que tu vois |
|---|---|---|
| Déclencheur « mort critique » | ta mort, puis dans les 90 s : ton équipe perd 5 points de chances ou plus, ou un objectif / une tour ; ou la mort correspond à un schéma | un moment dans la file |
| Déclencheur « objectif absent » | l'ennemi prend un monstre épique pendant que tu es vivant, sans ward de toi à moins de 3 500 de la fosse dans les 90 s, sans objectif pris par ton équipe à ±60 s ; le moment est calé 20 s avant la chute | un moment dans la file |
| Déclencheur « retard précoce » | à 10:00, −15 CS ou −400 XP face au vis-à-vis, moins de 2 kills/assists | un moment dans la file |
| Gravité d'une mort | chances perdues + 0,08 × valeur de l'objectif perdu + 0,05 si près d'un objectif + 0,12 si un schéma est reconnu | l'ordre de choix des moments |
| Gravité d'un objectif absent | 0,06 × valeur de l'objectif + chances perdues + 0,02 (+ 0,05 pour une hésitation ou un smite volé) | idem |
| Gravité d'un retard | min(0,3 ; \|écart CS\| / 100 + \|écart XP\| / 4 000) | idem |
| Choix des moments | les plus graves d'abord, au plus 3, à au moins 25 s d'écart, puis remis dans l'ordre du temps | la file « 1 · 2 · 3 » |
| Une mort, une lecture | les schémas sont essayés du plus précis au plus général ; une mort, un objectif perdu ou une lane donnée ne produisent qu'un moment | jamais deux cartes pour le même événement |
| Options du QCM | chaque moment a 1 à 3 contextes ; on prend la meilleure lecture de chaque contexte, puis la deuxième… ; 2 diagnostics + 1 sortie « justifié » quand un contexte en a une, sinon 3 diagnostics ; plus le bouton « Autre cause… » | la carte QCM |
| Apprentissage local | les diagnostics sont réordonnés selon tes choix passés sur ce champion ; un tag choisi 2 fois via « Autre cause… » sur ce champion (ou 3 fois sur ce rôle) remplace le diagnostic le moins probable | une carte qui te ressemble |
| Fiche affichée | celle du diagnostic choisi ; sinon la meilleure pour le tag : règle d'équipe > même phase > même rôle > tag principal > fiche avec vidéo ; jamais une fiche écrite pour un autre rôle | la fiche Codex et « Préparer ma prochaine session » |
| XP | micro-revue complète : 30 XP, une seule fois par partie | la barre d'XP |

### 2.2 Vérification automatique de l'objectif de session

`src/lib/microReview/objectiveVerification.ts`

| Règle | Fondamentaux concernés | Échoue si |
|---|---|---|
| Ward avant les objectifs | vision, setup de vision, vagues et objectifs | un tag « pas de ward » / « objectif sans vision », ou un objectif dont la vision t'incombait sans ward |
| Aucune mort isolée | lecture de la carte, tracking du jungler, usage du brouillard | « pris seul », « mort au Baron » |
| Or dépensé | timing de recall, itemisation, gestion des ressources | « or non dépensé », « back tardif » |
| Pas d'overstay | tempo, prise de décision | « overstay », « mort avant objectif », « dive » |
| CS à 10 min | CS et pathing, gestion des vagues | écart de CS à 10:00 sous −15, ou tag de retard |
| Placement | placement, préparation du fight, rotations, spacing, lecture des menaces | tag de placement, de menace ou d'angle d'engage |
| Trades | trades, calibrage de l'agressivité, connaissance des limites | « mauvais trade » |
| Mécaniques | maîtrise, sorts d'invocateur | skillshot raté, kiting, summoner gâché |

Statut : **non validé** dès qu'un tag de la règle apparaît ; **validé** si la partie a été revue (micro-revue ou review)
sans ce tag ; **à confirmer** sinon. Un objectif sans règle (par exemple Résilience) n'est pas jugé.

### 2.3 Calibration flash

`src/lib/microReview/calibration.ts` — toutes les 15 parties, une question : « quel fondamental t'a le plus coûté ? ».
L'app compare ta réponse à la répartition réelle de tes erreurs taguées sur 4 familles. Tu es « aligné » si ta famille
est à moins de 10 points de la famille qui domine ; pas de verdict sous 5 erreurs taguées.

### 2.4 Note de phase de lane (S à F)

`electron/main/lanePhaseAnalyzer.ts` — sur les 14 premières minutes contre ton vis-à-vis. Chaque écart est ramené sur
0 à 100 (50 = égalité), puis pondéré :

| Composante | Pleine échelle (±50 points) | Poids |
|---|---|---|
| Or à 14:00 | ±1 500 | 25 % |
| CS à 14:00 | ±30 | 20 % |
| Kills et morts en solo | ±25 points par kill net | 15 % |
| Dégâts aux champions à 14:00 | ±3 000 | 10 % |
| Participation aux kills à 14:00 | ±40 points | 9 % |
| XP à 14:00 | ±2 000 | 8 % |
| Plaques | ±12,5 points par plaque nette | 8 % |
| Dégâts aux objectifs (partie entière) | ±5 000 | 5 % |

Note : S ≥ 90, A+ ≥ 75, A ≥ 60, B+ ≥ 45, B ≥ 30, C ≥ 15, D ≥ 0, F en dessous.

### 2.5 Radar des fondamentaux (« Empreinte »)

`src/lib/fundamentalsRadarCore.ts` — compare ta forme récente (moyenne des 15 dernières parties) à ta référence (40
dernières). Chaque valeur est placée entre un minimum et un maximum calibrés :

| Laner | Échelle | Support | Échelle |
|---|---|---|---|
| KDA | 0 → 6 | KDA | 0 → 6 |
| CS/min | 3 → 9 | Participation aux kills | 35 → 80 % |
| Or/min | 250 → 550 | Morts (axe inversé) | 9 → 2 |
| Dégâts/min | 300 → 900 | Vision/min | 0,8 → 3,2 |
| Participation aux kills | 0 → 100 % | Écart de vision avec le support adverse | −15 → +30 |
| First blood | 0 → 100 % | Pinks achetées | 0 → 8 |
| CS à 15:00 | 50 → 140 | Wards détruites | 0 → 6 |
| XP à 15:00 | 4 500 → 9 500 | Impact en fight /min | 400 → 1 300 |
| Or à 15:00 | 3 500 → 7 500 | CC/min | 0 → 3 |

**Impact en fight /min** = soins et boucliers sur les alliés + dégâts aux champions + 40 % des dégâts absorbés. Cette
somme met à égalité les supports enchanteurs, mages de poke et engage (moyennes mesurées : 895, 848 et 851).

### 2.6 Statistiques → Analyse

`src/lib/statsInsights.ts` — sur tes 50 dernières parties : ton pool (parties, winrate, KDA, CS/min, morts), ce qui
change entre victoires et défaites (le levier n°1), winrate selon la durée et l'heure, winrate après une victoire et
après une défaite, plus longue série de défaites. Une case de moins de 3 parties est grisée plutôt que d'afficher un
chiffre trompeur.

### 2.7 Assistant (moteur de coaching)

`electron/main/assistant/`, design dans `docs/moteur/MOTEUR_REGLES.md`

| Calcul | Règle | Ce que tu vois |
|---|---|---|
| Indicateurs par partie | CS/min, CS à 10 et 14, écart d'or à 10 et 14, morts avant 10 et 14 min, vision/min, KDA, KP, note de lane, KPI de review, objectif respecté, erreurs, **pinks achetées** et **part de la partie passée mort** (lues dans le match en cache) | la base de tout le reste |
| Tendances personnelles | moyenne, écart-type, 5 dernières parties contre les précédentes, z-score, pente sur 10 parties | « comparé à ta moyenne sur 12 parties » |
| Indice de performance | moyenne des z-scores des stats mesurées (pas des notes que tu te donnes) | biais d'auto-évaluation, meilleures et pires parties |
| 41 règles déclaratives | par exemple : morts précoces dans 3 des 5 dernières parties, CS en baisse, reviews en retard, objectif sans progrès depuis 4 sessions, tilt (3 défaites d'affilée et plus de 2 h de jeu → pause de 30 min) ; depuis novembre 2026 : temps passé mort ≥ 14 % de la partie, support sous 2 pinks ou 1,8 de vision/min, jungler sous 0,7 de vision/min, aucune pink dans 4 parties sur 5, 2 défaites d'affilée → pause de 30 min, longue session dès la 4e partie, 6 min de marche après 1 h de jeu, nouveau champion (moins de 5 parties) | 3 conseils après la partie, brief de session, bilan hebdo |
| Repères calibrés | les seuils des règles de novembre 2026 viennent du taux de victoire par tranche et par rôle sur 3 004 parties classées en cache (patchs 16.1 à 16.10) : sous 5 % du temps passé mort → 84 % de victoires, 8-11 % → 50 %, 14 % ou plus → 31 % ou moins ; support sans pink → 41 %, 2 ou plus → ~51 % | des seuils qui séparent vraiment les parties gagnées des perdues |
| Regroupement en problèmes | 18 problèmes (lane, morts, farm, vision, setup d'objectif…) ; plusieurs indices du même problème se combinent en « noisy-OR » : 1 − Π(1 − confiance) | un seul message par problème, avec toutes ses preuves |
| Priorité | urgence × confiance (plafond 0,97) × poids appris × impact sur la victoire × persistance × actionnabilité (1, ou 0,6 sans critère mesurable) ; ×0,5 si déjà montré dans les 3 derniers jours | le **Focus** |
| Impact sur la victoire | régression logistique locale sur tes parties, à partir de 15 parties avec au moins 4 victoires et 4 défaites ; sinon valeur par rôle fixée d'avance | « ce qui compte pour toi » (corrélation, pas garantie) |
| Poids appris | 👍/👎 sur chaque conseil : loi Beta(2, 2), multiplicateur borné entre 0,4 et 1,6 ; les conseils de bien-être ne sont jamais repondérés | un ordre qui s'adapte |
| Expériences | un objectif devient un test sur 5 parties : **acquis** si le critère tient dans 70 % des parties, **en progrès** si nettement mieux que ta référence, **sans effet** sinon ; 2 « acquis » d'affilée = fondamental diplômé ; 2 « sans effet » = fondamental voisin proposé ; un problème acquis s'efface 14 jours | la page **Mon plan** |
| Réévaluation | un fondamental noté par toi dont la mesure s'écarte de ta référence (\|z\| ≥ 1,5) ; 3 écarts = bandeau « refais ton bilan » | le bandeau du tableau de bord |
| Partie à revoir en priorité | défaite serrée (moins de 3 000 or d'écart final) > au moins 2 erreurs graves > plus grand écart à ta moyenne > la plus récente | le bouton « Revoir » |
| Meilleur et pire toi | tes 20 % meilleures et 20 % pires parties (indice de performance) comparées | le bilan hebdo |
| Insights hebdo | champion à sortir du pool (10 parties, moins de 40 %, KDA sous ta moyenne) ; heure défavorable (après minuit, 15 parties, 10 points d'écart) ; fatigue de série (parties 4+ sous les 3 premières, sur 3 sessions) | le bilan hebdo |

### 2.8 Automatismes après la partie

| Automatisme | Règle |
|---|---|
| Détection d'erreurs | dès que la chronologie de la partie est en cache |
| Signet vidéo | une erreur de gravité 3 avec un enregistrement fiable reçoit un signet à t − 15 s |
| Notes pré-remplies | la review se pré-remplit des morts, objectifs, tours, multi-kills et erreurs graves, avec un badge « Pré-rempli » |
| Clôture de session | une session sans partie depuis 45 min se ferme seule (vérifié toutes les 5 min), conclusion pré-remplie |
| XP | review 50, micro-revue 30, bilan 100 |

---

## 3. Comment le Labo d'erreurs identifie tes erreurs

Le Labo (Statistiques → Labo d'erreurs) réunit **toutes** les erreurs taguées sur tes parties. Elles arrivent par trois
chemins, puis le Labo les compte, les classe et les relie à une fiche.

### 3.1 Trois sources

1. **Le détecteur automatique** : 16 règles appliquées à la chronologie Riot dès qu'elle est en cache. Ces erreurs sont
   marquées « auto » (filtre « Afficher les auto-détectées »).
2. **La micro-revue** : chaque diagnostic que tu choisis dans le QCM est une erreur du catalogue. Une réponse
   « justifié » ne crée **aucune** erreur.
3. **Ton tag manuel** : pendant la review ou sur la vidéo, tu ajoutes une erreur à une seconde précise, avec sa gravité
   (1 à 3) et une note. Tu peux aussi créer ton propre tag.

Le catalogue compte 27 erreurs. Les 11 qui ne sont pas détectables dans les données (summoner gâché, skillshot raté,
kiting, ward ennemie traversée, bush non vérifié, mauvaise lecture des menaces, angle d'engage, maximisation des
dégâts, synchronisation de vague, objectif sans vision, runes) ne viennent que de la micro-revue ou de ton tag.

### 3.2 Les 16 règles automatiques

`electron/main/mistakeDetector.ts` (M1–M4) et `electron/main/mistakeRules.ts` (M5–M19)

| # | Erreur | Règle exacte | Gravité | Exemple |
|---|---|---|---|---|
| M1 | Mort avec de l'or non dépensé | ta mort avec plus de 1 500 or en poche au dernier relevé | 2 ; 3 au-delà de 2 500 | mort à 18:42 avec 1 850 or → gravité 2 |
| M2 | Dive | mort à moins de 700 d'une tour ennemie (extérieure, intérieure ou d'inhibiteur) | 3 | mort à 650 de la T2 mid adverse |
| M3 | Back tardif | arrivée en fontaine avec plus de 2 000 or, aucun achat depuis plus de 4 min | 2 | base à 22:10 avec 2 300 or, dernier achat à 17:40 |
| M4 | Overstay | mort hors fight d'objectif (aucun monstre épique à ±30 s), après avoir pris une plaque dans les 20 s, ou à plus de 60 % du chemin vers la fontaine adverse | 2 ; 3 si les deux | mort à 70 % du chemin dans la jungle adverse, sans objectif autour |
| M5 | Mort avant un objectif perdu | l'ennemi prend Dragon, Baron, Héraut ou Larves dans les 60 s après ta mort | 2 ; 3 pour Baron, et toujours 3 pour un jungler | mort à 24:10, Baron adverse à 24:35 → gravité 3 |
| M6 | Pas de ward avant un objectif | aucune ward posée dans les 90 s avant un objectif (après 5:00, Larves exclues) ; support et jungler pour tous les objectifs, laner seulement pour ceux perdus ; rien si tu étais mort dans ce créneau | 2 (support, jungler) ; 1 (laner) | support sans ward avant le Dragon de 17:20 → erreur datée de 15:50 |
| M7 | Trinket oublié | plus de 4 min sans ward (2 min 30 en support), +1 min par mort dans l'intervalle, à partir de 3:00, 3 fois par partie au plus | 1 | dernière ward à 12:00, suivante à 18:30, une mort entre les deux → erreur à 16:00 |
| M8 | Mort au Baron | mort à moins de 1 800 de la fosse du haut une fois le Baron apparu (20:00 ; avant, la fosse abrite les Larves et le Héraut), au plus un allié à moins de 3 000 | 3 | mort seul devant le Baron à 27:00 |
| M9 | Pris seul | après 14:00, aucun objectif à ±30 s, 2 ennemis ou plus sur le kill, aucun allié à moins de 2 500 | 2 | tué par 3 ennemis en side lane à 21:05 |
| M10 | Mauvais trade | avant 14:00, tué seul par ton vis-à-vis direct | 2 | solo-kill de ton adversaire de lane à 6:12 |
| M11 | Mauvais placement | premier mort d'un fight (aucun kill dans les 15 s avant ta mort, au moins 3 kills dans les 15 s après) | 2 pour mid et ADC ; 1 sinon | ADC qui meurt en premier dans un fight à 5 kills |
| M12 | Mauvaise ouverture de lane | laner, à 5:00 : mort avant 3:25, ou −8 CS, ou −400 or face au vis-à-vis | 2 ; 3 si deux raisons | −9 CS et −450 or à 5:00 → gravité 3 |
| M13 | Retard de CS à 10 min | laner : −15 CS ou plus à 10:00 face au vis-à-vis (sbires et jungle) | 2 ; 3 à −25 | 62 CS contre 80 → −18, gravité 2 |
| M14 | Retard d'XP | laner : 2 niveaux de moins que le vis-à-vis à 10:00 ou 15:00, une fois par partie | 2 ; 3 à 3 niveaux | niveau 9 contre 11 à 15:00 |
| M15 | Mort quand l'objectif est tombé | l'ennemi prend Dragon, Baron, Héraut ou Larves plus de 60 s après ta mort (M5 couvre la minute d'avant) et au moins 2 s avant ta réapparition (niveau lu sur les LEVEL_UP, formule du wiki ; les niveaux 19 et 20 de la quête top comptent comme le niveau 18, faute de valeur publiée) ; rien si tu poses une ward ou fais un kill entre les deux (résurrection) | 2 ; 3 pour Baron et Ancien | niveau 18 mort à 50:00 (71,5 s de réapparition), Baron adverse à 51:05 → gravité 3 |
| M19 | Mort en retard de niveaux | laner ou jungler, mort entre 0:55 et 3:55 contre un adversaire d'au moins 1 niveau de plus | 2 ; 3 à 2 niveaux | tué niveau 2 par un niveau 3 à 3:40 |

Une même mort peut produire plusieurs erreurs **de tags différents** quand elle prouve plusieurs choses. Exemple : un
mid laner tué seul par son adversaire de lane, niveau 2 contre 3, à 3:15 (partie 16.x), reçoit « mauvais trade » (M10), « mort
en retard de niveaux » (M19), puis à 5:00 « mauvaise ouverture de lane » (M12, raison : mort avant 3:25).

### 3.3 Ce que la micro-revue ajoute

Exemple, sur une partie perdue en top lane (c'est le scénario du test de bout en bout `tests/e2e/microReview.spec.ts`) :

1. Le détecteur de la micro-revue retient la mort de 25:28 près du Baron, tuée par 3 ennemis sans allié autour : l'équipe
   adverse prend le Baron 30 s plus tard.
2. La carte affiche « 25:28 · Rivière haute — mort 30 s avant la perte du Baron », avec trois choix : « Mauvais setup
   d'objectif » (contexte objectif, fiche sur la préparation des objectifs), « Pris seul : minimap pas lue » (contexte
   mort isolée) et « 50/50 de smite justifié » (la sortie justifiée), plus « Autre cause… ».
3. Tu choisis « Mauvais setup d'objectif » : une erreur « pas de ward avant un objectif » est créée à 25:28, gravité 3
   (une mort critique vaut 3, les autres moments 2). La fiche Codex s'affiche avec son objectif mesurable.
4. Si tu avais choisi la sortie justifiée : aucune erreur, et la mort ne compte pas contre toi.

Les règles automatiques n'ont rien mis sur cette mort-là pour la vision : M6 ne reproche jamais une ward à un joueur mort
dans les 110 s avant l'objectif.

### 3.4 Ne jamais compter deux fois la même erreur

`electron/main/mistakeDedupe.ts`

- Deux erreurs du **même tag** à 3 s ou moins d'écart sont la même erreur : le détecteur ne recrée jamais une erreur que
  tu as déjà (qu'elle vienne de lui, de la micro-revue ou de toi).
- Quand tu réponds à la micro-revue avec un tag déjà détecté à ±20 s (ou de 90 s avant à 30 s après pour un objectif
  absent), l'erreur existante est **confirmée** au lieu d'être dupliquée. Si tu changes ta réponse, l'erreur créée par
  la réponse précédente est retirée et une erreur confirmée redevient « auto ».
- Les objectifs ont une fenêtre plus large parce que la micro-revue les date 15 à 30 s avant la chute de l'objectif,
  alors que la règle M6 les date 90 s avant.

### 3.5 L'app apprend de tes suppressions

`electron/main/mistakeTuning.ts` — si tu supprimes 3 fois une erreur auto-détectée du même tag, ses détections
suivantes démarrent un cran de gravité plus bas pour toi (jamais sous 1).

### 3.6 Ce que le Labo calcule ensuite

`src/lib/mistakeInsights.ts`, `electron/main/ipc/mistakes.ipc.ts`

| Calcul | Règle |
|---|---|
| Familles | 4 familles : Positionnement et morts, Vision et carte, Tempo et économie, Mécaniques et laning ; un tag perso est rangé par sa catégorie |
| Classement | par nombre d'occurrences ; part du total ; nombre de parties touchées |
| Coût en victoires | winrate des parties **avec** l'erreur contre winrate des parties analysées **sans** elle ; au moins 2 parties de chaque côté, sinon « — » |
| Garbage time | une occurrence prise quand la partie était déjà jouée (chances sous 18 % ou au-dessus de 85 %) compte dans les totaux mais pas dans le coût en victoires ; une erreur venue d'une réponse de micro-revue a déjà passé ce filtre |
| Moment de la partie | début 0–14:00, milieu 14:00–25:00, fin 25:00+ |
| Tendance | par jour si l'historique couvre au moins 5 jours, sinon par partie |
| Derniers moments | les 3 plus récents, avec « Revoir » (la vidéo à la seconde) et « Travailler cette erreur » (une expérience mesurée) |
| Prescription | la fiche Codex du tag, pour ton rôle et la phase où l'erreur revient le plus |

Exemple : sur 30 jours, 40 erreurs dans 12 parties analysées. « Pris seul » apparaît 10 fois (25 %) dans 6 parties :
2 victoires sur 6 avec, 4 sur 6 sans. Le Labo affiche 33 % contre 67 % : cette erreur te coûte 34 points de winrate. Si
l'une des 6 parties ne la contenait qu'en garbage time, elle sort des deux côtés du calcul (5 parties « avec »).

### 3.7 Limites connues

- Les positions et l'or sont des relevés par minute : une mort peut être lue avec l'or ou la position d'un relevé
  vieux de 59 s au plus.
- Une ward compte où que tu l'aies posée (Riot ne donne pas sa position) pour M6 et M7.
- Le « premier mort d'un fight » compte les kills des deux équipes.
- Le bouton « détecter les erreurs » du lecteur vidéo n'applique pas encore le décalage de gravité appris en 3.5 (la
  détection automatique, si), et il recrée une erreur auto que tu avais supprimée : correction listée dans
  `docs/archive/RAPPORT_FONCTIONNALITES_2026-11-18.md`.
