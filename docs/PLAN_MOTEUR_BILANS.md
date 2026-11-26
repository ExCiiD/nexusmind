# Plan moteur : bilans des roams, des ganks et des quêtes de rôle

_26/11/2026, Chief. Suite des propositions de la session Engine du 20/11. Analyse faite à partir des 4 rapports
(`engine-reports/2026-11-20-bilan-des-roams-mid`, `…-tous-laners`, `…-quetes-de-role-dans-le-bilan-des-roams`,
`…-bilan-des-ganks-jungle`), du code actuel (`src/lib/microReview/`, ANALYSIS_VERSION 14) et du registre
`DECISIONS.md`. **Mise à jour 26/11 soir : phases 0a, 0b, 1 à 5 et textes Front faits, rien commité, aucun affichage actif** (voir § 8)._

## 1. Ce qui est déjà livré, ce qui reste

| Proposition du 20/11 | État au 26/11 | Preuve dans le code |
|---|---|---|
| Pas de cross-map reproché aux laners en soloQ avant 14:00 (+ flex hors session = soloQ) | **Livré** | `DETECTOR_SPEC.soloQLaning`, `teamContext` (`teamContext.ts`) |
| Carte « hésitation » juste (apparition de l'objectif, setup mid, heures citées) | **Livré** | `spawnOf()` dans `anomalyDetector.ts` |
| Lieux en mots, extraits vidéo 45 s / 30 s pour toutes les morts | **Livré** (mini-carte en attente de maquette) | cartes de micro-review, ANALYSIS_VERSION 12 |
| Saison en cours seulement, retrait de 2025 | **Livré** | `seasonOf` → `current` / `unsupported` |
| **Bilan des roams du mid** | **À faire** | seuls `mid-roam-plates` et `bad-rotation` existent (règles de coût seul, sans gain) |
| **Bilan des roams, tous les laners (support payé par l'ADC)** | **À faire** | rien par rôle |
| **Quêtes de rôle dans le bilan** | **À faire** | pas de `roleQuest.ts`, pas de `patchOf()` |
| **Bilan des ganks du jungler** | **À faire** | seul `jungle-camps-up-gank` (V7, une minute, coût seul) |
| Points ouverts d'`ENGINE_NOTES.md` § 4 | **À faire**, petits | M8 (larves), respawn 19-20, texte Krugs/Gromp, 3 tags de fiche, 6 détecteurs de macro non écrits |

Les quatre chantiers à faire partagent le même socle : **ils sont donc planifiés ensemble, pas en quatre projets**.

## 2. Analyse : comment l'implémenter

### 2.1 Architecture retenue

Principe : **trois fonctions pures dans de nouveaux fichiers**, branchées dans `anomalyDetector.ts` par quelques lignes.
`anomalyDetector.ts` fait déjà 1 819 lignes et n'a qu'un écrivain à la fois : y ajouter les ledgers en ligne le
rendrait ingérable et bloquerait les autres lots.

| Nouveau fichier | Contenu | Réutilise |
|---|---|---|
| `src/lib/microReview/ledgerCore.ts` | échantillonnage de position toutes les 5 s (`posAt` interpolé), repérage d'une sortie de lane (`tOut`, `tBack`, fusion à 60 s), fenêtres de coût / gain / suite, conversion en `Δz` | `winProbability.ts` (échelle unique or + XP + objectifs), `geometry.ts` (`laneOf`, `zoneOf`, rayons) |
| `src/lib/microReview/roamLedger.ts` | `roamLedger(match, timeline, pid)` + `ROAM_ROLE_SPEC` (qui paie, lane laissée, fenêtre, par rôle) ; verdict rentable / neutre / perdant | `ledgerCore`, `deathTimerSec`, `bountyGold` |
| `src/lib/microReview/gankLedger.ts` | bilan par gank : camps perdus, écart avec le jungler ennemi avant / après, compensation de l'autre côté | `ledgerCore`, `jungleCsOf` |
| `src/lib/microReview/roleQuest.ts` | `questCompletion` (lecture des `ITEM_DESTROYED` des objets de quête), `questProgress`, `questGap` | `patchOf()` |
| `gameClock.ts` (ajout) | `patchOf(match)` : paliers 16.9 et 16.16 (taxe du support, budget de quête) | `seasonOf` |

Branchements dans `anomalyDetector.ts` : § « mid-roam-plates » (~l. 1725) et « bad-rotation » (~l. 1750) sont
**remplacés** par l'appel au ledger quand un roam est repéré ; `jungle-camps-up-gank` (~l. 1590) est remplacé par
`jungle-gank-unpaid`. Règle « un événement, une lecture » (ENGINE_NOTES § 3) : un roam ne produit jamais aussi
`bad-rotation` ni la carte de 10:00 ; un gank ne produit jamais aussi `jungle-camps-up-gank`.

### 2.2 Ce que les données prouvent (et ne prouvent pas)

- **Prouvé** : positions à la minute + événements à la ms (kills, tours, plaques, monstres), CS / XP / or à la minute,
  PV et mana aux relevés, achats (un achat vivant prouve la fontaine), `ITEM_DESTROYED` (fin de quête).
- **Non prouvé** : état des waves et freeze (texte au conditionnel), sorts (Flash, TP, Smite), pression sans kill,
  position des wards, quel camp a été pris. Conséquence assumée par les rapports : le moteur penche vers **neutre /
  échange** plutôt que vers un faux reproche. Cohérent avec « une carte fausse coûte plus de confiance qu'une carte
  manquée ».
- **À vérifier avant tout code (phase 0)** : champs `bounty` / `shutdownBounty` des `CHAMPION_KILL` dans les timelines
  en cache (le code ne les lit pas ; sinon repli sur `bountyGold`), ids des objets de quête par palier 16.x, présence de
  `minionsKilled` du jungler pour la preuve de présence en lane.

### 2.3 Contraintes du registre des décisions

| Décision | Effet sur ce chantier |
|---|---|
| 20/11 cross-map soloQ, avant 14:00 | Le ledger ne reproche rien « hors lane » à un laner en soloQ avant 14:00 sans coût mesuré ; un roam **mesuré** (CS / XP perdus, suite adverse) reste jugé : c'est un coût, pas du cross-map. Garder `teamContext`. |
| 20/11 aucune unité de distance, lieux en mots | Les cartes de roam / gank citent des lieux en mots et des heures, jamais de distance. `microReviewNoUnits.test.ts` couvre déjà. |
| 20/11 saison en cours seulement | `patchOf()` ne sait lire que 16.x ; une partie 15.x reste « non analysée ». Les paliers 16.9 / 16.16 viennent des notes de patch. |
| 21/11 notes pré-remplies = **seulement les moments de micro-review** | Les rapports proposent « une ligne par gank / roam » en review : **à ne faire que pour les roams et ganks perdants (qui sont des moments)**. Les roams rentables ne produisent aucune ligne. |
| 21/11 bouton « Not a mistake » + apprentissage des corrections | Chaque nouveau schéma a une sortie justifiée (« échange assumé ») et passe par le mécanisme de correction existant ; il alimente le registre des corrections. |
| 21/11 « Je tague mes erreurs moi-même » / « reviews moi-même » | Aucun moment ni erreur auto enregistré pour ces utilisateurs : rien à changer, à tester. |
| 24/11 vitesse, pas réduction des données | Le calcul reste sur les timelines en cache (déjà parsées) ; calibrage en lecture seule du cache, aucune requête Riot de plus. |

### 2.4 Cache et coût de recalcul

Tout changement de sortie du détecteur monte `ANALYSIS_VERSION` (14 → 15, **un seul cran pour les phases 1 à 4**
si elles sont livrées dans la même release, comme le prévoient les rapports). Mesurer le temps de recalcul d'une
analyse en cache avant / après : le ledger échantillonne toutes les 5 s sur 20 minutes, soit ~240 points par joueur et
par roam candidat ; à surveiller sur les timelines de 40 minutes.

## 3. Calibrage : une règle commune aux trois ledgers

Aucun seuil `netThreshold` n'est fixé « à l'œil ». Pour chaque ledger, un script en **lecture seule** sur le cache
(16.x seulement) produit, avant d'activer l'affichage :

1. nombre d'événements (roams, ganks) pour 100 parties-joueur, par rôle ;
2. répartition du `net` ;
3. winrate selon le verdict (« le verdict doit séparer les parties gagnées des perdues », comme pour les règles de
   novembre) et selon le timer (support) ;
4. **20 cas « perdants » relus à la main** par rôle ; si plus de 3 sont des faux positifs, le seuil monte ;
5. le résultat (date, échantillon, seuils retenus) est figé dans `DETECTOR_SPEC` en commentaire, comme les autres.

**Livraison en deux temps** : le ledger tourne et sa mesure est écrite dans l'analyse (champ interne) **avant**
d'afficher une carte. On regarde les chiffres sur les vraies parties de l'utilisateur, puis on active les cartes.

## 4. Planification : lots complets, par fichiers

Un écrivain par fichier. Le Back-end est seul sur `anomalyDetector.ts`, `smartQcm.ts`, `gameClock.ts`, les nouveaux
fichiers `microReview/*`, `codex.json`, `electron/main/assistant/*` et `microReview.ipc.ts`. Le Front-end ne prend que
`src/components/MicroReview/`, `src/i18n/`. Les textes fr / en : jargon LoL en anglais (wave, trades, gank, roam,
freeze, back).

| Phase | Contenu | Session | Fichiers | Effort | Dépend de | Critère de fin |
|---|---|---|---|---|---|---|
| **0a** | Vérifications du § 2.2 (bounty, ids de quête par patch, preuve de présence) + mesure du temps de recalcul actuel | Back | script lecture seule ; rapport `engine-reports/2026-11-26-verifs-bilans.md` | 0,5 j | feu vert A1 | Chaque point : oui / non / repli décidé |
| **0b** | **Hygiène moteur** (indépendante, parallèle) : M8 larves (D1), respawn 19-20, texte Krugs / Gromp 1:07, 3 tags qui retombent sur une fiche d'une autre phase | Back | `mistakeRules.ts`, `gameClock.ts` (après 0a), `codex.json` | 1 j | — | tests verts, ANALYSIS_VERSION regroupée avec la phase 1 |
| **1** | **Socle + roam du mid** : `ledgerCore`, `patchOf`, `roamLedger` (mid), `DETECTOR_SPEC.roam`, branchement à la place de `mid-roam-plates` / `bad-rotation` (mid), schéma `mid-roam-unpaid`, contexte QCM `mid-roam` (gains, suite, `freezeLikely`), `bad-wave-sync` dans la fiche Codex roam du mid, calibrage | Back | `ledgerCore.ts`, `roamLedger.ts`, `gameClock.ts`, `anomalyDetector.ts`, `smartQcm.ts`, `codex.json`, `tests/unit/microReviewRoam.test.ts` | 2,5 j | 0a | cas du rapport mid verts (9 cas), seuils calibrés et figés, `MOMENT_PATTERNS` itéré par les tests existants, vitest + tsc + lint |
| **1F** | Textes `microReview.*` fr + en du mid (résumé avec gains et suite, raisons, sortie justifiée) | Front | `src/i18n/locales/*.json`, `MicroReviewPanel.tsx` si besoin | 0,5 j | 1 | `check:i18n`, `microReviewI18n.test.ts` |
| **2** | **Tous les laners** : `ROAM_ROLE_SPEC` top / ADC / support, support payé par l'ADC (PV, mana, gold et XP contre l'ADC adverse), timers du support (wave crash, recall, 1-2 kills), TP probable du top, 4 schémas, nouvelle fiche Codex ADC | Back | `roamLedger.ts`, `anomalyDetector.ts`, `smartQcm.ts`, `codex.json`, tests | 1,5 j | 1 | 11 cas du rapport « tous les laners » verts, calibrage par rôle et par palier de patch (16.9, 16.16) |
| **2F** | Textes des 3 autres rôles et des timers ; relecture de la fiche ADC | Front | i18n | 0,5 j | 2 | idem 1F |
| **3** | **Ganks du jungler** : `gankLedger`, `jungle-gank-unpaid` à la place de `jungle-camps-up-gank`, preuve de présence par les sbires de lane, contexte `jgl-gank-camps-up` réutilisé | Back | `gankLedger.ts`, `anomalyDetector.ts`, `smartQcm.ts`, tests | 1,5 j | 1 (socle) | 10 cas du rapport gank verts, calibrage (valeur d'un camp sans revenu passif, Carapateur) |
| **3F** | Textes des ganks (résumé, timers, verdicts) | Front | i18n | 0,25 j | 3 | idem |
| **4** | **Quêtes de rôle** : `roleQuest.ts` (fin de quête lue sur l'objet détruit, table d'ids par patch), terme `questWeight` dans le verdict si la régression le justifie, sinon **écart réel affiché seul** | Back | `roleQuest.ts`, `roamLedger.ts`, `features.ts`, tests | 1,5 j | 1, 2 | modèle de points validé (fin estimée à moins de ~45 s de la réelle pour la plupart des joueurs) ; sinon repli documenté |
| **4F** | Ligne « Quête » (carte + review) fr + en | Front | i18n | 0,25 j | 4 | idem |
| **5** | **Assistant** : indicateurs (`roams`, `roamsPaid`, `ganks`, `ganksPaid`, `campsLostPerGank`, `questGapSec`), règles `jungle_gank_unpaid_pattern` et équivalent roam, critères d'expérience (≥ 60 % de ganks rentables ou en échange sur 5 parties) | Back | `assistant/features.ts`, `rules.ts`, `problems.ts`, `experiments.ts`, tests | 1 j | 3, 4 | règles seulement si la distribution les justifie |
| **6** | Encart « Bilan des roams / des ganks » dans la Review | Graphic (Penpot) → Front | maquette, puis `src/components/MicroReview/` | 1 j + 0,5 j | décision A2, phases 1-4 calibrées | maquette « Validée » avant tout code |
| **7** | Revue groupée Audit + Cyber (aucun IPC ni base touchés : Cyber seulement si 5 ou 6 changent l'IPC), puis release sur accord | Audit | — | 0,5 j | 1-5 | verdict OK |

**Totaux** : Back ≈ 8,5 j (0a 0,5 + 0b 1 + 1 2,5 + 2 1,5 + 3 1,5 + 4 1,5 + 5 1), Front ≈ 1,5 j de textes (+ 1,5 j si
l'encart est validé), Graphic 1 j (maquette de l'encart, option). Livrable en **trois releases** si on veut limiter le
risque : (a) phases 0 + 1 + 1F ; (b) 2 + 3 + F + 4 ; (c) 5 + 6.

**Ordre et parallélisme.** 0b est indépendant (autres fichiers) : il tourne en même temps que 0a et 1. 2 et 3 se
séparent sur deux jours-fichiers mais touchent tous deux `anomalyDetector.ts` et `smartQcm.ts` : à faire **en série par
le même Back**, ou en deux worktrees avec fusion par le Chief. Les textes Front de chaque phase partent en un seul lot
une fois la phase Back verte (règle token : un message = un lot).

## 5. Ce que le joueur verra

- **Micro-review** : un roam ou un gank perdant devient un moment (jamais plus de 3 moments) avec résumé factuel
  (heures, lieu en mots, CS / XP / camps perdus, gains, ce que l'adversaire en a tiré), QCM (cause) et sortie justifiée
  « échange assumé ».
- **Codex** : fiches déjà écrites (mid, support, jungler) + une nouvelle fiche « roam de l'ADC en lane ».
- **Review** : une ligne dans les notes pré-remplies **uniquement pour un roam ou un gank perdant** (décision du 21/11).
  L'encart « Bilan » (roams et ganks, rentables compris) n'existe qu'après la maquette (A2).
- **Mon plan / assistant** : un focus « Farm d'abord, gank sur un timer » ou équivalent roam, seulement si les données
  le justifient.
- **Labo d'erreurs** : rien d'automatique au début ; une règle M\* seulement après calibrage.

## 6. Risques et garde-fous

| Risque | Garde-fou |
|---|---|
| Faux reproches (relevés de 60 s, freeze et sorts invisibles) | Verdict neutre en cas de doute ; texte au conditionnel ; calibrage avec relecture manuelle ; livraison silencieuse avant affichage |
| Double lecture d'un même événement | Tests « un roam ne produit jamais `bad-rotation` ni la carte de 10:00 » et « un gank ne produit jamais `jungle-camps-up-gank` » |
| Support : XP de l'ADC seule trompeuse, wards sans position | Verdict suit le duo ; roam du support sans kill avec wards et coût faible = neutre, jamais perdant |
| Quêtes : modèle approximatif, une seule source (wiki), ids propres à chaque patch | Ancrage sur la vraie fin de quête ; sinon l'écart réel seul ; test qui échoue si une partie 16.x du cache n'a aucun objet de quête reconnu |
| Nouveau patch (16.x suivant, 2027) | Table d'ids et paliers par patch ; mode prudent pour un patch inconnu (rapport « saison courante et saison 2027 ») ; `docs/engine-timings.json` + `scripts/check-patch-timings.mjs` (non commités, d'une autre session) à relier à `patchOf` |
| Temps de recalcul du cache (ANALYSIS_VERSION) | Mesure avant / après en phase 0a ; un seul cran |
| Conflits d'écriture sur `anomalyDetector.ts` | Back seul dessus ; ledgers dans des fichiers à part |

## 7. Feu vert demandé (en attente, voir `DECISIONS_EN_ATTENTE.md`)

1. **A1** : lancer la phase 0 (0a + 0b) puis la phase 1, en livraison silencieuse avant affichage ? Aucune écriture
   hors du code et des docs, aucune base touchée, aucune requête Riot nouvelle. Sans réponse, **rien n'est délégué**.
2. **A2** : maquette de l'encart « Bilan » (phase 6) seulement après calibrage.
3. Le Chief ne commite ni ne publie : la release se fait sur demande.

## 8. Avancement au 26/11 (soir)

| Phase | État | Livrable |
|---|---|---|
| 0a | Fait | `engine-reports/2026-11-26-verifs-bilans.md` (bounty 100 %, ids de quête stables 16.1-16.23, ~1 ms par analyse) |
| 0b | Fait | M8 et Krugs/Gromp étaient déjà corrigés ; fiches Codex de late game départagées par phase (`codexPhaseFallback.test.ts`) |
| 1, 1F | Fait, **désactivé** | `roamLedger.ts` (mid), `mid-roam-unpaid`, textes fr/en |
| 2, 2F | Fait, **désactivé** | top / ADC / support, timers du support, fiche Codex ADC, textes |
| 3, 3F | Fait, **désactivé** | `gankLedger.ts`, `jungle-gank-unpaid`, textes |
| 4, 4F | Fait en écart réel | `roleQuest.ts` → `GameAnalysis.quest` ; aucun terme dans le verdict (double compte) ; la clé `questGap` n'est pas encore branchée à l'interface |
| 5 | Indicateurs seulement | `bilanOf` dans `features.ts` ; aucune règle (0 à 1,5 % des fenêtres de 5 parties) |
| 6 | Non lancée | encart « Bilan » : attend A2 |
| 7 | Non lancée | revue Audit + Cyber, release sur accord |

`ANALYSIS_VERSION` = 16 ; vitest 2256 verts. **Activation** seulement après A1b / A1c (seuils : mid 1,25, top 1,5, ADC 1,25, support 1,25, ganks 2,5). Les scripts `scripts/calibrate-*.ts` se relancent après tout changement de seuil.
