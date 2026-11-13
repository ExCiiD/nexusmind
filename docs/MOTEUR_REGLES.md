# Moteur de coaching à règles métier — design

> Objectif : faire de NexusMind un **coach automatique** sans IA payante. Après chaque partie, l'app sait ce qui s'est passé, ce qui compte le plus pour ce joueur, quoi faire ensuite, et **vérifie si le conseil a marché**.
> Point de départ (13/11/2026) : feature store (`assistant/features.ts`), ~28 règles déclaratives (`assistant/rules.ts`), pondération par 👍/👎 (`weights.ts`, Thompson sampling), facteurs de victoire (`regression.ts`, régression logistique), détection d'erreurs M1–M13 (`mistakeDetector.ts`, `mistakeRules.ts`), rapport de phase de lane, catalogue [`AUDIT_REGLES_METIER.md`](AUDIT_REGLES_METIER.md).

---

## 1. Ce qui manque aujourd'hui

Les briques existent mais travaillent **chacune de leur côté** :

1. **Pas de diagnostic commun.** « Morts avant 14 min » (assistant), `bad-trade` et `bad-lane-opening` (Mistake Library) et une lane notée D décrivent le même problème, mais produisent trois messages séparés.
2. **Priorité sans notion d'impact.** Le score actuel est `priorité × confiance × 👍/👎`. Il ne dit pas *combien ce problème coûte de victoires à ce joueur*.
3. **Conseils sans suivi.** Un conseil est affiché, puis oublié. Rien ne mesure s'il a été appliqué ni s'il a eu un effet.
4. **Apprentissage limité aux votes.** Le moteur apprend de 👍/👎, pas des **résultats** (le joueur s'améliore-t-il après le conseil ?).
5. **Automatisation partielle.** Les reviews, bookmarks, fins de session et choix de la game à revoir restent manuels alors que les données suffisent.

## 2. Architecture : une boucle fermée en 5 étages

```
 Événements (fin de partie, timeline en cache, ouverture de session, inactivité, lundi)
        │
 ① SIGNAUX ─────── faits typés et prouvables (par game, session, période, contexte)
        │
 ② DIAGNOSTIC ──── règles → constats → regroupés en PROBLÈMES (taxonomie liée aux fondamentaux)
        │
 ③ PRIORITÉ ────── impact sur la victoire × persistance × confiance × actionnabilité × apprentissage
        │
 ④ PRESCRIPTION ── 1 focus + 2 conseils max, chacun avec une action et un CRITÈRE MESURABLE
        │
 ⑤ SUIVI ───────── expérience sur N games → verdict (acquis / en progrès / sans effet)
        │               └─→ réinjecté dans ③ (apprentissage par résultat) et ④ (focus suivant)
        └──────────────────────────────────────────────────────────────────────────────┘
```

Principes inchangés : **tout est local, reproductible et explicable** ; une règle n'affirme que ce qu'elle peut prouver ; le joueur garde le dernier mot (le « pourquoi » d'une erreur, le choix final de l'objectif).

### ① Signaux

Extension du feature store, toujours en fonctions pures :

| Niveau | Signaux existants | Ajouts |
|---|---|---|
| Game | CS/min, CS@10/14, écart d'or 10/14, morts (<10, <14), vision/min, KP, KDA, note de lane, KPI, respect d'objectif, perfIndex, erreurs par tag | écart d'XP 10/15, participation aux objectifs, durée, rang de la game dans la session, heure locale, champion, adversaire direct |
| Session | nb de games, durée, défaites, séries | heure de début, écart de perf entre games 1-3 et 4+ |
| Période | moyenne, tendance, z-score personnels | profils meilleures/pires games (B4), stats par champion, par tranche horaire |
| Joueur | taux de review, games non reviewées, run d'objectif | expériences en cours et passées, fondamentaux « diplômés », réglages appris (MX3) |

Chaque signal porte sa **provenance** (games, horodatages) pour que l'explication cite des faits.

### ② Diagnostic : constats → problèmes

- Une règle (existante ou nouvelle, assistant **ou** Mistake Library) ne produit plus directement un message, mais un **constat** : `{ problème, portée (game / session / tendance), sévérité, confiance, preuves[] }`.
- Une **taxonomie de problèmes** (~25 entrées) relie chaque constat à un fondamental, par exemple :

| Problème | Fondamental | Alimenté par |
|---|---|---|
| `early-laning-deaths` | trades / wave_management | règles morts <14 min, M10 `bad-trade`, M12 `bad-lane-opening`, lane D/F |
| `farming` | csing_pathing | CS/min, CS@10, M13 `cs-deficit` |
| `objective-setup` | wave_management_objectives / vision_control | M5, M6, M15, participation aux objectifs |
| `isolated-deaths` | map_awareness / catch_prevention | M8, M9, M2 `dove-tower` |
| `gold-management` | recall_timing | M1 `unused-gold`, M3 `late-back` |
| `vision` | vision_control | vision/min, M7 `forgot-trinket` |
| `teamfight-positioning` | positioning | M11 |
| `tilt-fatigue` | resilience / fortitude | séries de défaites, longues sessions, AS5 |
| `self-assessment-bias` | (méta) | biais KPI (R3) |
| `pool` | pool_coherence | AS3 |

- **Déduplication par agrégation** : plusieurs constats sur le même problème fusionnent ; la confiance combinée est un *noisy-OR* (`1 − Π(1 − cᵢ)`), donc deux indices faibles concordants pèsent plus qu'un seul. Le message affiché est celui du problème, avec toutes les preuves en détail.

### ③ Priorité : ce qui coûte le plus de victoires

```
score(problème) = impact × persistance × confiance × actionnabilité × multiplicateur_appris
```

- **Impact** : effet estimé du fondamental sur la victoire **pour ce joueur**, via la régression logistique existante (≥ 15 games). En dessous, valeur a priori par rôle (table fixe, documentée).
- **Persistance** : part des games récentes où le problème apparaît (une erreur isolée < une habitude).
- **Confiance** : agrégée en ②, plafonnée si peu de données (< 5 games → plafond 0,5).
- **Actionnabilité** : 1 si une prescription mesurable existe, 0,6 sinon.
- **Multiplicateur appris** : Beta-postérieur existant (👍/👎) **plus** les verdicts d'expériences (⑤).
- **Anti-répétition** : un même problème n'est pas répété plus de 3 jours de suite sans nouvelle preuve (journal des conseils).

### ④ Prescription : un focus, pas une liste

- **1 focus principal** (le problème n°1, lié à l'objectif de session) + **2 conseils secondaires** au maximum par moment (après la partie, début de session, bilan de la semaine).
- Chaque problème a des prescriptions, chacune avec un **critère mesurable** :

| Type | Exemple | Critère |
|---|---|---|
| Objectif-expérience (S2) | « Morts avant 14 min : 1 max » | tenu dans ≥ 70 % des 5 prochaines games |
| Revoir des moments | clips à t − 15 s des erreurs sévérité 3 (MX5) | clips ouverts |
| Review ciblée (R4) | « Revois cette défaite serrée en priorité » | review faite |
| Routine | « 2 games de focus CS puis pause » | session conforme |
| Pause | après 3 défaites / > 2 h 30 | pause prise (aucune game pendant X min) |
| Pool (AS3) / horaire (AS4) | « Évite X en ranked », « tes games après minuit » | games concernées |

- Le focus **devient l'objectif de session proposé** (S1), en priorité après l'objectif assigné par le coach (W3).

### ⑤ Suivi : vérifier que le conseil marche

- Chaque prescription acceptée devient une **expérience** enregistrée : référence (moyenne avant), critère, fenêtre (N games), statut.
- Après N games : **acquis** (critère tenu ≥ 70 %), **en progrès** (tendance significative dans le bon sens), **sans effet**.
- Conséquences automatiques :
  - *acquis* 2 fois de suite → fondamental **diplômé** (P2), badge, focus suivant proposé ;
  - *sans effet* 2 fois → prescription alternative ou fondamental voisin (règle existante `neighbourObjective`) ; le coach est alerté s'il l'avait assigné (C2) ;
  - le verdict met à jour le multiplicateur de la règle (apprentissage **par résultat**, pas seulement par vote).
- Le respect de l'objectif dans la review (R2) est **coché automatiquement** à partir du critère, modifiable par le joueur.

## 3. Automatisations déclenchées par événement

| Événement | Ce que l'app fait seule |
|---|---|
| Fin de partie + timeline en cache | détection d'erreurs (existant) → signaux → constats → **résumé 3 points** ; **notes horodatées pré-remplies** dans la review (R1 : morts, objectifs, tours, multi-kills) ; **bookmarks auto** des erreurs sévérité 3 (MX5) ; mise à jour de l'expérience en cours ; respect d'objectif calculé (R2) |
| Ouverture de l'app / nouvelle session | brief : focus, état de l'expérience, game à revoir en priorité (R4), garde-fous (tilt, fatigue) |
| 45 min sans partie | **clôture auto de la session** (S3) avec conclusion pré-remplie : stats, verdict, games à revoir |
| Plus de 3 games non reviewées | rappel (R5) avec la game prioritaire |
| Lundi / 7 jours | bilan hebdo : progrès, verdicts, focus de la semaine, alerte de réévaluation si les stats contredisent le bilan (P1) |
| Suppression répétée d'un tag auto | sévérité par défaut baissée pour ce joueur (MX3) |

## 4. Données ajoutées (Prisma, synchronisées)

- `CoachingExperiment` : problème, fondamental, critère (JSON), référence, fenêtre, games comptées, statut, verdict, dates.
- `AdviceLog` : conseil affiché (problème, règle, moment, date) → anti-répétition et apprentissage par résultat.
- `MistakeTagTuning` : décalage de sévérité par tag et par joueur (MX3).

Tout le reste (signaux, constats, scores) est **recalculé** à partir des données existantes : rien à migrer, résultats reproductibles. Les trois tables rejoignent la synchro (`SYNC_TABLES`) et la sauvegarde.

## 5. Interface

- **Page « Mon plan »** (nouvelle, accessible depuis la barre latérale) : focus actuel et progression de l'expérience, 3 problèmes prioritaires avec leurs preuves (« Pourquoi ? » ouvre les games et les moments), historique des verdicts, fondamentaux diplômés.
- Cartes assistant existantes (Dashboard, Session, Review) : alimentées par le nouveau pipeline, même composant.
- Review : notes pré-remplies et respect d'objectif automatique, signalés comme « auto » et modifiables.
- Réglage : niveau d'automatisation (« tout auto » / « me demander ») pour la clôture de session et les bookmarks.

## 6. Mise en œuvre par lots

Chaque lot : tests unitaires (fonctions pures) + E2E sur données seedées, `npm run check` vert.

| Lot | Contenu | Règles du catalogue |
|---|---|---|
| **1 — Fondations** ✅ | taxonomie des problèmes, constats + agrégation noisy-OR, score d'impact, anti-répétition (`AdviceLog`), cartes assistant branchées sur le pipeline (aucune régression des 28 règles) | AS2 / MX4 |
| **2 — Boucle fermée** ✅ | `CoachingExperiment`, catalogue de critères, moteur de verdicts, apprentissage par résultat, respect d'objectif auto, diplômes | S2, R2, P2, C2 (côté données) |
| **3 — Automatisation post-partie** | notes horodatées pré-remplies, bookmarks auto, game prioritaire à revoir, rappels de review, clôture auto de session | R1, MX5, R4, R5, S3 |
| **4 — Nouvelles analyses** | meilleur/pire profil, pool de champions, heure de jeu, fatigue de série, écart d'XP, mort pendant un objectif, seuils appris | AS1, AS3, AS4, AS5, M14, M15, MX3 |
| **5 — Page « Mon plan » + bilans** | page dédiée, bilan hebdo v2, alerte de réévaluation, pré-remplissage du bilan depuis les stats | P1, B4 |
| *Plus tard (équipe)* | alertes staff, bans suggérés, import des customs | C1–C6, T1–T5 (après E1/E8 du plan équipe) |

Ordre : 1 → 2 → 3 → 4 → 5.

**Lot 1 livré** : `assistant/problems.ts` (15 problèmes + catch-all), `assistant/diagnosis.ts` (agrégation noisy-OR, impact personnel ou a priori par rôle, persistance, actionnabilité, anti-répétition), table `AdviceLog` (synchronisée + sauvegardée), règle `dominant_mistake` (AS2/MX4), cartes assistant : badge **Focus** + « confirmé par N signaux ». Les garde-fous bien-être (pause) restent toujours en tête. Tests : `tests/unit/coachingEngine.test.ts`, `assistantIpc.test.ts`, `tests/e2e/assistant.spec.ts`.

**Lot 2 livré** : `assistant/experiments.ts` (critères mesurables calés sur la moyenne d'avant l'expérience, verdicts acquis / en progrès / sans effet, fondamental diplômé, apprentissage par résultat : un verdict compte comme des 👍/👎 sur la règle qui l'a prescrit, un problème acquis s'efface 14 jours, deux « sans effet » → fondamental voisin) ; table `CoachingExperiment` (synchronisée + sauvegardée) ; démarrage **automatique depuis l'objectif de la session** ou bouton « Tester sur 5 parties » sur le focus ; panneau de progression (une pastille par partie) et verdict ; review : « objectif respecté » **pré-rempli** (R2) ; badge « Diplômé ». Tests : `coachingExperiments.test.ts`, `coachingExperimentsIpc.test.ts`, E2E assistant. Les lots 1 et 2 sont le cœur (diagnostic unifié + boucle fermée) ; les lots 3 et 4 rendent l'app visiblement « automatique » ; le lot 5 en fait la vitrine.

## 7. Garde-fous

- **Seuils minimum de données** : pas de tendance sous 5 games, pas d'impact personnel sous 15, pas de verdict avant la fin de la fenêtre.
- **Pas de surcharge** : 3 conseils max par moment, 1 seul focus.
- **Ton** : factuel, toujours avec la preuve ; jamais de jugement sur le mental, seulement des faits (séries, durée).
- **Modifiable** : tout ce qui est rempli automatiquement est marqué « auto » et peut être corrigé ; les corrections servent à l'apprentissage (MX3, votes).
- **Performance** : pipeline exécuté en tâche de fond après l'enrichissement, < 200 ms sur 100 games (mesuré en test).
