# Moteur assistant local + micro-review guidée

Zéro LLM, zéro appel réseau en plus de ce que l'app fait déjà (le timeline Riot
est lu depuis `MatchCache`, rempli par `ensureMatchCache`). Tout est du
TypeScript déterministe, < 5 ms par partie.

Analyse **après la partie uniquement** (conforme à la politique Riot : aucune
aide en jeu, aucune estimation de MMR/classement alternatif — la « probabilité
de victoire » ne sert qu'à écarter le garbage time, elle n'est jamais affichée
comme une note).

## Ce qui existe déjà et qu'on étend

| Existant | Rôle dans ce lot |
|---|---|
| `electron/main/mistakeDetector.ts` + `mistakeRules.ts` | détection auto → reste la source des tags auto ; le nouveau détecteur ne crée **pas** de `Mistake` lui-même |
| `src/lib/mistakeInsights.ts` (familles `deaths/vision/tempo/mechanics`, `tagFamily`) | **réutilisé tel quel** comme taxonomie des familles de la maquette |
| `mistake-stats:occurrences` | reçoit `garbageTime` par occurrence ; `rankMistakes` les exclut des ratios avec/sans |
| `coach:start-tag-experiment`, `CoachingExperiment` | action « travailler dessus » inchangée |
| `stats.ipc.ts → ensureMatchCache` | exporté pour la micro-review |
| `assistant/problems.ts` (tag → problème → fondamental) | sert à relier une fiche Codex à un objectif de session |
| `ReassessmentBanner` / `/assessment` | remplacé par le **Calibration flash** (le formulaire long reste accessible) |

## Correspondance maquette → tags réels (pas de taxonomie parallèle)

| Slug maquette | Tag(s) existant(s) | Famille (`tagFamily`) |
|---|---|---|
| `no-ward` | `no-ward-pre-obj` (+ `no-vision-objective`) | vision |
| `trinket` | `forgot-trinket` | vision |
| `death-obj` | `death-before-objective` | deaths |
| `overstay` | `overstay` | tempo |
| `positioning` | `bad-positioning` | deaths |
| `caught` | `caught-out` | deaths |
| `cs-deficit` | `cs-deficit` (+ `xp-deficit`) | mechanics |
| `gold` | `unused-gold` | tempo |
| « entré sans prio de lane » | `bad-wave-sync` | tempo |
| « rappel annulé » | `late-back` | tempo |
| « 1v1 mécanique » | `bad-trade` | mechanics |
| « spike objet/niveau ignoré » | `bad-threat-assessment` | deaths |
| « flanc non wardé » | `face-checked` (`no-vision-objective` près d'un objectif) | vision |

Familles de la maquette = `MistakeFamily` existant. Catégories DB
(`macro/micro/vision/economy/draft`) inchangées.

## A. `AnomalyDetector` — `src/lib/microReview/anomalyDetector.ts`

Entrée : Match-V5 + Timeline (objets déjà parsés) + sélecteur joueur. Sortie :
≤ 3 `CriticalMoment` triés par gravité + une courbe P(win) par frame. Faille de
l'invocateur en mode classique uniquement (`isSupportedGame` : `mapId` 11,
`gameMode` CLASSIC) — ailleurs la géométrie et les timers n'ont pas de sens,
et la micro-review le dit (`reason: 'unsupported-mode'`).

- **P(win)** : `sigmoid(0.0075·ΔGold/t + 0.004·ΔXP/t + 0.28·ΔObj)`,
  `t = max(minute, 5)`, ΔObj pondéré (tour 1, dragon 1, héraut 0.5, larve 0.3,
  inhib 1.5, Baron 2, Atakhan 1, Ancestral 2.5). L'or et l'XP n'existent qu'aux
  relevés (1/min) ; les objectifs ont un horodatage exact. L'estimation « juste
  avant l'action » est donc le dernier relevé + les objectifs tombés strictement
  avant (`winProbabilityTrack.before`). Candidat ignoré si cette valeur **non
  arrondie** est < 0.18 ou > 0.85 (garbage time), sauf au-dessus de 0.85 les deux
  motifs jungle V6 (`GARBAGE_CEILING_EXEMPT` : recall sous Baron, dive après un
  inhibiteur), qui décrivent justement une partie gagnée gâchée. La courbe stockée
  (`winProb`) est arrondie à 3 décimales.
- **Géométrie** (carte 15000²) : fosse Baron/larves (5007,10471), Dragon
  (9866,4414), rayon 2800. Côté bleu = `x+y < 14500`, côté rouge = `x+y > 15500`
  (bande rivière entre les deux) ; la maquette inversait les deux seuils, on
  suit la carte réelle (base bleue en (0,0)). Les deux fosses (1500 unités
  autour du centre) sont de la rivière pour les deux équipes — sans cette règle
  la fosse du dragon (x+y = 14280) serait « chez les bleus ». Zones : lanes
  TOP/MID/BOT, rivière haute/basse, jungle alliée/ennemie, bases.
- **Positions** : les relevés Riot sont à la minute (le dernier est pris à la
  fin de la partie, pas à la minute pleine). Entre deux relevés on interpole le
  long de ce que les événements prouvent : un champion marche jusqu'à l'endroit
  où il meurt, y reste jusqu'à son respawn (timer par niveau × facteur de durée
  de partie), puis repart de sa fontaine. `WARD_PLACED` n'a pas de position : on
  prend celle du joueur à l'instant de la pose.
- **Déclencheurs** : (1) mort critique — dans les 90 s qui suivent, P(win)
  baisse d'au moins 0.05 (objectifs jusqu'à T+90 s, or/XP du dernier relevé de
  la fenêtre) ou un objectif neutre / bâtiment est perdu ; rien de ce qui
  précède la mort ne compte ; (2) absent sur objectif / vision ; (3) retard
  early à 10:00 (csDiff < −15 ou xpDiff < −400 vs adversaire direct, sans ≥ 2
  participations aux kills avant 10:00). Faits capturés : assisteurs, alliés
  < 2500 (vivants, ou tombés dans les 10 s), ennemis impliqués, or en poche,
  ward dans les 60 s, distance aux fosses, secondes depuis le dernier kill/tour
  du joueur, objectif perdu + délai.
- **Limites de résolution** (le détecteur se tait quand les données ne prouvent
  rien) : un détour à l'intérieur d'une minute qu'aucun événement ne marque est
  invisible (ex. un support dans la fosse qui survit puis recall avant le relevé
  suivant) ; les camps sont un compteur par minute (un camp pris dans la même
  minute annule l'overchase) ; pas d'événement de recall, de dégâts ni de wave ;
  le shutdown est estimé par la série de kills.
- Tous les seuils sont dans `DETECTOR_SPEC`, chacun testé de part et d'autre.

## B. `SmartQCMGenerator` — `src/lib/microReview/smartQcm.ts`

Par moment : résumé factuel structuré (clé i18n + paramètres) et 3 diagnostics
priorisés depuis la matrice géométrie (objectif / or / isolé / 1v1 / teamfight /
absent / retard early), plus le 4ᵉ bouton obligatoire « Autre cause… » (toutes
les familles et tous les tags + « + tag personnalisé / note coach »).
Issue `justified` : **aucune** ligne `Mistake` créée → ne compte pas dans les
stats. Apprentissage local : fréquences par (rôle, champion) dans
`MicroReviewAnswer` ; un tag choisi ≥ 2 fois via « Autre cause » pour ce
couple (ou ≥ 3 fois pour le rôle) remplace la dernière option « erreur ».

Une carte montre ses deux diagnostics les plus probables et, dès qu'un de ses
contextes en a une, la sortie `justified` (un second contexte ne l'évince
jamais) ; trois diagnostics quand aucun contexte n'en a. « Autre cause… »
propose aussi « Ce n'était pas une erreur : décision assumée » (`justified`,
raison `assumed`) : chaque carte a donc une sortie qui ne compte pas.

## C. `AscendCodex` — `src/lib/microReview/codex.json` + `codex.ts`

`{ id, role, mistakeSlug, phase, radarAxis, fundamentalId, headline, tacticalRule,
drillObjective, videoRef? }` (textes `{fr,en}`). Lookup : (rôle, slug, phase) →
(any, slug, phase) → (rôle, slug, *) → (any, slug, *). Affiché : après une
réponse QCM, dans l'aside du Mistake Lab (phase dominante), dans le bilan de la
semaine (Dashboard) avec « Préparer ma prochaine session » (objectif + note
pré-remplis sur `/session`). Règles d'équipe ajoutées par le coach (Supabase).

## D. Automatisation — `objectiveVerification.ts`, `calibration.ts`

- Règle de vérification auto post-partie par fondamental d'objectif de session
  (ex. `vision_control` : 0 tag `no-ward-pre-obj` ET ≥ 1 ward dans les 90 s avant
  chaque objectif disputé dont la vision revenait au joueur — `accountable` : tous pour
  un support ou un jungler, ceux perdus pour un laner, jamais quand il était mort dans
  les 110 s, pas avant 5:00, pas les larves). Résultat affiché dans la Revue et pré-remplit
  « objectif respecté ».
- **Calibration flash** toutes les 15 parties : « Quel fondamental t'a le plus
  coûté récemment ? » (4 familles) → écart perception / données micro-review.
  Les scores fondamentaux restent calculés en continu (`coach:suggested-scores`).

## Stockage

- Prisma (local, migrations SQL écrites à la main, jamais `migrate dev`) :
  `GameAnalysis` (analyse en cache, versionnée par `ANALYSIS_VERSION` ;
  `reviewXpAwarded` : XP une seule fois par partie), `MicroReviewAnswer`
  (`mistakeOrigin` : `created` / `confirmed-auto` / `existing` — ce que
  re-répondre peut défaire), `CalibrationFlash`.
- Une erreur = une ligne (`electron/main/mistakeDedupe.ts`) : la réponse
  confirme une erreur auto-détectée du même tag à ±20 s — de −90 s à +30 s pour
  un moment d'objectif, l'auto `no-ward-pre-obj` étant daté 90 s avant
  l'objectif — et l'auto-détecteur ne recrée jamais une erreur déjà présente,
  quel que soit l'ordre. L'écriture d'une réponse est un seul lot atomique
  (lectures d'abord, puis une transaction groupée).
- Supabase : `micro_review_answers`, `micro_review_verdicts`,
  `team_codex_rules` — migration `20261117210000_micro_review_coach.sql`,
  **appliquée en production le 17/11/2026 avec l'accord de l'utilisateur**. Le
  client tolère l'absence des tables (autres environnements).

## UI

- **Revue** : bloc « Micro-review 45 s » en tête (VOD à gauche, extrait de 15 s
  démarrant à t−12 s ; file des 2–3 moments ; carte QCM + conseil Codex à
  droite ; +XP Ascend à la fin).
- **Mistake Lab** : prescription Codex dans l'aside.
- **Dashboard** : carte Codex dans le bilan de la semaine + Calibration flash. (La carte « Session basse énergie » du
  Dashboard, de la Session et de Statistiques → Analyse est retirée depuis le 18/11/2026 : voir la dernière section.)
- **Coaching** : réponses QCM du joueur par timestamp VOD, valider/corriger,
  règles d'équipe du Codex.

## Addendum — premiers cas réels (clips coach)

- Codex : champs `mistakeSlugs` (tags secondaires) et `videoExamples` (`{ title, url, coachNote }`, FR/EN),
  affichés en tuile cliquable « Voir l'exemple en vidéo » (navigateur système) dans la Revue et l'aside du Mistake Lab.
  Fiches `codex_macro_obj_tempo_crossmap` et `codex_jgl_3camps_prio_cycle` ajoutées à `codex.json`
  (pas de fichier `codex-seed.json` séparé : la base locale est `codex.json`). Correspondance des slugs de la
  maquette : `death-obj` → `death-before-objective`, `overstay` → `overstay`, `cs-deficit` → `cs-deficit` ;
  axes radar `KP` → `kp`, `Gold@15` → `gold15`.
- Détecteurs ajoutés comme `facts.pattern` sur les déclencheurs existants (la contrainte `trigger` de
  `micro_review_answers` en production reste valide, pas de nouvelle migration) :
  `tempo-hesitation` (absent-objective), `jungle-overchase` et `jungle-counter-tempo` (early-deficit, jungle, 2:30–8:00).
- QCM : l'option liée à une fiche Codex (`codexId`) reste le choix [1] et n'est jamais remplacée par l'apprentissage ;
  sa fiche (avec clips) s'affiche après la réponse, et ses clips sont visibles avant, comme modèle d'exécution.
- Égalité dans `codexFor` : la fiche avec clips gagne ; une fiche du rôle exact qui ne liste le tag qu'en secondaire
  bat une fiche « tous rôles » (évite le conseil de last-hit de lane pour un jungler).

## V2 — Confidentialité vidéo & fiches calibrées sur des matchs pro

- **Règle des droits vidéo** : seules des diffusions officielles LoL Esports peuvent apparaître dans l'UI (aucune URL,
  miniature, chaîne ni mention de créateur tiers / co-streamer). `codex.ts` : `isOfficialVideo` exige
  `source: 'LoL Esports'`, une URL `https://www.youtube.com/watch?v=…` (pas de /clip, /shorts, chaîne) dont l'id est dans
  `OFFICIAL_LOLESPORTS_VIDEO_IDS` (une URL seule ne prouve pas la chaîne : liste blanche vérifiée à la main), et un segment
  `startSeconds < endSeconds`. Le chargeur (`sanitizeVideos`) retire tout le reste ; le composant re-vérifie avant rendu.
  Ajouter une vidéo = vérifier qu'elle vient de la chaîne officielle, puis ajouter son id à la liste.
- **Lecteur** : miniature officielle (i.ytimg.com) puis lecteur intégré limité au segment (`embed?start=…&end=…`).
- **Fiches** : les 2 fiches « cas réels » précédentes (clips tiers) sont supprimées et remplacées par 6 fiches
  (tempo vs greed de tour, 3 camps → invade, intégrité du cycle, setup d'objectif, 1-3-1, Baron powerplay).
  La fiche tempo reste textuelle (`videoExamples: []`, source confidentielle). Les 33 fiches génériques restent.
- **Déclencheurs QCM** (`qcmTrigger` → option liée `codexId`, toujours choix [1]) : tower greed / cross-map manqué → overstay ;
  enemy objective sans setup → no-ward-pre-obj ; overchase / contre-tempo jungle → overstay ; full clear passif avec prio mid/bot
  → cs-deficit (nouveau pattern `jungle-passive-clear`) ; mort en rotation jungle 14–25 min → bad-positioning (1-3-1) ;
  mort sous Baron allié → bad-positioning (Baron).

## V3 — 5 détecteurs + 8 fiches (analyses de coachs tiers → textuelles)

- 8 fiches ajoutées à `codex.json`, toutes avec `videoExamples: []` et sans nom de créateur. Slug `mechanics`
  (absent de la Mistake Library) → `bad-trade` ; axes `CS@15` → `cs15`, `KDA` → `kda`, `CS/m` → `csm`,
  `XP@15` → `xp15`, `DMG/m` → `dmgm`.
- Détecteurs (patterns, toujours sur les 3 déclencheurs existants) :
  `tempo-late-recall` (fight perdu haut sur la carte pendant que le joueur est en base après un recall tardif
  avec > 1500 g ; tempo line D = (x + y) / 30000, inversée côté rouge), `tempo-front-isolated` (mort seul à
  D > 0.65 avec 3+ alliés à D < 0.30), `gank-timer` (laner tué avec le jungler adverse à 2:25-3:00, ou
  3:15-4:25 sans deep ward sur un camp ennemi), `fed-carry-first` (plus gros or de l'équipe et bounty ≥ 450 g, soit 2
  kills d'affilée, ou KDA > 4 avec > 25 % de l'or ; premier mort d'un fight à 3+ ennemis perdu dans les 60 s), `jungle-window-unpunished`
  (jungler adverse à > 8000 unités, 45 s sans objectif, takedown ni sortie de son côté, entre 2:30 et 12:00,
  joueur vivant),
  `bad-rotation` (laner < 14 min, > 30 s hors lane sans kill/assist, > 8 CS et > 350 XP perdus, parti vivant et
  encore hors lane au relevé suivant).
- Limites : frames Riot toutes les 60 s (positions interpolées) ; pas d'événement de recall dans la timeline
  (le recall tardif est déduit de la position et de l'or) ; le shutdown est estimé par la série de kills.
- QCM : chaque `qcmTrigger` est l'option [1] de son contexte (`tempo-line`, `gank-timer`, `carry-first`,
  `jungle-window`, `bad-rotation`, `duel-early` < 14 min → trading + côté de wave, `outnumbered` < 25 min →
  sélection de fight, `gold` après sa propre action → double dépense de tempo).

## V4 — 2 détecteurs timeline, protocole basse énergie, 6 fiches

- **Terminologie** : « Fenêtre de tempo à action unique » partout (fiche
  `codex_tempo_single_action_window_wave_cheating`, pattern `jungle-window-unpunished`, contexte `jungle-window`) ;
  aucun nom de coach ou de créateur dans le code ni l'UI ; `videoExamples: []` pour les 6 nouvelles fiches.
- **`pit-chokepoint`** (`SUPPORT_TANKING_BARON_INSTEAD_OF_ZONING`) : fight = ≥ 2 kills à < 3000 d'une fosse, espacés de
  ≤ 20 s, à partir de 14:00 ; joueur = support ou mage de contrôle mid (`championClasses.ts`) ; à l'intérieur de la
  fosse (< 900 du centre) pendant les 15 s avant le premier kill. Mort dans le fight (à < 3000 de la fosse) → pattern
  porté par la mort critique ; survie → moment `absent-objective` 15 s avant, si le fight est perdu ou l'objectif pris
  dans les 60 s. Appliqué aux deux fosses (la règle du goulet vaut pour le dragon).
- **`mid-roam-plates`** (`UNPROFITABLE_MID_ROAM_PLATES_LOST`) : MID, avant 14:00, sur la lane au relevé k, parti vivant,
  à ≥ 2600 de la diagonale (|x − y|) et hors base au relevé k+1, aucun kill/assist sur [k, k+2], ≥ 1 plaque mid perdue
  et ≥ 10 CS perdus sur le vis-à-vis. Remplace `bad-rotation` pour le même roam.
- **Session basse énergie** (retirée le 18/11/2026, voir la dernière section ; `lowEnergy.ts`, sans timeline) : 2 défaites d'affilée dans la session (ou dans la même
  séance avant d'en lancer une), ou créneau horaire sous 45 % de victoires (ratio exact, ≥ 3 parties) → carte 1 clic
  « Protocole basse énergie » sur le Dashboard, la Session et les panneaux « Selon l'heure » / « Gestion du tilt ».
  L'activation met `resilience` en premier objectif et garde la note du joueur. Dans la micro-review d'une partie
  jouée dans ces conditions, le protocole est le choix [2] de chaque mort (tag `caught-out`, celui que vérifie la
  règle d'objectif `low-energy`).
- **6 fiches** (53 au total) : 3 tempos → `bad-positioning` / `resource_management` ; asymétrie de pression →
  `caught-out` / `lane_assignment` ; choke point → `bad-positioning` / `prefight_positioning` ; archétypes mid →
  `bad-trade` / `matchup_knowledge` ; roam check → `cs-deficit` / `roam_gank_timing` ; basse énergie → `caught-out` /
  `resilience`.

## V5 — phase de lane : audit de dédoublonnage, 3 détecteurs (+ 2), 10 fiches (18/11/2026)

**Doublons internes trouvés et fusionnés** (l'ancien id reste résolu par `CODEX_ALIASES` dans `codex.ts`) :
`trade-any-early` → `codex_mechanics_trading_4laws_cooldown_punish` (« trade dans son cooldown », deux fois) ;
`overstay-any-mid` → `codex_tempo_single_action_window_wave_cheating` (« après un gain : convertis ou reset »,
deux fois). Les fiches fusionnées prennent la place des génériques : elles restent la fiche par défaut de leur tag.

**Les 10 fiches du brief** (56 fiches au total, `videoExamples: []`, aucun nom de coach ni jargon propriétaire) :

| Fiche V5 | Décision | Fiche | Déclencheur QCM |
|---|---|---|---|
| triple_cd_sync | fusionnée (lois 6-7) | `codex_mechanics_trading_4laws_cooldown_punish` | `duel-early`, choix [1] |
| hit_or_miss | nouvelle, tag `whiff-skillshot` / early | même id | aucun (indétectable) : « Autre cause… » |
| levelup_timers | nouvelle, tag `bad-threat-assessment` / early | même id | `level-up-spike` |
| two_step_posturing | fusionnée (règles 3-4) | `codex_mechanics_lane_quadrants_minion_wall` | `duel-early`, `range-melee` |
| lane_volatility | nouvelle, tag `bad-trade` | même id | `gank-timer` sous 50 % PV, choix [2] |
| back_priority / cheater | fusionnée | `overstay-any-early` | `back-timer-missed`, `cheater-recall` |
| micro_movements | nouvelle, tag `bad-engage-angle` / early | même id | aucun (indétectable) : « Autre cause… » |
| cs_priority / proxy | fusionnée | `cs-any-early` | `early-cs` |
| range_vs_melee | nouvelle, tag `bad-trade` | même id | `range-melee-volatility` |
| attacking_tp / slow dive | fusionnée | `dive-any-early` | `tower-dive-one-for-one` |

Les `qcmTrigger.condition` du brief n'existent pas tels quels : un déclencheur est ici un motif du détecteur →
un contexte QCM → une option liée à une fiche (`codexId`). Un motif = un contexte ; une raison de QCM = une seule fiche
(testé). « Niveau Challenger » retiré (nom de rang) ; « vague » écrit « wave ».

**Détecteurs** (timeline seulement ; aucune rune, passif, wave ni recall dans les données Riot) :
- `tower-dive-one-for-one` (`RUSHED_TOWER_DIVE_ONE_FOR_ONE`) : kill du vis-à-vis à ≤ 850 d'une T1 ennemie encore
  debout, mort ≤ 4 s après, jungler ennemi ni crédité ni dans `victimDamageReceived`, avant 14:00.
- `level-up-spike` : tué par le vis-à-vis ≤ 10 s après son `LEVEL_UP` 2 ou 3, en étant encore en dessous, avant 4:30,
  sans le jungler.
- `back-timer-missed` (`MISSED_OFFENSIVE_TP_OR_BAD_CHEATER`, cas B) : < 35 % PV et ≥ 800 g sur le relevé (10 à 40 s
  avant), en lane ; mort en rivière ou jungle, avant 10:00. « Vague crashée » non vérifiable.
- `cheater-recall` (cas A) : en base au relevé de 3:00 (back entre 2:35 et 3:15), > 75 % PV à 2:00, vivant de 2:00 à
  4:00, ≥ 1 niveau de retard à 4:00, pas de TP lancée (Riot ne compte les TP que sur la partie : une seule TP lancée
  rend le détecteur muet).
- `range-melee-volatility` : mort en 1v1 (sans assist) contre le vis-à-vis avant 8:00 ; range sous 60 % PV au niveau
  ≤ 3, ou mêlée sous 50 % PV au niveau ≤ 4 face à un range au-dessus de 85 % (relevés de minute).
  Types d'attaque : `championClasses.ts` (champion inconnu → muet).
- **Priorité** (une mort = un seul motif) : dive > level-up > back timer > gank timer > range/mêlée > choke point >
  carry > front tempo.
- Sur 2 010 revues réelles (201 parties en cache) : dive 1,4 %, level-up 1,4 %, range/mêlée 0,9 %, cheater recall et
  back timer 1 cas chacun.

**Limite connue** (sans objet depuis le retrait du protocole, 18/11/2026) : la carte basse énergie enregistrait
toujours `caught-out` ; quand le choix [1] était déjà `caught-out`, deux boutons portaient ce tag. Depuis, chaque tag
n'apparaît qu'une fois par carte, sans exception.

## V6 — rôles : support, mid/macro, ADC (lane et mid game), jungle (18/11/2026)

**Audit de dédoublonnage.** Aucun des 5 ids V6 n'existait, ni comme fiche ni comme alias ; aucun titre en double. Les
5 `qcmTrigger.condition` du brief deviennent 7 motifs nouveaux du détecteur, partagés avec aucun autre motif (testé :
`tests/unit/microReviewV6.test.ts`). Aucune fiche V6 ne reprend le concept principal d'une fiche existante pour le
même rôle et la même phase : les 5 sont ajoutées (61 fiches, `videoExamples: []`, aucun nom de coach, de joueur ni de
créateur). Les recoupements partiels sont complémentaires, sans chiffre contradictoire : chacun est relié par la
2e option du QCM plutôt que fusionné.

| Fiche V6 | Rôle / phase / tag [1] | Recoupe | Déclencheur QCM |
|---|---|---|---|
| support : 3 buissons, niveau 2, Aftershock | UTILITY / early / `bad-positioning` (+ `forgot-trinket`, `bad-trade`) | level-up timers (niveau 2 en solo lane), trading (punir un cooldown), début de lane | `support-no-early-ward`, `support-level2-allin` (2e option : level-up timers) |
| synchro du crash, trade 50/30, 1-caster hold | any / early / `caught-out` (+ `overstay`, `cs-deficit`, `bad-trade`) | tempo lines (même idée après 15:00), volatilité (rester au-dessus de 80 % PV), last-hit | `gank-during-team-reset`, `low-hp-recall-before-objective` (2e option : setup d'objectif) |
| ADC : wave/support, 14 golds, achat à 1300 g | BOTTOM / early / `bad-positioning` (+ `unused-gold`, `overstay`, `caught-out`) | quadrants de lane (mur de sbires contre un hook) | aucun (wave, charges et last-hits absents de la timeline) : « Autre cause… », fiche par défaut de `bad-positioning` pour un ADC en early |
| ADC : 7 plays, zone useless, re-open | BOTTOM / mid / `caught-out` (+ `overstay`, `bad-positioning`) | roam check (brouillard, roam sur kill garanti), asymétrie (prio mid avant une side lane), 1-3-1 (ADC au mid) | `adc-solo-sidelane-reopen` (2e option : 1-3-1) |
| jungle : 3 camps → Épée longue, no-Cleanse, sans ultime, Baron | JUNGLE / early / `overstay` (+ `bad-positioning`, `death-before-objective`) | Baron powerplay (zéro recall), 3 camps → invade (autre branche) | `jungle-baron-recall` (2e option : Baron), `inhib-forced-dive` (2e option : menace unique en teamfight) |

Correspondance : rôles `SUPPORT` → `UTILITY`, `ADC` → `BOTTOM`, `ALL` → `any` ; `no-ward` → `forgot-trinket` (au
niveau 1 la seule ward est le trinket ; `no-ward-pre-obj` veut dire « avant un objectif »), `mechanics` → `bad-trade`,
`positioning` → `bad-positioning`, `caught` → `caught-out`, `gold` → `unused-gold`, `death-obj` →
`death-before-objective` ; axes `KP` → `kp`, `DMG/m` → `dmgm`. `bad-trade` est ajouté aux tags de la fiche synchro :
c'est ce qu'enregistre le back forcé après un trade mutuel (« pris seul » serait faux, le joueur n'a pas été attrapé).
La famille vient du tag (`tagFamily`), `codex.json` n'a pas de champ `family`. Texte : « vague » → « wave », « en
recharge » → « en cooldown », 1re/2e/3e, Blitzcrank, Fiddlesticks et Twisted Fate en toutes lettres, « & Rotation
Mid » retiré du titre de la fiche ADC de lane (son texte n'a aucun point sur la rotation mid ; la règle de re-open de
la fiche ADC mid game la couvre). Traductions anglaises écrites pour les 5 fiches.

**Détecteurs** (timeline seulement). Nouveau signal : un `ITEM_PURCHASED` d'un joueur vivant prouve qu'il est en base
(vérifié sur les parties en cache) et date son arrivée, pas le début du canal de recall.
- `support-no-early-ward` (cas A) : support vivant jusqu'à 1:45 sans aucune ward à lui (les objets de champion
  `UNDEFINED` — autels de Bard, graines de Zyra, tentacules d'Illaoi — ne comptent pas) → moment `early-deficit` à
  1:45, gravité 0.06 (la plus basse). Muet si le cas B a déjà donné une mort.
- `support-level2-allin` (cas B) : mort entre 2:05 et 2:40 avec un niveau de moins qu'un ennemi du fight (événements
  `LEVEL_UP`, à l'instant exact). Les charges d'item support ne sont pas dans les données : « parce qu'il a consommé
  ses charges » est la lecture proposée par la fiche, pas un fait mesuré.
- `gank-during-team-reset` (cas A) : laner tué avant 14:00 dans la moitié adverse de sa lane par un gank (un ennemi
  autre que ses vis-à-vis, ou le jungler dans `victimDamageReceived`), avec 2+ alliés en base dans les 15 s avant (un
  achat, ou un relevé sur la plateforme x, y < 2000 côté bleu, > 12800 côté rouge), dont le jungler ou un bot laner.
  Un allié mort n'est pas « en reset ».
- `low-hp-recall-before-objective` (cas B) : premier achat d'une visite en base (vivant la minute d'avant ; achats à
  moins de 30 s = une visite), canal de 8 s compté en arrière, 0 à 35 s avant l'apparition d'un dragon (5:00, puis
  5:00 après chaque kill) ou des larves (8:00, un seul camp : vérifié sur les patchs 15.20 à 16.22 du cache) ; sous
  40 % PV au relevé précédent, hors base ; un vis-à-vis sous 60 % au même relevé (le trade était mutuel : seuil propre
  au détecteur, le brief ne chiffre pas ce côté) ; fight perdu (plus de morts alliées qu'ennemies) à moins de 3000 de
  la fosse avant son retour (achat + 30 s). Moment `absent-objective` ; l'objectif ennemi de ce fight n'est pas
  rapporté une seconde fois.
- `adc-solo-sidelane-reopen` : ADC après 14:00, mort sans allié à 2500 unités dans une side lane au-delà de la rivière,
  au plus 45 s de marche + 45 s après sa sortie de base (dernier achat ou respawn). « Midlane disponible » n'est pas
  vérifiable ; « ton mid était en base » est noté quand c'est le cas.
- `jungle-baron-recall` (cas A) : Baron de l'équipe (buff de 3 min), jungler en avance (KDA > 3, ou 10 000 g
  dépensés ≈ 3 objets : la timeline n'a pas de catalogue d'objets), en base (achat de 30 s avant à 15 s après le
  début du fight) ou en train de clear sa jungle loin du fight, pendant que 3+ alliés sont dans la moitié adverse et que
  2+ y meurent (fight perdu). Ce fight n'est pas rapporté une seconde fois en « recall désynchronisé ».
- `inhib-forced-dive` (cas B) : jungler mort dans la base ennemie au plus 15 s après la chute d'un inhibiteur ennemi
  (`BUILDING_KILL`, `teamId` = l'équipe qui le possédait : vérifié sur 1 007 inhibiteurs). « Donné gratuitement »
  n'est pas vérifiable.
- **Priorité** (une mort = un motif) : dive > level-up > niveau 2 support > back timer > reset allié > gank timer >
  range/mêlée > dive après inhibiteur > choke point > re-open ADC > carry > front tempo.

**QCM** : un motif = un contexte ; choix [1] = la fiche du brief, choix [2] = la fiche existante du concept voisin,
sortie `justified` quand le choix peut être bon (trinket gardé pour le gank de 2:30, back obligatoire, pression
cross-map, fin de partie tentée). Les listes `MOMENT_PATTERNS` et `QCM_CONTEXTS` sont exportées : les tests
parcourent tous les motifs et contextes, un ajout futur ne peut pas échapper aux contrôles de doublons.

**Sur 5 790 revues réelles (579 parties du cache, moments retenus)** : pas de ward avant 1:45 dans 23,1 % des revues
support (40,7 % des supports n'en posent aucune avant 1:45 ; le motif cède sa place aux moments plus coûteux), niveau 2
support 2,2 %, reset allié 0,3 à 1,0 % selon le rôle, re-open ADC 1,2 %, back forcé avant objectif 1 cas, recall sous
Baron 0,9 % et dive après inhibiteur 1,6 % des revues jungle.

**Garbage time et motifs jungle** (décision de l'utilisateur, 18/11/2026) : 24 des 26 morts « dive après inhibiteur »
et 82 % des Barons placent déjà l'équipe au-dessus de 85 % de victoire, seuil au-delà duquel la micro-review écartait
tout moment : les deux motifs ne sortaient que dans 3 revues jungle sur 1 158. Ils sont exemptés de ce plafond
(`GARBAGE_CEILING_EXEMPT` dans `anomalyDetector.ts`), puisque gâcher une partie gagnée est l'erreur qu'ils décrivent ;
le plancher (moins de 18 %) s'applique toujours, et tous les autres motifs gardent les deux seuils (testé, 4 mutations
détectées). Une réponse à ces moments compte dans les ratios du Labo d'erreurs (`mistakes.ipc.ts` ne rejuge pas un
moment déjà passé par le détecteur).

**Cache** : `ANALYSIS_VERSION` passe de 5 à 6 (V5 ne l'avait pas augmenté) : les analyses déjà en cache sont
recalculées à la prochaine ouverture.

## V7 à V10 — jungle avancée, mid lane, support engage (18/11/2026)

**Audit de dédoublonnage.** Aucun des 15 ids n'existait (ni fiche, ni alias), aucun titre en double : 76 fiches,
toutes `videoExamples: []`, aucun nom de coach, de joueur pro ni de créateur. Les 13 `qcmTrigger.condition` du brief
(plus les 2 conditions des fiches sans détecteur) ne reprennent aucun motif V1 à V6 ; ils deviennent 17 motifs
nouveaux, chacun avec son contexte de QCM (testé : `tests/unit/microReviewV7.test.ts`, et les contrôles généraux de
`microReviewV5.test.ts` qui parcourent les 41 motifs et tous les contextes).

**Conditions séparées.** Le brief range parfois un cas sous la fiche voisine, et plusieurs libellés d'option se
recoupent (« camps weak side » figure dans trois d'entre eux). Règle appliquée : un cas de détecteur = un motif = un
libellé = la fiche dont le texte enseigne ce cas. Une carte ne propose jamais deux lectures du même défaut : le 2e
choix est une autre cause (exécution, vision, trades perdus, setup), sinon la carte n'a qu'un diagnostic et sa sortie
`justified`.

| Condition du brief | Cas | Motif | Fiche du choix [1] |
|---|---|---|---|
| `JUNGLE_BAD_CAMPS_UP_GANK_OR_LATE_FIRST_RECALL` | A | `jungle-late-first-recall` | T-25 s / camps up / weak side |
| | B | `jungle-camps-up-gank` | idem |
| `JUNGLE_WEAKSIDE_CAMPS_IGNORED_OR_WRONG_INVADE_ORDER` | A | `jungle-weakside-stolen` | T-25 s / camps up / weak side (son point 3) |
| | B | `jungle-invade-death` | ordre d'invade rouge → jaune → vert |
| `JUNGLE_COMPENSATION_DEATH_OR_FORCED_BAD_DRAGON` | A | `jungle-dragon-tank-death` | 2 scénarios de Dragon (même fiche que l'ordre d'invade) |
| | B | `jungle-compensation-death` | match / trade / minimize |
| `GANK_FAILED_FROM_EARLY_DASH_OR_SLOW_CLEAR_TEMPO` | | aucun | mini-pas et ordre des sorts : 2e choix du gank à perte, et « Autre cause… » |
| `JUNGLE_EARLY_BOOTS_DELAYED_SPIKE_OR_SMITE_WASTED_SECOND_CLEAR` | A | `jungle-early-boots` | zéro bottes / 6e camp / double Smite |
| | B | aucun | |
| `JUNGLE_WASTED_HERALD_OR_DESTROYED_NON_FIRST_T1_EARLY` | A | `jungle-side-t1-destroyed` | T1 à 1 PV / Héraut de combat |
| | B | `jungle-herald-unused-death` | idem |
| `JUNGLE_FLED_INVADE_AT_1HP_LOSING_CAMPS` | | `jungle-fled-invade` | Carapateur du niveau 6 / ne jamais fuir |
| `JUNGLE_OVERSTAYED_INVADE_SECOND_CAMP_WITHOUT_MID_PRIO` | | lecture de `jungle-invade-death` | stop aux Raptors : choix [1] quand le mid est sur sa wave, [2] sinon |
| `JUNGLE_OBJECTIVE_OUTSMITED_FROM_DESYNCED_BURST` | | `jungle-outsmited` | sort avant Smite |
| `MID_CAUGHT_AHEAD_OF_WAVE_AFTER_RESET_OR_KEYSTONE_BAITED` | A | `mid-ahead-of-wave-death` | rune clé sur le HUD / devant la wave |
| | B | `mid-reset-trap-death` | synchro des PV / reset trap (c'est elle qui l'enseigne) |
| `MID_PASSIVE_WAVE_LOSS_VS_LANE_BULLY` | | `mid-passive-wave-loss` | synchro des PV / reset trap |
| `SUPPORT_STUCK_IN_BOT_LANE_POST_LEVEL_6_OR_VISIBLE_ON_CRASH` | A | `support-botlane-leech` | loi du niveau 6 (c'est elle qui l'enseigne) |
| | B | `support-absent-scuttle` | après le crash / hover à 3:15 |
| `SUPPORT_WEAKSIDE_JUNGLE_UNWARDED_OR_WAVE_STUCK_ZONE_C` | A | `support-weakside-unwarded` | loi du niveau 6 (son point 3) |
| | B | aucun | micro du support engage : « Autre cause… » |
| `JUNGLE_VISION_DEFICIT_FROM_EARLY_SWEEPER_OR_SNEAKED_DRAGON` | | aucun (hors des 13) | trinket jaune : 2e choix de la weak side volée et de la fuite d'invade |
| `SUPPORT_MIDGAME_FOG_OR_VISION_SQUARE_MISSED` | | aucun (hors des 13) | loi du niveau 6 : déjà choix [1] de deux motifs support |

**Recoupements avec V1 à V6** (aucune fusion : rôle, phase ou idée différents, aucun chiffre contradictoire). La
fiche support V6 (3 buissons, niveau 2, Aftershock) couvre le niveau 1-2 ; les trois fiches support V10 commencent
après (crash, 3:15, niveau 6) et ajoutent runes et chaîne de CC. Les fiches jungle V2/V6 (3 camps → invade, intégrité
du cycle, 3 camps → Épée longue, Baron) restent : les V7-V8 traitent le recall à T-25 s, l'ordre d'invade, l'économie
du 1er clear et le Smite. « Fenêtre de tempo à action unique » et « stop aux Raptors » disent la même discipline (une
action par tour) à deux échelles ; « sélection de fight » et « match / trade / minimize » se complètent. Fiche par
défaut d'un tag inchangée pour tous les autres rôles (testé).

**Correspondances.** Rôles `MID` → `MIDDLE`, `SUPPORT` → `UTILITY`. Tags : `mechanics` n'existe pas dans la Mistake
Library ; il devient le tag le plus proche de la fiche : `bad-engage-angle` (exécution du gank, micro du support
engage), `bad-dmg-maximisation` (sort avant Smite), `bad-trade` (ne jamais fuir, rune clé au mid). `no-ward` →
`no-ward-pre-obj`, `trinket` → `forgot-trinket`, `death-obj` → `death-before-objective`, `caught` → `caught-out`,
`gold` → `unused-gold`, `positioning` → `bad-positioning`. Axes : `CS/m` → `csm`, `Gold@15` → `gold15`, `XP@15` →
`xp15`, `CS@15` → `cs15`, `KDA` → `kda`, `KP` → `kp`, `FB` → `fb`, `DMG/m` → `dmgm`. Texte : « vague » → « wave »,
« Niv. » → « niveau », « -> » → « → », « CD » → « cooldown », « Herald » → « Héraut », « Grubs » → « Larves »,
« Carapateur » partout, « Jarvan IV » en toutes lettres. Traductions anglaises écrites pour les 15 fiches.

**Détecteurs** (timeline seulement). Deux signaux nouveaux, vérifiés sur le cache : l'œil du Héraut qui quitte un
inventaire (utilisé, ou expiré environ 300 s après la prise) est un `ITEM_DESTROYED` de l'objet 3513 au nom de son
porteur (le ramassage, lui, n'est pas journalisé) ; `victimDamageReceived` nomme le Dragon parmi les sources de dégâts
d'une mort.
- `jungle-late-first-recall` : aucun achat entre 1:00 et 4:05, sans kill, assist ni mort avant 4:05 (le 1er camp
  repousse à 4:05). Gravité 0.07. Muet si la timeline n'a aucun achat du joueur.
- `jungle-camps-up-gank` : de 2:00 à 12:00, jungler en lane avec un ennemi à 2500 unités au relevé, ni kill, ni
  assist, ni mort dans la minute, et 8 CS de jungle ou plus perdus sur le jungler adverse pendant cette minute (c'est
  la mesure que donne le brief : « déficit ≥ 8 CS jungle »). Que les camps aient été en vie, ou volés, n'est pas dans
  les données ; le résumé ne l'affirme pas.
- `jungle-weakside-stolen` et `support-weakside-unwarded` : vol de camps **prouvé** = à partir de 2:00, le jungler
  adverse prend 8 CS de jungle ou plus entre deux relevés en étant dans le même quadrant de notre jungle aux deux.
  Jungler (avant 16:00) : un achat, hors objets de départ, entre la minute d'avant et la fin de cette minute, puis de
  l'autre côté de la carte, vivant. Support (avant 18:00) : camps du bas, notre jungler en haut, aucune ward du
  support posée dans notre jungle du bas dans les 120 s.
- `jungle-invade-death` : mort dans la jungle ennemie avant 16:00, seul ou à deux, 4 CS de jungle ou plus entre le
  relevé de la minute précédente et celui d'après la mort, aucun kill ni assist dans les 30 s, et pas un overchase (V4).
  Quel camp a été pris, et dans quel ordre, n'est pas dans les données : la carte propose les deux lectures.
- `jungle-dragon-tank-death` : mort à moins de 3000 de la fosse du Dragon entre 5:00 et 12:00, le Dragon ayant infligé
  60 % ou plus des PV max (il reste donc moins de 40 %), un champion ennemi crédité.
- `jungle-compensation-death` : un allié tombé à moins de 3000 dans les 15 s, 2 ennemis de plus sur le kill que
  d'alliés vivants à 2500, et l'ennemi prend l'objectif de cette fosse dans les 60 s. Sans l'objectif, le « ou
  escarmouche » du brief touche 1,25 mort par partie de jungle (0,17 avec) : ce n'est plus un motif.
- `jungle-early-boots` : Bottes (objet 1001) achetées avant 8:00 sans kill. Gravité 0.06.
- `jungle-side-t1-destroyed` : dernier coup du jungler sur une T1 ennemie de side lane entre 14:00 et 20:00, une tour
  étant déjà tombée. « Avec une wave alliée dessous » n'est pas vérifiable.
- `jungle-herald-unused-death` : mort dans un fight entre 14:00 et 19:30, 20 s ou plus après la prise du Héraut par
  l'équipe (20 s = le temps où l'œil reste au sol), l'œil ne quittant l'inventaire du jungler qu'après cette mort.
- `jungle-fled-invade` : relevé avant 15:00 où le jungler, vivant, est sous 15 % PV dans sa jungle, le jungler adverse
  à 2000 au plus et au-dessus de 70 %, un allié à 2000 au plus ; vivant 15 s plus tard ; le jungler adverse prend 4 CS
  de jungle ou plus dans la minute.
- `jungle-outsmited` : l'ennemi prend Dragon, Ancestral, Héraut ou Baron alors que le jungler, vivant, est à moins de
  900 du centre de la fosse. Moment `absent-objective` 10 s avant ; l'objectif n'est pas rapporté une seconde fois.
- `mid-ahead-of-wave-death` : mort sur la lane mid avant 12:00, tué par un champion, 45 s au plus après la sortie de
  base (achat après 1:00, ou respawn).
- `mid-reset-trap-death` : le mid adverse back en premier (premier achat d'une visite, vivant la minute d'avant) ; le
  joueur, sous 30 % PV ou 30 % de mana au relevé précédent (réserve de mana de plus de 200, donc ni énergie ni rage),
  n'achète rien de 45 s avant ce back jusqu'à sa mort, 90 s au plus après. Avant 12:00.
- `mid-passive-wave-loss` : 12 CS de retard ou plus à 6:00, un point dans chaque sort au niveau 3, moins de 2
  kills/assists (comme à 10:00). Ce moment remplace le retard de 10:00.
- `support-botlane-leech` : niveau 6 à 9:00, à 2000 au plus de l'ADC en botlane sur 6 des 7 relevés de 9:00 à 15:00
  (plus de 75 %), participation aux kills sous 45 % à 15:00. Gravité 0.08.
- `support-absent-scuttle` : le jungler allié meurt en rivière basse entre 3:25 et 3:50, le support à plus de 2000,
  sans kill ni assist autour.
- **Priorité** (une mort = un motif) : dive > level-up > niveau 2 support > devant la wave > reset trap > back timer >
  reset allié > gank timer > range/mêlée > Dragon tanké > dive après inhibiteur > Héraut en poche > mort en invade >
  choke point > re-open ADC > compensation > carry > front tempo. Une mort lue « Dragon tanké » ou « compensation »
  n'est pas aussi un overchase.

**Ce que la timeline ne contient pas** (le détecteur se tait) : aucun sort lancé (dash, Smite, ultime, Flash), donc ni
« dash d'entrée », ni Smite gaspillé ou désynchronisé, ni rune clé ; aucune wave (zone C, vague canon, sbires
synchronisés, « devant sa wave ») ; aucun événement de camp ni de Carapateur (compteur de CS de jungle à la minute
seulement : ni « 1er clear après 3:25 », ni « 0 Carapateur sur 2 », ni « camps en vie ») ; pas de quête de support ;
pas de perte de PV hors mort entre deux relevés. Non codé faute de cas : la branche « plaque + 10 CS » du reset trap
(1 cas sur 1 158 parties). Non ajouté : un détecteur « Balayeur pris trop tôt » pour la fiche trinket jaune (64 % des
junglers l'achètent avant 8:00 : ce serait du bruit).

**Sur 5 790 revues réelles (579 parties du cache, moments retenus, part des revues du rôle)** : mort par compensation
8,9 %, mort en invade 8,1 %, premier back tardif 7,1 %, smite perdu 3,6 %, devant sa wave 3,5 %, lane subie 3,2 %,
Héraut en poche 2,9 %, bottes trop tôt 2,5 %, Dragon tanké 1,6 %, gank à perte 1,3 %, reset trap 1,2 %, T1 de side
lane 1,1 %, absent au Carapateur 0,5 %, weak side non wardée 0,2 %. Jamais sortis : weak side volée (4 candidats),
fuite d'invade (3 relevés sur 1 158 parties montrent un jungler vivant sous 15 % face au jungler adverse), support
collé à l'ADC (1 candidat).

**Cache** : `ANALYSIS_VERSION` passe à 7.

## Audit indépendant (17/11/2026) — corrections

Relecture mathématique par un sous-agent, un scénario exécuté par constat. Corrigé, avec un test de part et d'autre de
chaque seuil (`tests/unit/anomalyDetectorMath*.test.ts`, `microReviewIpc.test.ts`, `tests/e2e/microReview.spec.ts`) :

- positions interpolées à travers une mort vers la fontaine (overchase, tempo lines, fosse, rotations) ;
- fenêtre de 90 s de la mort critique lue sur des relevés trop larges (objectif tombé avant la mort, écart apparu après) ;
- filtre garbage time appliqué à la valeur arrondie du relevé de la minute, au lieu de l'état juste avant l'action ;
- hésitation « reste en zone neutre » vraie pour un mid laner sur sa lane ; fenêtre de tempo non punie signalée pour un
  joueur mort, avant 2:30, ou en double d'un objectif déjà remonté ; recall tardif confondu avec un respawn ; mauvaise
  rotation en coupant le coin d'une side lane ou en revenant d'une mort ; roam mid à 200 unités de la lane ;
- territoire asymétrique des fosses ; parties hors Faille classique analysées ; larves comptées trois fois ;
- vérification de l'objectif vision qui tenait rigueur d'objectifs pris par l'équipe d'un laner ou tombés pendant sa mort
  (`ContestedObjective.accountable`, même règle que le tag auto `no-ward-pre-obj`) ;
- sortie `justified` évincée dès que deux contextes se cumulaient ; diagnostic basse énergie enregistré sous un tag
  variable ; « seul en front » proposé à un joueur en base (contextes `tempo-recall` / `tempo-front`) ;
- doublons d'erreurs entre l'auto-détecteur et la micro-review ; XP qui pouvait être versée deux fois ; écriture non
  atomique d'une réponse ; libellé « avec exemple vidéo » affiché sur des fiches textuelles.

Laissé tel quel, en connaissance de cause : seuils propres au détecteur là où le brief ne chiffre rien (`approachMin`
1200, `counterTempoXp` 150, `minOffAxis` 2600) ; la « tower greed » (tour ou plaque prise par le joueur dans les 75 s)
compte comme hésitation même dans la fenêtre de cross-map ; ni le support ni le jungler n'ont de `bad-rotation` (pas de
vis-à-vis en CS).

## Retrait du protocole basse énergie (18/11/2026)

Décision produit : le « protocole basse énergie » est désactivé et supprimé partout.

- **Retiré** : `src/lib/microReview/lowEnergy.ts` (signal série de défaites / créneau sous 45 % / nuit), la carte
  `LowEnergyPrompt` (Dashboard, Session avant et pendant, Statistiques → Analyse « Selon l'heure » et « Gestion du
  tilt »), le contexte QCM `low-energy` et l'option « choix [2] de chaque mort » (`QcmEnv` disparaît de `buildQcm`), le
  champ `lowEnergy` de `microreview:get` (et ses deux requêtes), la règle d'objectif `low-energy` sur `resilience` (un
  objectif `resilience` n'est plus vérifié automatiquement), les textes `lowEnergy.*` et `objectiveCheck.rule.low-energy`,
  la carte du site vitrine (pièce B) et sa note de méthode.
- **Gardé pour les réponses déjà enregistrées** (1.0.0-beta.1) : la fiche `codex_mental_low_energy_anti_tilt_protocol`
  passe dans `codexRetired.json` (`CODEX_RETIRED` : lisible par `codexById`, jamais classée par `codexFor`, jamais
  comptée) ; `RETIRED_OPTIONS` / `retiredOption` (`smartQcm.ts`) remontent l'option sur la carte quand une réponse porte
  ce tag et cette raison, en lecture seule et sans bouton « Préparer ma prochaine session » ; le texte
  `microReview.reason.lowEnergy` reste.
- **Autre fonctionnalité, conservée** : la corrélation du check-in bien-être (`lowEnergyGames` dans `wellbeingCore.ts`).
- Codex : 75 fiches. Pas de changement d'`ANALYSIS_VERSION` (les moments détectés ne changent pas).
