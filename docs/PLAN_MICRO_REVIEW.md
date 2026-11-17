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
  arrondie** est < 0.18 ou > 0.85 (garbage time). La courbe stockée (`winProb`)
  est arrondie à 3 décimales.
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
- **Dashboard** : carte Codex dans le bilan de la semaine + Calibration flash + carte « Session basse énergie ».
- **Session** et **Statistiques → Analyse** (« Selon l'heure », « Gestion du tilt ») : même carte 1 clic.
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
- **Session basse énergie** (`lowEnergy.ts`, sans timeline) : 2 défaites d'affilée dans la session (ou dans la même
  séance avant d'en lancer une), ou créneau horaire sous 45 % de victoires (ratio exact, ≥ 3 parties) → carte 1 clic
  « Protocole basse énergie » sur le Dashboard, la Session et les panneaux « Selon l'heure » / « Gestion du tilt ».
  L'activation met `resilience` en premier objectif et garde la note du joueur. Dans la micro-review d'une partie
  jouée dans ces conditions, le protocole est le choix [2] de chaque mort (tag `caught-out`, celui que vérifie la
  règle d'objectif `low-energy`).
- **6 fiches** (53 au total) : 3 tempos → `bad-positioning` / `resource_management` ; asymétrie de pression →
  `caught-out` / `lane_assignment` ; choke point → `bad-positioning` / `prefight_positioning` ; archétypes mid →
  `bad-trade` / `matchup_knowledge` ; roam check → `cs-deficit` / `roam_gank_timing` ; basse énergie → `caught-out` /
  `resilience`.

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
