# Fiche d'orientation du moteur — session Engine

_20/11/2026, session **Engine** (pilotée par le Chief). Lecture seule du code. Les détails chiffrés sont dans
[`RAPPORT_MOTEUR.md`](RAPPORT_MOTEUR.md) ; les sources dans [`RECHERCHE_CONNAISSANCES.md`](RECHERCHE_CONNAISSANCES.md) ;
la vérification des timers 2026 dans [`DONNEES_JEU_2026.md`](DONNEES_JEU_2026.md) ; le design de l'assistant dans
[`MOTEUR_REGLES.md`](MOTEUR_REGLES.md). Les rapports de la session Engine vont dans `docs/moteur/engine-reports/`._

## 1. Carte : où vit quoi

| Bloc | Fichiers | Ce qu'il produit | Écran |
|---|---|---|---|
| **Horloge de saison** | `src/lib/microReview/gameClock.ts` | `gameClockOf(match)` : 16.x (ou inconnu) → 2026, 15.x → 2025 ; `CLOCK_TIMES` (heures citées par les cartes) ; respawn `deathTimerSec` | — (utilisé partout) |
| **Géométrie** | `src/lib/microReview/geometry.ts` | fontaines, fosses, tours, lanes, zones, moitiés de carte, ligne de tempo, rayons | — |
| **Probabilité de victoire** | `src/lib/microReview/winProbability.ts` | P(win) par minute (or, XP, objectifs) — sert à écarter le garbage time (< 0,18 ou > 0,85), jamais affichée | — |
| **Détecteur de la micro-review** | `src/lib/microReview/anomalyDetector.ts` | 3 déclencheurs (`critical-death`, `absent-objective`, `early-deficit`) + 41 schémas (`MOMENT_PATTERNS`) ; tous les seuils dans `DETECTOR_SPEC` (horloge 2026), décalés par `CLOCK_2025` via `detectorSpecFor` ; `pickMoments` garde 3 moments | Micro-review (`src/components/MicroReview/MicroReviewPanel.tsx`) |
| **QCM** | `src/lib/microReview/smartQcm.ts` | schéma → contexte (`contextsOf`, `QCM_CONTEXTS`) → 2-3 diagnostics (tags du Labo ou `justified:<raison>`) avec `codexId` ; résumé factuel ; apprentissage local par champion | carte QCM ; textes `microReview.*` dans `src/i18n/locales/fr.json` / `en.json` |
| **Codex** | `src/lib/microReview/codex.json` (109 fiches), `codex.ts`, `codexRetired.json` | fiche = `id`, `mistakeSlug(s)`, `phase`, `role`, `radarAxis`, `fundamentalId`, `headline` / `tacticalRule` / `drillObjective` (fr + en), `videoExamples` (LoL Esports en liste blanche seulement) ; règle d'équipe du coach > fiche intégrée | `CodexCard.tsx`, `WeeklyCodex.tsx`, « Préparer ma prochaine session » |
| **Vérif. objectif de session** | `src/lib/microReview/objectiveVerification.ts` | 8 règles fondamental → tags qui l'invalident | `ObjectiveAutoCheck.tsx` |
| **Calibration flash** | `src/lib/microReview/calibration.ts` | toutes les 15 parties, auto-évaluation contre la répartition des erreurs | `CalibrationFlash.tsx` |
| **Labo d'erreurs (règles M\*)** | `electron/main/mistakeDetector.ts` (M1-M4), `electron/main/mistakeRules.ts` (M5-M19, `detectAdvancedMistakes`) ; dédup `mistakeDedupe.ts` ; tuning `mistakeTuning.ts` | erreurs taguées « auto » datées, gravité 1-3, `note` explicative | Stats → Labo d'erreurs (`MistakeStatsPage.tsx`), Review, signets vidéo |
| **Catalogue des tags** | `src/lib/mistakeTagCatalog.ts` (27 tags, `slug` stable) | taxonomie partagée détecteur / QCM / Codex / web | sélecteur de tags |
| **Note de lane** | `electron/main/lanePhaseAnalyzer.ts` | note S → F sur 14 min | Review, stats |
| **Assistant** | `electron/main/assistant/` : `features.ts` (indicateurs par partie), `rules.ts` (41 règles déclaratives), `problems.ts` + `diagnosis.ts` (18 problèmes, noisy-OR, priorité), `experiments.ts` (tests sur 5 parties), `weights.ts`, `regression.ts`, `reviewPriority.ts`, `report.ts` | conseils, focus, expériences, bilans | Dashboard, Session, Review, page **Mon plan** (`/plan`), bilan hebdo |
| **Fondamentaux** | `src/lib/constants/fundamentals.ts` / `.fr.ts` | 38 fondamentaux, KPI chiffrés (fr = miroir exact de en, testé) | radar, bilans |
| **Cache des analyses** | `electron/main/ipc/microReview.ipc.ts` | `ANALYSIS_VERSION` (**10** aujourd'hui) : le monter recalcule une fois chaque analyse en cache | — |

Données Riot disponibles : Match-V5 (`info.gameVersion`, stats de fin de partie) + Timeline-V5 (relevés par minute :
position, or, XP, niveau, CS, PV/mana ; événements à la ms : kills avec `victimDamageReceived`, monstres épiques, tours,
plaques, wards **sans coordonnées**, achats, montées de niveau). **Absent** : sorts lancés (Flash, Smite, TP), waves,
camps précis, Carapateur, début de recall, positions entre deux relevés, dégâts hors morts. Règle d'or : quand les données
ne prouvent rien, le moteur se tait.

## 2. Comment une connaissance entre dans le moteur

Une connaissance (timing, seuil, règle high-elo) prend une ou plusieurs de ces quatre formes. On choisit d'après ce que
la timeline **peut prouver** :

| Forme | Quand | Où l'écrire | Tests | Effet dans l'app |
|---|---|---|---|---|
| **A. Valeur d'horloge** (timer, spawn, fenêtre) | un chiffre de jeu qui change par patch | `DETECTOR_SPEC` (2026) **et** `CLOCK_2025` si la valeur 15.x diffère ; `CLOCK_TIMES` si une carte la cite ; `gameClock.ts` pour respawn | `microReviewSeason2026.test.ts`, `anomalyDetectorMath*.test.ts` (les deux côtés du seuil, les deux saisons) | les détecteurs existants changent de fenêtre ; monter `ANALYSIS_VERSION` |
| **B. Schéma de micro-review** (une situation reconnaissable sur une mort, un objectif perdu ou un retard) | prouvable sur une partie, à un instant | `anomalyDetector.ts` : ajouter à `MOMENT_PATTERNS`, seuils dans `DETECTOR_SPEC`, fonction de détection à sa place dans l'ordre (le plus précis d'abord) ; `smartQcm.ts` : `QCM_CONTEXTS`, `contextsOf`, options → tags + `codexId` ; i18n `microReview.*` | `microReviewV*.test.ts`, `smartQcm.test.ts`, `microReviewI18n.test.ts` (la liste `MOMENT_PATTERNS` est itérée : un schéma sans test casse la suite) | un moment dans la file « 1 · 2 · 3 », un QCM, une fiche |
| **C. Règle M\* du Labo** | une erreur datée et taguée, indépendante du QCM | `mistakeRules.ts` (`AdvancedTag`, `detectAdvancedMistakes`) ; tag dans `mistakeTagCatalog.ts` s'il est nouveau | `mistakeRules.test.ts`, `postGameAutomation.test.ts` | Labo d'erreurs (comptage, coût en winrate), signet vidéo si gravité 3, notes pré-remplies, vérif. d'objectif |
| **D. Fiche Codex** | une prescription (quoi faire, quand, où) + un drill mesurable | `codex.json` : un trio (tag, rôle, phase), fr + en, nos propres mots, aucun nom de coach / pro / créateur | `codexResearch2026.test.ts`, `teamCodexRules.test.ts` | fiche après le QCM, « Préparer ma prochaine session », prescription du Labo, Codex hebdo |
| **E. Règle de l'assistant** | un agrégat sur plusieurs parties (moyenne, tendance, repère par rôle) | `assistant/features.ts` (nouvel indicateur), `rules.ts` (règle déclarative, `variants` → `assistant.rules.<id>.v1..vN`), `problems.ts` (problème lié) ; critère mesurable dans `experiments.ts` | `assistantRules.test.ts`, `assistantResearchRules.test.ts`, `coachingEngine.test.ts` | conseil après la partie, brief, bilan hebdo, focus et expérience sur « Mon plan » |

Chaîne type : **connaissance → (A) valeurs datées par saison → (B) ou (C) détection → tag du catalogue → (D) fiche →
(E) éventuellement une règle d'assistant et un critère d'expérience**. Le tag est le pivot : il relie Labo, QCM, Codex,
vérification d'objectif et assistant.

## 3. Règles à tenir dans chaque rapport

- **Relire `docs/DECISIONS.md` avant chaque rapport**, et y ajouter une ligne datée pour chaque décision donnée
  directement par l'utilisateur à la session Engine (puis prévenir le Chief).

- **Saison en cours seulement** (demande de l'utilisateur du 20/11/2026) : aucune valeur ni calibrage 2025 (15.x) ;
  toute valeur est celle de la saison en cours, au dernier patch, avec ses paliers de patch internes (ex. 16.9, 16.16).
  Préparer la saison suivante sans l'appliquer avant d'avoir vérifié ses valeurs (voir
  `engine-reports/2026-11-20-saison-courante-et-saison-2027.md`). Source et date pour chaque chiffre (notes de patch >
  wiki > coach de la saison > guide ancien ; nos données en cache tranchent quand elles peuvent).
- **Prouvable ou rien** : dire quelle donnée de la timeline prouve la règle et ce qu'elle ne voit pas (relevé de 60 s,
  ward sans position, pas de sorts). Estimer le taux de déclenchement sur le cache (pour 100 parties-joueur) et le
  risque de faux positifs avant de proposer un seuil.
- **Une mort, une lecture** : placer un nouveau schéma dans l'ordre de priorité existant ; dire quel schéma il remplace
  ou devance.
- **Cache** : tout changement de sortie du détecteur ou des règles M\* → monter `ANALYSIS_VERSION`.
- **Textes** : fr + en, jargon LoL en anglais (wave, trades, gank, roam, spacing…), aucun nom de source dans l'app.
- **Partage du travail** : Back-end = `src/lib/microReview/*.ts`, `electron/main/*` (détecteurs, règles M\*, assistant,
  `ANALYSIS_VERSION`) et tests ; Front-end = composants `src/components/MicroReview/`, pages, i18n ; Graphic Design si
  un nouvel élément visuel est nécessaire (maquette Penpot d'abord). `codex.json` et les fondamentaux : Back-end, avec
  relecture des textes par le Front-end (i18n).
- **La session Engine ne code pas et ne commite pas** : elle écrit ici et dans `docs/moteur/engine-reports/AAAA-MM-JJ-sujet.md`,
  puis envoie 5 lignes au Chief.

## 4. Points ouverts connus (à garder en tête)

- M8 `solo-baron-died` compte encore toute mort à la fosse du haut dès 8:00 (Larves, Héraut) — D1 de `DONNEES_JEU_2026.md`.
- Respawn des niveaux 19-20 (quête top) lu comme niveau 18, faute de source.
- Krugs et Gromp à 1:07 en 2026 (texte des fondamentaux).
- Détecteurs de macro proposés par la recherche, non écrits : pick non converti, Baron gaspillée, objectif donné
  gratuitement, ADC seul du côté opposé, push pendant le reset de l'équipe, or non dépensé à T−60.
- Trois tags retombent sur une fiche d'une autre phase en late game : `walked-into-ward`, `xp-deficit`,
  `behind-on-levels-death`.

## 5. Chantier en attente

Bilans des roams, des ganks et des quêtes de rôle : **codés le 26/11, désactivés** (`ledgerCore.ts`, `roamLedger.ts`, `gankLedger.ts`, `roleQuest.ts`, `patchOf()` dans `gameClock.ts`, drapeaux `DETECTOR_SPEC.roam` et `gankLedger`). Avancement et activation : [`PLAN_MOTEUR_BILANS.md`](PLAN_MOTEUR_BILANS.md) § 8, seuils en attente (A1b et A1c).

**27/11 — prio avant objectif, crossmap, duo botlane** (règles de l'utilisateur, `REGLES_OBJECTIFS_PRIO_CROSSMAP.md` § 2-4) :
rapport [`engine-reports/2026-11-27-prio-crossmap-duo.md`](engine-reports/2026-11-27-prio-crossmap-duo.md), en attente
d'accord. Points à retenir :
- la prio est un **proxy** (`laneStateAt` dans `ledgerCore.ts`) : plaque/tour prise ou vis-à-vis mort/en base = prouvée ;
  laner près de la tour adverse = probable ; position avancée = suggérée (chiffres seulement) ;
- la participation (§ 1, Back-end) doit être **une seule fonction partagée**, réutilisée pour « objectif contesté » ;
- crossmap = contexte des ledgers roam/gank, pas un 2ᵉ verdict ; duo = champ `fault` sur le verdict des roams du
  support / de l'ADC ; `absent-objective` et `tempo-hesitation` lisent le verdict crossmap ;
- 8 tags proposés (`objective-without-prio`, `no-prio-before-objective`, `no-crossmap-trade`, `left-adc-alone`,
  `overextended-without-support`, et en late game `late-botlane-alone-sidelane`, `late-split-no-pressure`,
  `late-missed-rejoin`), désactivés jusqu'à ~110 extraits vidéo relus ;
- **réponses de l'utilisateur intégrées (27/11 soir)** : la dérogation crossmap du 20/11 ne vaut plus que pour le top et
  l'ADC (pas le mid ni le support) ; prio à l'apparition + avant que l'objectif soit joué (le Labo lit la seconde) ;
  règles de late game après 20:00 ; sidelane sans prio = erreur possible, plus lourde en équipe ; duo toute la partie,
  plus lourd avant 14:00 ; critères « ADC forcé d'avancer » = faute du support ;
- **correction du 27/11** : prio mesurée au **climax** (dernière wave avant l'objectif, ≈ T − 30 s, jamais après la
  prise). Waves : 0:30 puis toutes les 30 s, 25 s dès 14:00, 20 s dès 30:00 ; sbires 350 en début de partie (26.1),
  bonus de vitesse des sidelanes jusqu'à 14:00 ; trajet base → milieu estimé ≈ 25 s (≈ 30 s après 14:00), ±5 s, à
  filmer. Fenêtres : Dragon 4:20-4:45, Larves 7:20-7:45, Héraut 14:25-14:50, Baron 19:25-19:50 ;
- objectif « à jouer » = **côté le plus avantagé** (`sideEdge` = or + XP du ou des laners du côté, + bonus adversaire
  absent / prio ; écart ≥ 1 500 et côté ≥ + 500) ; tag `objective-wrong-side` (jungler, issue négative) ; annulé si le
  jungler a ≥ 1 500 d'or et 1 niveau sur le jungler adverse ; le sidelaner sans prio n'est alors pas en faute. 9 tags ;
- **concept « jouer autour de la win condition »** (§ 3ter du rapport) : état de partie `winConditionTimeline`
  (`ledgerCore.ts`), lu par toutes les règles. SoloQ : `fedScore` = ½ écart (or + XP) contre le vis-à-vis + ½ écart à
  la moyenne de l'équipe ; claire si ≥ 2 000 et ≥ 1 000 sur le 2e, 3 relevés de suite (hystérésis pour les bascules),
  dès 10:00. Joueur = win condition → « leader », champ `weight` 2 sur ses erreurs auto (Labo, stats, assistant,
  micro-review), gravité inchangée. Dès 14:00 : `died-far-from-wincon` (seul, > 5 000 d'elle) et `missed-wincon-fight`
  (chiffres d'abord) ; l'objectif « à jouer » devient celui du côté de la win condition. En équipe : champ structuré du
  coach > archétype de draft > le plus fed. 11 tags ; 5 questions Q-W1 à Q-W5 ;
- **réponses W1-W5 (27/11), rapport final** (§ 3ter.6) : support win condition seulement s'il fait des dégâts
  (`DAMAGE_SUPPORTS` + ≥ 18 % des dégâts de l'équipe, ou ≥ 25 % quel que soit le champion, lu dans `damageStats` des
  relevés) ; ×2 expliqué dans l'app (`weight` + `weightReason` {kind, since, until, fedScore, écarts, coWinCons} sur
  chaque occurrence) ; en équipe, le coach / responsable choisit après la game (stockage par partie + RLS, recalcul),
  repli « auto, à confirmer » = le plus fed ; plusieurs win conditions (« loin » = loin de toutes, fight = d'au moins
  une) ; win condition adverse (focus par ordre des kills, kills/shutdowns sur elle, morts qu'elle cause via
  `victimDamageReceived`, ganks sur sa lane ; pas de dégâts par cible hors morts), tag `died-alone-to-enemy-wincon`.
  12 tags ; effort total ≈ 15,5 j (Back 8,5, Front 3, Graphic 1, Cyber 0,5, calibrage + vidéo 2,5).
