# Recherche de connaissances — mise à niveau du moteur (novembre 2026)

_19/11/2026. Branche `engine-knowledge`, partie de `572b287`. Ce document dit ce qui a été cherché, d'où vient chaque
connaissance ajoutée au moteur, ce qui a changé et pourquoi. Les sources sont citées ici seulement : l'application
n'affiche jamais de nom de coach, de joueur pro ni de créateur (règle de `codex.ts`, vérifiée par les tests)._

## 1. Méthode

- **Ce qu'on cherchait** : du contenu pédagogique de haut niveau (joueurs et coachs du plus haut niveau de classement,
  joueurs et coachs professionnels, analystes, chercheurs), sur le jeu actuel — saison 2026, patchs 26.x, que l'API
  Riot appelle 16.x — avec une préférence pour les règles **vérifiables** : timings, seuils, états de wave, conditions.
- **Sept recherches en parallèle**, une par thème : laning, waves et recalls ; top et mid ; bot lane (ADC et support) ;
  jungle et objectifs 2026 ; macro et teamfights ; draft, mental et habitudes de review ; vidéos YouTube de coaching.
  Les notes complètes (environ 3 500 lignes, chaque point avec sa source, sa confiance et sa vérifiabilité) sont hors du
  dépôt, dans le dossier de notes partagé de la session (`engine-knowledge-research/01` à `08`).
- **Vidéos** : 19 vidéos de coaching de haut niveau (2023-2026) ont été regardées et écoutées par Gemini (API Gemini, l'URL
  YouTube passée comme entrée vidéo, `gemini-3-flash-preview`), qui en a tiré la liste des points enseignés avec leurs
  horodatages. Les résumés de Gemini sont restés hors du dépôt ; seules nos synthèses en sont tirées.
- **Vérification sur nos propres données** : les faits de jeu 2026 ont été contrôlés sur le cache local de l'app (lecture
  seule) — 3 004 parties classées de 15 minutes ou plus (patchs 16.1 à 16.10) et 207 timelines (128 de 2026, 79 de 2025).
  Les seuils des nouvelles règles de l'assistant y ont été calibrés (taux de victoire par tranche et par rôle).
- **Droits** : aucun texte d'article ni aucune transcription n'entre dans le dépôt. Fiches et règles sont rédigées avec nos
  propres mots, à partir de plusieurs sources quand c'est possible.
- **Tri** : un point n'est gardé que s'il a au moins une source identifiée (URL, auteur, date). Les chiffres qui dépendent
  du patch sont datés. Quand deux sources se contredisent, la plus récente et la plus officielle l'emporte (notes de patch
  Riot > wiki > coach 2026 > guide plus ancien), et nos données tranchent quand elles le peuvent.

## 2. Ce que le moteur savait avant (572b287)

### Codex (75 fiches)

- Par rôle : toutes 46 · jungle 16 · support 6 · ADC 4 · mid 2 · top 1. Par phase : début 38 · milieu 22 · toute la
  partie 8 · fin 7.
- **Aucune fiche** pour deux tags : `solo-baron-died` (pourtant détecté automatiquement par M8 : le Labo n'avait aucune
  prescription à proposer) et `bad-rune-choice`.
- `bad-kiting` n'avait de fiche que pour l'ADC, `bad-dmg-maximisation` que pour le jungler.
- Plusieurs tags qui arrivent surtout en milieu ou fin de partie renvoyaient à une fiche de phase de lane : `dove-tower`,
  `bad-trade`, `xp-deficit`, `late-back`, `cs-deficit`, `bad-wave-sync`, `walked-into-ward`.
- Les fiches enseignaient l'horloge de 2025 : Carapateur à 3:30, camps à 1:30, Smite 900/1 200, plates à 160 g qui
  tombent à 14:00, portée d'XP de 1 400.

### Assistant (32 règles)

- Toutes les règles portaient sur des agrégats par partie (CS/min, CS à 10 min, écarts d'or, morts, vision/min, KP, note
  de lane), surtout comparés à la moyenne du joueur. Aucun repère par rôle pour la vision, rien sur les pinks ni sur le
  temps passé mort.
- Garde-fous mentaux : pause de 10 min après 3 défaites, de 15 min après 3 défaites et 2 h de jeu, « longue session » à
  6 parties, champion à sortir du pool après 10 parties.

### Fondamentaux

- 38 fondamentaux, 7 catégories ; descriptions des KPI sans chiffres pour la plupart.

## 3. Ce que la recherche a établi (faits 2026, tous vérifiés)

| Fait | Valeur 2026 | Source | Vérifié sur nos données |
|---|---|---|---|
| Atakhan | **supprimé** (26.1) | notes 26.1, wiki | 0 kill sur 128 parties 2026, 71 parties sur 79 en 2025 |
| Baron | **20:00** (25:00 en 2025), respawn 6:00, buff 180 s | notes 26.1, wiki Baron | 1er kill au plus tôt à 20:17 (2025 : 25:21) |
| Dragon, Larves, Héraut | 5:00 (+5:00) ; 8:00, une seule apparition ; 15:00-19:45 | notes 26.1, wiki | 5:31 / 8:03 / 15:15 au plus tôt |
| Sbires, camps, Carapateur | sbires **0:30** (1:05 avant), camps **0:55**, Carapateur **2:55** (3:30 avant) | notes 26.1, wiki Minion et Rift Scuttler | CS de lane à 2:00 : 57 contre 23 ; CS de jungle d'un jungler à 2:00 : 12 contre 4 |
| Waves | toutes les 30 s, 25 s dès 14:00, 20 s dès 30:00 ; canon aux waves 3, 6, 9… | wiki Minion | — |
| Plates | **120 g**, **ne tombent plus à 14:00**, aussi sur les tours intérieures et d'inhibiteur ; 1re tour +300 g | notes 26.1, wiki Turret | plates jusqu'à 47:47 en 2026 (toujours avant 14:00 en 2025) |
| Smite | 600, puis **1 000** (15 friandises) et **1 400** (35) ; 2e charge vers 2:18 | wiki Smite (V26.01) | — |
| Quêtes de rôle (26.01+) | top ~14:25 → Teleport de quête (390 s), niveau 20 ; mid/ADC ~16:05 ; support : pinks à 40 g ; 1 min de roam libre par 2 min en lane ; support −33 % hors bot avant le niveau 5 (26.16) | wiki Role Quests | — |
| Respawn | attente de base par niveau (10 s au 1, 52,5 s au 18) × facteur de temps dès 15:00 (plafond +50 %) : ~44 s niveau 13 à 25:00, ~54 s niveau 16 à 30:00 | wiki Death | — |
| XP | portée **1 500** ; duo bot : 65 % de l'XP chacun → niveau 2 au **9e sbire**, niveau 3 à la 4e wave | wiki Experience, notes 26.1 | — |
| Clears | 3 camps vers 2:00, full clear vers 2:40-3:05, 1er kill de la partie ~15 s plus tôt | Skill Capped S16, jungle | médiane 12 CS de jungle à 2:00, full clear à 3:00-4:00 |

## 4. Sources

Environ 200 sources ont été consultées (notes de patch, wiki, études, vidéos, guides) ; celles ci-dessous portent les
points gardés. Les listes complètes, avec la confiance de chaque point, sont dans les notes de recherche.

### Officielles (mécaniques et chiffres)

- Riot Games, notes de patch 26.1 (7/01/2026), 26.9, 26.10 (12/05/2026, aggro des sbires), 26.16, 26.19 —
  https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/ et suivantes.
- Riot Games, « /dev: 2026 Season One Gameplay Preview » (1/12/2025).
- League of Legends Wiki (lu le 19/11/2026) : Role Quests, Death (respawn), Turret et Crystalline Overgrowth, Minion,
  Rift Scuttler, Smite, Teleport, Unleashed Teleport, Voidgrub camp, Baron Nashor, Elder Dragon, Dragon, Experience
  (champion), Control Ward, Stealth Ward, World Atlas, Runic Compass.
- Games of Legends (gol.gg), statistiques des joueurs pros de la saison 16 (supports : 3,8 à 4,4 de score de vision par
  minute, ~0,5 pink par minute).

### Recherche (mental, sessions, apprentissage)

- Sapienza, Zeng, Bessi, Lerman, Ferrara, « Individual performance in team-based online games », Royal Society Open
  Science 5:180329 (2018) — 242 000 parties classées : le winrate baisse de plus de 10 % entre la première et la dernière
  partie des sessions de 3 parties ou plus.
- Vardal et al., « Mind the gap », PLOS ONE 17(10):e0275843 (2022) — jouer moins par jour, sur plus de jours.
- Deng et al., « Streaks and Coping », CHI PLAY Companion 2024 — 597 680 parties de joueurs du haut de classement : séries,
  changements de champion, pauses.
- Bonilla et al., questionnaire TILT, Frontiers in Psychology 15 (2024) — le tilt dure en moyenne une trentaine de minutes.
- Monge & O'Brien, Media Psychology 25(1) (2022) — le flame dégrade la performance individuelle et d'équipe.
- Kleinman, Gayle, Seif El-Nasr, Frontiers in Psychology 12:780234 (2021) — c'est la planification avant la partie qui
  distingue les niveaux.
- DiFrancisco-Donoghue et al., BMJ Open Sport & Exercise Medicine 7(3) (2021) et Am J Physiol 326(3) (2024) — 6 minutes de
  marche toutes les 60 minutes.
- Do et al., FDG 2021 — l'expérience du joueur sur son champion prédit 75 % des résultats.
- iTero (analyses Riot API) : « Analyzing Tilt » (2020, ~100 000 parties : relancer juste après 2 défaites est le pire
  cas), « How to win your Solo Queue Draft » (2022, 1M+ parties), « Mastery: a statistical summary » (2023 : ~44 % de
  victoires sous ~20 parties sur un champion).

### Coachs et joueurs de haut niveau (vidéos 2023-2026, lues par Gemini ou via leurs sous-titres)

- [V01] Team Liquid — Perry (ex-jungler pro, coach), « How to Jungle in 2026 » (21/01/2026).
- [V02] Coach Chippys (ex-pro top, coach We Teach League), « Season 16 Top Lane Guide » (3/02/2026) ; « The Ultimate Wave
  Control Guide for Season 16 » (25/01/2026) ; « TOP 5 Most Important Laning Fundamentals » (26/08/2025) ; macro de mid
  game en 4 étapes (10/09/2026).
- [V03] Coach Mysterias (Challenger EUW, coach mid), « Season 16 Mid Lane Guide » (22/01/2026), « Mid Has CHANGED »
  (10/01/2026), 6 concepts de teamfight (26/06/2025).
- [V04] Broken by Concept #295 — Coach Curtis et Nathan Mott (Challenger OCE), mid game et tilt (6/04/2026).
- [V05] Agurin (n° 1 EUW, jungler), astuce de jungle (12/11/2026) ; [V06] Coach Leo (ex-pro jungler), Agurin contre
  Canyon (12/11/2026).
- [V07] Neon (ex-ADC LEC), « The Ultimate ADC Guide for 2026 » (25/12/2025) ; [V08] xFSN Saber (ADC), « How to Lane on
  ADC » (25/05/2026).
- [V09] et [V15] ShoDesu (support), roam timers (2023) et macro de mid/late game (2023) — logique de wave intemporelle.
- [V10] Skill Capped, guide support (24/04/2026) ; macro saison 16 (13/02/2026) ; macro top saison 16 (22/05/2026) ; guide
  mid (13/11/2026) ; coach « Strompest » (mid, 10/07/2026) ; coach « Hector » (top, 8/05/2026) ; guide top (6/11/2026).
- [V11] evandabank (bot lane), gestion des waves en bot (27/10/2026).
- Coach Kirei (jungler, 25/12/2025), Eagz (coach jungle, 10/09/2026), Shok (mid, « How to sidelane », 19/03/2025).
- Inven Global : réactions des joueurs LCK à la pré-saison 2026 (7/01/2026, le TP reste indispensable au top), interview de
  Faker sur TP contre Fantôme au mid (23/01/2026). Cours de BrokenBlade (top) et Pobelter (mid), Aim Lab (2022).
- Plus faible poids (logique seulement) : guides Mobalytics (PicklePants, 2025), Dignitas (2018-2022), Red Bull (warding,
  10/2026), LoLTheory (2025-2026).

### Données d'Ascend

- Cache local (lecture seule) : 3 004 parties classées (patchs 16.1 à 16.10) et 207 timelines — calibrage des règles et
  vérification des timers 2026 (section 3).

## 5. Ce qui a changé dans le moteur, et pourquoi

### 5.1 Assistant : 9 règles et 2 indicateurs de plus (41 règles)

Deux indicateurs par partie, lus dans le match déjà en cache (aucun appel Riot de plus) : **pinks achetées**
(`controlWards`) et **part de la partie passée mort** (`deadPct`).

| Règle | Seuil | Pourquoi |
|---|---|---|
| `dead_time_high` | moyenne récente ≥ 14 % du temps de jeu passé mort (5 parties) | sur nos 3 004 parties : < 5 % → 84 % de victoires, 8-11 % → 50 %, ≥ 14 % → 31 % ou moins |
| `pg_dead_time_high` | ≥ 17 % dans la partie et bien au-dessus de l'habitude du joueur | même calibrage |
| `support_control_wards_low` | support, moins de 2 pinks par partie | 0 pink → 41 %, 1 → 47 %, 2+ → ~51 % ; plancher confirmé par les stats pros et les guides |
| `control_wards_never` | laner ou jungler, aucune pink dans 4 des 5 dernières parties | 0 → 47-48 %, au moins 1 → 51-54 % |
| `support_vision_benchmark` | support, moins de 1,8 de vision/min | < 1,5 → 31 %, 1,5-1,8 → 41 %, ≥ 2,7 → 55 %+ ; pros à ~4 |
| `jungle_vision_benchmark` | jungler, moins de 0,7 de vision/min | < 0,6 → 40 %, ≥ 1,0 → 54 %+ |
| `two_loss_stop` | 2 défaites d'affilée dans la session → pause de 30 min | relancer tout de suite après 2 défaites donne la pire partie suivante (iTero) ; tilt ≈ 30 min (TILT 2024) |
| `movement_break` | 1 h de jeu continu sur 2 parties ou plus → 6 min de marche | essais randomisés auprès de joueurs d'esport (2021, 2024) |
| `new_champion_learning` | partie sur un champion joué moins de 5 fois auparavant | ~44 % de victoires sous ~20 parties sur un champion (iTero 2022-2023, Do et al. 2021) |

Réglages modifiés : `loss_streak` et `tilt_break` proposent 30 minutes de pause (au lieu de 10 et 15) ; `long_session`
se déclenche à la 4e partie (au lieu de la 6e) ; `weak_champion_pool` attend 20 parties (10 parties ne disent rien :
4 victoires sur 10 sont compatibles avec un vrai winrate de 17 à 69 %) ; `bad_hour_performance` exige 20 parties de nuit
**et** 20 de jour.

### 5.2 Codex : 34 fiches de plus (109) et 18 fiches corrigées

- **Nouvelles fiches**, chacune fiche par défaut d'un trio (tag, rôle, phase) qui n'en avait pas ou retombait sur une
  autre phase (testé : `tests/unit/codexResearch2026.test.ts`) :
  - Baron : mourir seul de son côté en mid game (dès 20:00) et en late (timers de 45 à 60 s).
  - Runes et draft (`bad-rune-choice`), kiting pour tous les champions à distance, maximisation des dégâts pour tous.
  - Top : TP d'invocateur contre TP de quête, rythme de side lane, ouverture et quête, Larves contre Dragon en 2026.
  - Mid : budget de roam (wave suivante, quota de quête), prio avant les objectifs, resets avec les Homeguards.
  - ADC : quête puis mid, menace en teamfight, niveaux du duo (9e sbire).
  - Support : roams avant le niveau 5, cycle de vision, vision en late à deux, peel ou engage.
  - Jungle : horloge 2026 et Smite, « contester ou échanger », Baron/âme/Ancestral.
  - Tous rôles : dives de mid et de late game, timers de respawn, side waves avant la Baron, crash puis rotation,
    resets avant les objectifs, farm et XP du mid/late game, escarmouches, engages, wards ennemies, lecture des
    compositions.
- **Corrections 2026** dans les fiches existantes : Carapateur 2:55, camps 0:55 (alerte du gank 3 camps vers 2:00, camps
  de retour vers 3:40-3:45), Smite 1 000/1 400, plates 120 g et permanentes, Baron à 20:00, portée d'XP 1 500, 2 tirs de
  tour pour un sbire de mêlée, reset vers T-1:30 avant un objectif (sur place 45 à 75 s avant), seul le laner du côté
  opposé pousse sa side dès T-2:30, Épée B. F. à 1 300 g (40 AD), niveaux du duo bot, TP de quête jamais pour une wave,
  recall sous Baron selon la situation. Les tests qui épinglaient les anciens chiffres ont été mis à jour.

### 5.3 Fondamentaux

13 descriptions de KPI portent maintenant le chiffre vérifiable correspondant (temps mort, reset avant objectif, pinks,
horloge des camps, niveau 2, pause après 2 défaites, fatigue de session, TP de quête, courbe d'apprentissage d'un champion,
répartition des lanes, CS parfait à 10:00) ; le fondamental « Prise de décision » gagne le KPI « Conversion des timers de
respawn ». Le français reste un miroir exact de l'anglais (testé).

## 6. Ce qui n'a pas été repris, et pourquoi

- **Les détecteurs encore réglés sur l'horloge de 2025** (hors du périmètre de cette branche,
  `src/lib/microReview/anomalyDetector.ts` et `electron/main/mistakeRules.ts`) : fenêtre du Carapateur V10 (3:25-3:50,
  il faut maintenant ~2:50-3:15), fenêtres de gank V3 (2:25-3:00 et 3:15-4:25, environ 35 s trop tard), premier back du
  jungler V7 (4:05), poids d'Atakhan dans l'estimation de partie (sans effet en 2026 : il n'y a plus d'événement). À
  traiter dans une session dédiée, avec `ANALYSIS_VERSION` relevé.
- **M15 (« mort pendant l'objectif »)** : la formule fiable du respawn qui manquait est maintenant connue (section 3) ; la
  règle reste à écrire dans `mistakeRules.ts` (hors périmètre).
- **Les contrôles de macro proposés par la recherche** (pick non converti, Baron gaspillée, objectif donné gratuitement,
  ADC seul du côté opposé, push pendant que l'équipe reset, or non dépensé à T-60) : vérifiables sur la timeline, mais ce
  sont de nouveaux détecteurs du Labo ou de la micro-revue, pas des règles de l'assistant. Listés pour une prochaine
  itération ; les fiches qui les enseignent existent déjà.
- **Le mélange de dégâts de l'équipe** (moins de 20 % ou plus de 80 % de physique) : demanderait les dégâts des cinq
  alliés dans le feature store ; gardé comme conseil dans la fiche de draft.
- **Les pics de puissance par classe** : aucune source 2026 fiable ; enseigné par la comparaison d'objets, pas par des
  timings fixes.
- **Des nombres de pinks « haut niveau »** venant de pages peu crédibles : remplacés par nos propres percentiles par rôle.
- **« S'arrêter après 2 victoires »** (un blog) : aucune donnée ne le soutient (les pauses après une victoire n'ont pas
  d'effet).
- **Le gel de wave à « +3 casters »** contre « 4 à 5 sbires d'avance » : les sources divergent ; la fiche existante (et son
  test) gardent 4 à 5.
- **Les replays qui expirent à chaque patch** : sans objet pour Ascend, qui enregistre ses propres vidéos.
