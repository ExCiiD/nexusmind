# Inventaire : ce qu'on garde et ce qu'on supprime de l'avant-2026

_20/11/2026, session Engine. Décision de l'utilisateur : « garde les règles générales datant d'avant 2026 qui ne
contiennent pas de timer précis, supprime le reste ». Ce rapport applique cette règle à tout le moteur. Il complète
[`2026-11-20-saison-courante-et-saison-2027.md`](2026-11-20-saison-courante-et-saison-2027.md). Lecture seule du code :
la suppression elle-même revient au Back-end, après accord._

**Critère.**
- **On garde** une règle qui vaut quelle que soit la saison : un seuil d'or, une distance, un nombre d'ennemis, un écart
  avec le vis-à-vis, ou un point de mesure comme « à 10:00 » ou « après 14:00 ». Ce dernier point est un repère de phase
  de jeu, encore vrai en 2026 : les waves passent à 25 s à 14:00.
- **On supprime** toute valeur ou tout timer propre à 2025 : horloge du début de partie, Baron à 25:00, plaques qui
  tombent à 14:00, Héraut jusqu'à 24:45, Atakhan, table de respawn 2025. On supprime aussi le code qui ne sert qu'à
  analyser les parties 15.x.

## 1. On garde : règles générales sans timer propre à 2025

| Règle | Où | Pourquoi elle reste |
|---|---|---|
| M1 mort avec de l'or non dépensé (> 1 500 g, grave > 2 500) | `mistakeDetector.ts` | seuil d'or, sans timer |
| M2 dive (mort à moins de 700 d'une tour ennemie) | idem | distance |
| M3 back tardif (> 2 000 g, aucun achat depuis 4 min) | idem | durée relative, pas un timer de partie |
| M4 overstay (plaque dans les 20 s, ou > 60 % du chemin) | idem | relatif |
| M5 mort avant un objectif perdu (60 s) | `mistakeRules.ts` | relatif à l'objectif (on retire seulement Atakhan de la liste, § 2) |
| M6 pas de ward avant un objectif (90 s), M7 trinket oublié (4 min / 2 min 30) | idem | relatifs |
| M9 pris seul (après 14:00), M10 mauvais trade (avant 14:00), M11 premier mort d'un fight | idem | 14:00 est un repère de phase, toujours valable en 2026 |
| M13 retard de CS à 10:00, M14 retard de niveaux à 10:00 ou 15:00 | idem | points de mesure, comparés au vis-à-vis |
| Schémas de la micro-review sans horloge du début de partie : fed-carry-first, pris en infériorité, piège du reset, devant sa vague, ADC qui rouvre une side lane, dive après inhibiteur, recall sous Baron, compensation, Dragon tanké, smite volé, tempo lines, hésitation, mauvaise rotation | `anomalyDetector.ts` | distances, PV, écarts, timers 2026 déjà en place (`DETECTOR_SPEC`) |
| Les 3 déclencheurs, la gravité, le choix des 3 moments, une mort = une lecture | idem | logique générale |
| Géométrie de la carte (fosses, tours, lanes, zones, ligne de tempo) | `geometry.ts` | même carte en 2026 |
| Estimation de partie (or, XP, objectifs ; garbage time < 0,18 ou > 0,85) | `winProbability.ts` | formule générale. On retire seulement le poids d'Atakhan |
| Note de lane S → F (14 premières minutes), radar, Labo (familles, coût en winrate), dédoublonnage, apprentissage des suppressions (MX3) | `lanePhaseAnalyzer.ts`, `fundamentalsRadarCore.ts`, `mistakeInsights.ts`, `mistakeDedupe.ts`, `mistakeTuning.ts` | logique générale |
| Assistant : problèmes, priorité, noisy-OR, expériences, garde-fous de bien-être | `electron/main/assistant/` | logique générale ; ses seuils viennent déjà des parties 16.x |
| Catalogue des 27 tags d'erreur | `mistakeTagCatalog.ts` | taxonomie générale |

**À recalibrer sur 16.x (mise à jour, pas suppression).** Il s'agit de nombres sans timer dont l'origine n'est pas datée
dans le code :
- les coefficients de `winProbability.ts` (0,0075 or, 0,004 XP, 0,28 objectif) ;
- les échelles du radar (`fundamentalsRadarCore.ts`) ;
- les poids de la note de lane ;
- les seuils M1 et M3.

À vérifier sur les parties 16.x en cache, et à ajuster seulement si l'écart est net.

## 2. On supprime : valeurs et timers 2025, et le code des parties 15.x

| À supprimer | Où | Ce qui le remplace |
|---|---|---|
| `CLOCK_2025` en entier (fenêtres de jungle, gank, tempo, niveau 2/3, cheater recall, support, premier back, Carapateur, mid roam, dive, tour de side lane, Héraut jusqu'à 25:00, fosses dès 14:00) et `detectorSpecFor` | `anomalyDetector.ts` | `DETECTOR_SPEC` seul (déjà sur l'horloge 2026) |
| `GameClock = 2025 \| 2026`, `gameClockOf`, `CLOCK_TIMES[2025]`, `BASE_RESPAWN_SEC[2025]` | `gameClock.ts` | `seasonOf(match)` → `'current'` ou `'unsupported'` (mode prudent pour une saison inconnue, voir le rapport saison 2027) ; une seule table de respawn |
| Branches 2025 des règles M\* : M8 Baron dès 25:00, M12 mort avant 4:00, `early = 0` (fenêtre M19 1:30-4:30), table de respawn 2025 de M15 | `mistakeRules.ts` | les valeurs 2026 seules (20:00, 3:25, 0:55-3:55) |
| Lecture des anciennes analyses comme 2025 (`f.season ?? 2025`) | `smartQcm.ts` | inutile : `ANALYSIS_VERSION` + 1 recalcule tout |
| **Atakhan** (supprimé du jeu en 26.1) : poids d'objectif, type d'objectif, libellés, sévérité M5 | `winProbability.ts`, `mistakeRules.ts` (`MAJOR_OBJECTIVES`, sévérité), `eventExtractor.ts`, `teamTimelineCore.ts`, `reviewNotes.ts`, `src/lib/ipc.ts`, `src/lib/analyst.ts`, i18n `atakhan` | rien : aucun événement Atakhan n'existe en 2026 |
| Commentaires de code qui comparent à 2025 (« 2025: 2:25–3:00 », « 2025: to 25:00 »…) | `anomalyDetector.ts`, `mistakeRules.ts`, `gameClock.ts` | commentaire 2026 seul |
| Cas de test 15.x | `anomalyDetectorMath.test.ts`, `microReviewSeason2026.test.ts`, `microReviewV5/V6/V7.test.ts`, `mistakeRules.test.ts` | un test « partie 15.x → non analysée » |
| Décision D3 (patchs 15.1-15.8) | `DONNEES_JEU_2026.md` | sans objet |
| Comparaisons 2025 dans les docs (« 25:00 en 2025 », tableaux 16.x contre 15.x, médianes 2025) | `RAPPORT_MOTEUR.md`, `RECHERCHE_CONNAISSANCES.md`, `DONNEES_JEU_2026.md` | valeurs 2026 seules. Ces docs ne sont pas à la session Engine : à confier au Chief ou au Back-end |
| Analyses de micro-review en cache et erreurs **auto** du Labo calculées sur des parties 15.x | base locale (`GameAnalysis`, `Mistake` avec la source « auto ») | rien. **Données du joueur, à confirmer** avant suppression (§ 3) |

**Codex (109 fiches) : déjà à jour.** Aucune fiche ne cite un timer 2025. Les « 25:00 » des fiches désignent le début de
la fin de partie (phase), avec des chiffres 2026. Une seule fiche cite encore l'ancienne saison :
`codex_baron_side_pairs_sweep_from_20` (« Atakhan a disparu »). Il suffit de retirer cette parenthèse. La fiche des
Faelights relève de la saison 2027.

## 3. Ce qui reste à décider

La règle porte sur les **connaissances** du moteur. Reste le cas des **73 parties 2025** en cache. J'ai vérifié sur une
copie de la base locale, en lecture seule :

- **Origine** : ce sont des parties classées solo (file 420) d'un des comptes Riot de l'utilisateur, aux patchs 15.20 à
  15.24 (du 15/10/2025 au 01/01/2026). Elles ont toutes été téléchargées le **19/11/2026 entre 19:30 et 19:35** (heure
  de Paris), en un seul lot : c'est la vérification des timers 2026 contre 2025, faite lors du recalage des détecteurs
  (« 73 en 15.x » dans `RAPPORT_MOTEUR.md` § 1.2).
- **Usage dans l'app : aucun.** Aucune ligne `Game` ne les référence. Elles n'ont donc ni session, ni analyse, ni erreur
  (auto ou manuelle), ni réponse de micro-review, ni review, ni vidéo, ni statistique détaillée. L'app ne lit le cache
  qu'à partir de l'identifiant de partie d'une `Game`, donc elles ne sont jamais lues. `MatchCache` n'est pas dans la
  synchronisation : elles n'existent que sur ce PC.
- **Ce qu'elles ont servi à faire** : seulement aux comparaisons 2026 contre 2025 des docs du moteur. Ces comparaisons
  sont justement celles qu'on retire.

**Recommandation mise à jour : les supprimer** du cache local (73 lignes de `MatchCache` dont le `gameVersion` commence
par 15.). C'est sans effet sur l'app et sur les statistiques du joueur. C'est irréversible, mais elles se
retéléchargent depuis Riot si besoin. Faire une sauvegarde avant, comme pour les suppressions du 19/11. Il s'agit d'une
base locale, pas de la production. **Accord de l'utilisateur requis.**

## 4. Découpage et effort

- **Back-end** (≈ 1 jour, à fondre dans le chantier « saison en cours ») :
  - retrait de `CLOCK_2025`, des branches 2025 et d'Atakhan ;
  - `seasonOf` ;
  - tests ;
  - `ANALYSIS_VERSION` + 1 ;
  - recalibrage du § 1 en lecture seule.
- **Front-end** (≈ 0,25 jour) : retrait des libellés `atakhan` (fr + en), mention « Saison précédente ».
- **Chief ou Back-end** : nettoyage des comparaisons 2025 dans `RAPPORT_MOTEUR.md`, `RECHERCHE_CONNAISSANCES.md` et
  `DONNEES_JEU_2026.md`.
- **Fait par la session Engine** : ses propres rapports ne contiennent plus de valeurs 2025 (les trois rapports sur les
  roams nettoyés ce jour), et `ENGINE_NOTES.md` porte la règle.

**Risque :** les erreurs auto et les analyses déjà vues par le joueur sur ses parties 2025 disparaissent de ses
statistiques. Le Labo et les tendances changeront donc un peu pour les joueurs qui ont beaucoup de parties 2025.
