# Audit de l'app — redondances, code inutile, organisation, optimisation (novembre 2026)

> Demande : « fait un audit complet de l'app. cherche les redondances et choses inutile. réorganise et optimise tout sans rien casser. »
> Mené les 19/11/2026 sur `main` à `572b287` (restructuration Coaching / Stats collectives du 18/11 incluse), dans le worktree `D:\DEV\NexusMind\wt-app-audit`, branche `app-audit`. Rien n'est poussé ni fusionné : la fusion et la release restent la décision de l'utilisateur.

## Résumé

- **30 commits** sur `app-audit` (29 de code, détaillés au § 1, et ce rapport). Hors lockfile, locales et ce rapport : 148 fichiers touchés, **+572 / −3 526 lignes**. 18 fichiers supprimés, 6 ajoutés (petits modules partagés et un fichier de tests).
- **i18n** : 131 clés inutilisées supprimées dans chaque langue (2 978 → 2 847 clés).
- **Dépendances** : 2 dépendances jamais importées retirées (`electron-store`, `@radix-ui/react-dropdown-menu` : 26 paquets en moins dans le lockfile) ; `esbuild`, utilisé par le build du site sans être déclaré, est déclaré.
- **Installeur** : le cache de modèle Whisper de la machine de build (147 Mo), les source maps des dépendances (~64 Mo) et les `tsbuildinfo` ne sont plus embarqués.
- **Lint** : 54 avertissements → 1 (dans `ChampPoolTab.tsx`, fichier protégé). 0 erreur.
- **Tests** : 1 255 tests unitaires verts (1 275 au départ : 26 tests de code supprimé partent avec lui, 6 tests ajoutés pour le nouveau `mediaCore`). e2e Electron : 39/39 sur l'app buildée.
- **12 bugs corrigés**, listés à part au § 1.6 (dont 3 visibles dans la web app et 2 pertes de données mineures sur la page de revue).
- **Restent** des constats qui demandent une décision ou un test que ce worktree ne permet pas (§ 3), et des constats sur les fichiers protégés, à transmettre aux autres sessions (§ 4). Les questions pour l'utilisateur sont regroupées au § 5.

## 0. Méthode et garde-fous

- **Phase 1, lecture seule** : cinq relectures en parallèle, une par zone — processus principal (`electron/main`, preload, Prisma) ; pages et composants ; `src/lib`, hooks, stores et i18n ; web app, site vitrine, workers Cloudflare et Supabase ; tests, scripts, docs, dépendances et configuration. Chaque constat « inutile » est appuyé par une recherche sur tout le dépôt (y compris `tests/`, `.harness/`, `site/`, `web/` et les usages dynamiques : canaux IPC, clés i18n construites, `import.meta.glob`). Les clés i18n ont été cherchées par l'AST TypeScript (littéraux, gabarits, concaténations), puis par une recherche brute de chaque clé entre guillemets dans 614 fichiers : 0 occurrence.
- **Phase 2** : corrections sûres en petits commits. Après chaque lot : `npm run check` (typecheck des trois tsconfig, ESLint, contrôle i18n, Vitest), le typecheck du bot Discord quand ses modules partagés changent, et le build du site vitrine quand ses entrées changent (sortie identique). Écrans touchés vérifiés dans le harnais UI (copie locale sur le port 5229) : tableau de bord, session, revue, statistiques, Stats collectives, Record, paramètres, historique, plan, et les onglets de Coaching.
- **Fichiers protégés** (autres sessions en cours sur `main`) : cartes joueurs / logo / récompenses, refonte Champion Pool, moteur de l'assistant, `src/assets/**`, `scripts/release.ps1`, et les nouveaux fichiers signalés en cours de route. Aucun n'a été modifié ; leurs constats sont au § 4. Dans `src/i18n/locales/*.json`, seulement des suppressions (les 12 lignes « modifiées » sont des virgules finales d'objets dont la dernière clé est partie).
- **Jamais** : migration Supabase, SQL en production, déploiement de worker, release. `node_modules` (jonction vers le checkout principal) n'a jamais été modifié : les dépendances ont été retirées avec `npm uninstall --package-lock-only` dans une copie.

**État de départ (`572b287`)** : 1 275 tests verts (86 fichiers), 0 erreur ESLint, 54 avertissements, i18n OK (2 978 clés).

## 1. Ce qui a été fait sur `app-audit`

### 1.1 Code mort supprimé

| Quoi | Preuve | Commit |
|---|---|---|
| Pages sans route ni import : `ReplaysPage.tsx` (231 l.), `StatsAveragesPage.tsx` (605 l.), `RankMilestone.tsx` (jamais importé depuis la v0.1.0) | aucun importeur ; `/replays` et `/stats/averages` redirigeaient déjà | `0fc5145`, `995e2ba` |
| Flux post-partie orphelin : `/post-game-capture` et `/external-review/new` (2 pages, 2 routes, la branche `postGameSetup` de `ReviewPage`, la prop `submitLabel`, l'IPC `recording:get-by-id`) | plus aucun lien depuis la beta.19 (`e0679ea`) | `995e2ba` |
| 22 canaux IPC sans appelant (handler + membre preload + type `AscendAPI`, et entrée web quand elle existait) : `window:*` ×3, `review:get-by-session`, `assessment:get-history`, `recording:get-scan-paths`, `recording:generate-thumbnail`, `recording:get-desktop-source`, `mistake:archive-tag`, `mistake:update`, `mistake-stats:trend`, `mistake-stats:heatmap`, `bookmark:update`, `team:get`, `team:update`, `draft:get`, `team:compute-opponent-dashboard` (215 lignes, jamais appelé depuis son ajout), `stats:compute-averages`, le trio `team-session:list-for-group` / `has-live` / `report-game`, et le push `updater:update-not-available` sans abonné | table IPC complète (369 canaux) recoupée avec le renderer, `web/`, `tests/` et le harnais | `0fc5145` |
| Modules et exports morts du processus principal : `ipc/index.ts` (barrel jamais importé), `recordingCaptureArgs.ts` et son test (ère gdigrab), `getRankedStats` (endpoint league-v4 by-summoner déprécié), `resolveDefaultMicName`, `hasSecret`, constantes du dashboard adverse | aucune référence | `0fc5145` |
| Branches impossibles depuis la restructuration du 18/11 : `team: Team \| null` et les cartes « Sélectionne une équipe » des 3 onglets Stats collectives ; les 8 sélecteurs de groupe des sections de Coaching (Planning, tableau de bord staff, Tâches, Essais, Review VOD, Rapport hebdo, Bien-être, Team Codex) ; le mode non intégré de `StatsLandingPage` | le seul appelant passe toujours une équipe / un seul groupe | `995e2ba`, `f962c07` |
| État de store jamais lu : `gameEndData` (écrit à chaque fin de partie), `loading` des stores session et partie | aucun sélecteur | `d7806c5` |
| Exports morts ou testés seulement : `getFundamentalByIdForGroup`, types `TeamRole`/`PoolTier` de `ipc.ts`, `MIN_GAMES_FOR_FLEX`, `calculateKDA`, `getRankColor`, `mapEventsToVideoTime` | aucune référence hors leurs tests | `e898d39` |
| Schémas zod de `validation.ts` utilisés seulement par un test (et faux : notes 1-5, flux de clé API supprimé) | voir § 1.3 (zod sort du renderer) | `939f644` |
| Site vitrine : `site/src/exhibits/` (6 fichiers, 427 l., les aperçus v1), `icon-192.png` sans référence | aucun import ; build du site inchangé | `fa31856` |
| Bot Discord : `src/commands.ts`, présenté comme « source de vérité » mais importé par rien | idem | `fa31856` |
| 131 clés i18n (×2 langues) : ancienne page Équipe (`team.title`, `team.publish*`, `team.workspace.*`, restes de `team.pool/draft/custom`, le dashboard adverse jamais branché `team.scouting.dashboard.*`), fonctionnalités IA supprimées (`ai.*`), `review.autoScoring.*`, ancien en-tête Planning, clés des pages supprimées ici | voir § 0 | `b33d378`, `f962c07` |
| 2 dépendances jamais importées, réglages Vitest morts (`coverage` vers un provider non installé, `globals`) | voir § 1.4 | `6ed7d6a`, `41c84a4` |

### 1.2 Redondances fusionnées

- **Liste localisée des fondamentaux** : `useLocalizedFundamentals().flatMap(...)` recalculé à chaque rendu dans 7 composants (et cassait la mémoïsation de `SessionPage`) → un hook `useLocalizedFundamentalList()` qui rend un tableau construit une fois par langue. `findKpiLabel` (copié dans 2 composants) et la recherche « libellé ou id » (6 copies en ligne) → `src/lib/fundamentals.ts`. (`43adde9`)
- **Mapper d'erreurs Supabase `fail()`** copié dans 14 modules `*Core.ts` → `src/lib/supabaseErrors.ts`. Desktop, web et bot Discord typecheckent. (`0937d00`)
- **Helpers média** : URL `nxm://` (×5), `m:ss` depuis des ms (×4), taille de fichier (×3), `parseMmSs` (×2) → `src/lib/mediaCore.ts`, pur et testé. (`7029e04`)
- **Listes de régions** : deux copies identiques des 16 plateformes (Paramètres, revue externe) → `src/lib/regions.ts`. (`939f644`)
- **Jetons aléatoires** : `generateCalendarSubscriptionToken` et `generateReportShareToken` identiques → `src/lib/tokens.ts`. (`05c2571`)
- **Processus principal** (`f73d44f`) : `stats:get-account-averages` réécrivait `fetchDetailedStatsForMatches` instruction pour instruction ; `hasCurrentDetailedStatsSchema` répétait les 13 conditions de `hasCurrentSnapshotSchema` ; `matchTime` (team.ipc) = `scoutingCore.matchStartOf` ; `resolveTag` réimplémentait `mistakeSlug()` ; `QUALITY_HEIGHT`, le dossier d'enregistrements et la taille de fichier copiés entre `recorder.ts` et `wgcRecorder.ts` ; deux fonctions de suppression de fichiers identiques.
- **Portée de scouting** : `FetchScope` / `scopeToMatchCount` vivaient dans un composant de dialogue importé par un store, avec un `100` en dur → `src/lib/riotLimits.ts` (`QUICK_SCOUT_MATCH_COUNT`). (`7029e04`)

### 1.3 Optimisations

- **Lectures `MatchCache`** : 4 lectures qui n'utilisaient que `matchJson` chargeaient aussi la timeline (0,5-2 Mo) — `stats:match-history` le fait jusqu'à 50 fois par compte à chaque ouverture de l'Historique, des Statistiques et du tableau de bord. Elles ne sélectionnent plus que `matchJson` ; le test « timeline en cache ? » du scan ne la charge plus. (`fd87b8a`)
- **`team:list`** n'envoie plus `seasonMatchIdsJson` (jusqu'à ~2 500 ids par membre scouté) au renderer, qui ne le lit pas. (`fd87b8a`)
- **Sync déconnecté** : la boucle de sync interrogeait Supabase toutes les 30 s pour les sessions d'équipe en direct même déconnecté. (`fd87b8a`)
- **Toasts** : `useToast()` abonnait chacun de ses ~60 appelants à la liste des toasts ; chaque toast re-rendait toutes les pages montées. Seul `<Toaster />` s'abonne maintenant (`useToastState`). (`8744194`)
- **zod hors du renderer** : `validation.ts` n'était importé que pour une table de libellés, mais ses `z.object()` de premier niveau embarquaient zod (~100 ko) dans le bundle. (`939f644`)
- **Web app** : `CoachMicroReviews` importait une constante de `MicroReviewPanel`, ce qui tirait le panneau et le Codex (~150 ko) dans le bundle web → `src/lib/microReview/vodTiming.ts`. (`f52fc74`)
- **Re-rendus** : `TeamSessionPage` ne re-rend plus chaque seconde quand la session n'est pas planifiée ; la liste d'onglets de `CoachingPage` n'est plus recréée à chaque rendu ; `SessionPage` ne s'abonne plus à l'utilisateur qu'il n'utilisait pas. (`995e2ba`, `43adde9`)
- **Installeur** : exclusions `electron-builder` (cache Whisper de la machine de build, `**/*.map`, `out/*.tsbuildinfo`) ; deux globs `asarUnpack` qui ne correspondaient à rien. (`bb7c580`)
- **Bruit** : le scan des enregistrements n'écrit plus une ligne de log par fichier connu à chaque visite de Record. (`f73d44f`)

### 1.4 Organisation et outillage

- Règles ESLint React hooks étendues à `web/src` (1 avertissement trouvé et corrigé dans la page Équipe web). (`745e0e7`)
- `esbuild` déclaré en devDependency (importé par `site/build.mjs`). (`6ed7d6a`)
- Spec e2e « analytics » : visait `/analytics`, qui redirige depuis le 17/11 ; chaque appel attendait 10 s. (`41c84a4`)
- `DevToolbar` rendu seulement en build de dev (il interrogeait un handler absent en production). (`995e2ba`)
- 53 des 54 avertissements ESLint réglés (imports et variables inutilisés, dépendances de hooks ; 1 parti avec un fichier supprimé). Les `eslint-disable` gardés sont justifiés par un commentaire. (`651685f`, `53b592c`, `43adde9`, `a275cad`)
- `enrichWithMatchApi` garde le snapshot live en `_snapshot` : il servira au correctif E10 (§ 3.1).

### 1.5 Mesures

Voir § 2.

### 1.6 Bugs corrigés (listés à part)

| Bug | Effet pour l'utilisateur | Commit |
|---|---|---|
| Revue : les notes KPI n'étaient pas dans les dépendances de la sauvegarde auto du brouillon | une note KPI tapée en dernier n'était pas sauvegardée dans le brouillon | `776fbc8` |
| Revue : les notes KPI n'étaient ni remises à zéro au changement de partie ni chargées depuis une revue enregistrée | les notes d'une partie pouvaient être enregistrées avec la revue suivante ; modifier une revue existante remplaçait toutes ses notes KPI par la seule tapée | `776fbc8` |
| Lecteur vidéo : le raccourci `M` gardait une version périmée de `toggleMute` | `M` coupait le son mais ne le rétablissait jamais | `776fbc8` |
| Envoi d'un clip vers Discord ou l'hébergeur temporaire : `Blob` pris dans le paquet npm `undici`, qui ne l'exporte pas | les deux envois échouaient à chaque fois (« Blob is not a constructor ») depuis le 12/11 — non testé contre un vrai webhook | `24ec741` |
| Import de parties dans une session : `queueType` oublié | toutes les parties importées étaient stockées en file « unknown » | `4003d0d` |
| Sélecteur de compte (onboarding) : clé `EUNE1` au lieu de `EUN1` | les comptes EUNE affichaient « EUN1 » | `939f644` |
| `App` routait avant de connaître l'utilisateur | chaque lancement passait un instant par `/onboarding` (flash + appel IPC inutile) | `d7806c5` |
| Barre latérale : « Stats collectives » surlignée sur `/team-session/:id` | mauvais repère de navigation (les sessions d'équipe relèvent de Coaching) | `9a34c61` |
| `<html lang="en">` jamais mis à jour | l'interface française était annoncée, césurée et corrigée comme de l'anglais | `9a34c61` |
| Session d'équipe et sélecteur KPI de revue externe en anglais dans l'interface française | badges d'objectifs, sélecteur de fondamentaux et libellés KPI en anglais (desktop et web) | `7873e76` |
| Web app : la page Session d'équipe plantait pour le staff (`getKpiHistory` / `getCoachingPatterns` absents de l'adaptateur web) | page blanche pour tout manager ou capitaine ouvrant une session planifiée ou en direct | `f16efe7` |
| Web app : répondre à un événement, changer le rôle d'un membre, ajouter ou supprimer un axe de plan de dev (fonctions du 18/11) absents de l'adaptateur web ; CSP `connect-src` sans le proxy Riot ni Data Dragon | toast d'erreur pour ces actions ; scouting, auto-fill, stats des parties de session et listes de champions bloqués par le navigateur. **Effectif au prochain déploiement de la web app** (non déployé) | `f16efe7` |

Durcissement en plus : le code de liaison Discord (6 caractères) est tiré avec `crypto.getRandomValues` au lieu de `Math.random` (`05c2571`).

## 2. Mesures

**Tests** : `npm run check` vert à chaque lot (typecheck ×3, ESLint 0 erreur / 1 avertissement protégé, i18n OK, Vitest 1 255/1 255). Site vitrine : `node site/build.mjs` produit les mêmes fichiers. e2e Electron (`npm run test:e2e` : build puis Playwright sur l'app, profil temporaire, cloud coupé) : **39/39** en 1,2 min.

**Bundles** (`electron-vite build`) :

| Sortie | `572b287` | `app-audit` |
|---|---|---|
| Renderer `index-*.js` | 4 356 ko | 4 208 ko (−148 ko) |
| Renderer CSS | 139 ko | 139 ko |
| Processus principal | 829 ko | 806 ko (−23 ko) |
| Preload | 38 ko | 37 ko |

Répartition du chunk renderer au départ (source maps) : ~1,9 Mo de code de l'app, ~1,8 Mo de dépendances, ~0,6 Mo de JSON (locales ≈ 350 ko, `codex.json`). Les plus gros postes : `recharts` et ce qu'il entraîne (`lodash`, `d3-*`, `react-smooth`, `decimal.js-light`) ≈ 760 ko pour 8 fichiers ; `react-dom` 201 ko ; `zod` 102 ko (retiré) ; `VideoReviewPlayer` et `SettingsPage` 87 ko chacun. Le renderer n'est **pas minifié** (défaut d'electron-vite) : minifié, il ferait ~2,5 Mo (−43 %) — décision au § 5.

**Installeur** : le dernier build (1.0.0-beta.2) fait 346 Mo ; 147 Mo de cache Whisper + ~64 Mo de source maps n'y seront plus. Un `npm run dist:dir` de contrôle reste à faire avant la prochaine release (non lancé ici : le `node_modules` du worktree est celui du checkout principal et `electron-builder` peut le reconstruire).

## 3. Constats restants (non appliqués), par zone

Chaque constat : fichiers, pourquoi, risque, correctif proposé. « Décision » = choix produit ou go de l'utilisateur ; « Test » = demande une vérification impossible dans ce worktree (vraie partie, vrai webhook, build packagé, production).

### 3.1 Processus principal

- **E10 — L'enrichissement post-partie peut attacher la partie précédente, et ne trouve jamais une normale ou une Arena** · `electron/main/gameDetector.ts` (`enrichWithMatchApi`), `riotClient.ts` (`getMatchIds`), `strandedGamesCore.ts`. Il prend le dernier id classé avec une tolérance de 30 min avant le début détecté ; 10 s après la fin, Riot n'a souvent pas encore publié la partie, donc après deux parties enchaînées il prend la précédente : soit l'`update` échoue sur l'unicité de `matchId` (placeholder « défaite » sans timeline jusqu'à ~26 min), soit la partie réelle est remplacée par la précédente. Risque moyen (cœur du flux post-partie). Correctif : lister les ids avec `getMatchIdsBetween(début − marge, maintenant + marge)` (toutes files), construire les candidats comme `strandedGames.ts` et choisir avec `pickMatchForProvisional({ champion: snapshot.champion, ... })` — le paramètre `_snapshot` est déjà en place. **Test** (vraies parties enchaînées).
- **E02 — Le radar du tableau de bord re-parse ~40 timelines à chaque visite** · `stats.ipc.ts` (`stats:get-fundamentals-radar`, `fetchDetailedStatsForMatches`). 40 `JSON.parse` de 0,5-2 Mo sur le thread principal à chaque montage du tableau de bord. Risque faible à moyen. Correctif : mémoïser `extractDetailedStats` par `matchId:puuid` (LRU ~300 entrées).
- **E03 — Sonde ffmpeg en `spawnSync` à l'import** · `electron/main/recorder.ts`. Bloque le démarrage avant la fenêtre (jusqu'à 5 s si Defender scanne). Risque faible. Correctif : résoudre le chemin à l'import, sonder la version au premier usage.
- **E04 — Travail au démarrage avant la fenêtre** · `index.ts`, `database.ts`, `sync/syncSchema.ts`, `seeds/mistakeTags.ts`. ~140 `DROP/CREATE TRIGGER IF (NOT) EXISTS` et 29 `findUnique` à chaque lancement pour rien. Risque faible (a, b, d) / moyen (c). Correctif : lire `sqlite_master` une fois, `findMany` + `createMany` pour le seed ; option : créer la fenêtre avant la base.
- **E06 — `MatchCache` grossit sans limite** · `schema.prisma`, `team.ipc.ts`, `database.ts`, `backupCore.ts`. Chaque migration copie toute la base (`VACUUM INTO`, 5 copies gardées) ; l'export fichier gzip tout le cache sur le thread principal (peut dépasser la taille max d'une chaîne V8). Risque moyen. Correctif : sortir `MatchCache` des exports fichier, purge différée des vieilles timelines. **Décision**.
- **E07 — Écritures en boucle sans transaction** (`writeTieredPool`, `refreshAutoTiers`, `stats:get-snapshots`, créations d'erreurs, scan). SQLite en journal rollback : chaque instruction est une transaction synchronisée sur disque. Correctif : `$transaction`, `deleteMany`, et mesurer le mode WAL.
- **E08 (a) — `refreshAutoTiers` à chaque `team:list` / `team:pool-list`**, y compris une fois par carte membre dans Draft et Scouting. Correctif : une promesse partagée et au plus une exécution par heure (le démarrage force).
- **E09 — Le pipeline post-partie récupère la même partie jusqu'à 3 fois** et parse la timeline 3-4 fois. Correctif : réutiliser le `matchData` gagnant, écrire le cache avant `onGameEnriched`, parser une fois.
- **E11 — `mistake:auto-detect` (bouton manuel) ignore la sévérité apprise (MX3) et les signets auto (MX5)** · `mistakes.ipc.ts` vs `stats.ipc.ts`. Un joueur qui a appris à l'app à baisser une sévérité la retrouve pleine après un clic. Correctif : sortir `autoDetectMistakesSilently` du `register` (E27) et l'appeler depuis le handler.
- **E12 — `review:analyze-bias` ne regarde que le compte principal** et réécrit match + timeline à chaque appel · `review.ipc.ts`. Les revues de parties jouées sur un compte lié n'ont jamais d'alerte de biais. Correctif : `ensureMatchCache` puis résolution du puuid parmi les comptes liés.
- **E14 — Identifiants OAuth YouTube lus dans `process.env`** au lieu de `import.meta.env` · `youtube.ipc.ts`. Dans un build packagé, la connexion YouTube échoue probablement (« not configured »). **Décision** : l'envoi YouTube doit-il exister en production ? (le secret embarqué est déjà signalé dans `AUDIT_SECURITE.md` § 3bis).
- **E15-B — Liens de partage de clip jamais enregistrés** · `clip:set-youtube`, `clip:set-temp-share` sans appelant ; l'UI affiche `clip.youtubeUrl` / `tempShareUrl` qui ne peuvent jamais apparaître. **Décision** : les enregistrer (brancher `onShared`) ou supprimer canaux et branches.
- **E15-C — Canaux cloud sans appelant desktop** : `availability:set-rule` / `delete-rule` (l'éditeur de règles a disparu le 16/11, les règles sont encore lues par Planning et le bot), `vodreview:delete-comment`, `collab:my-open-comments` (utilisé par la web app seulement). Leurs fonctions vivent dans `electron/main/cloud/collab.ts` (protégé). **Décision** sur les règles de dispo.
- **E15-E — Backend « joueur suivi »** (`stats:*-followed-player`) sans UI : prévu par la roadmap (radar comparé). Gardé.
- **E19 (couche) / E20 / E21 / E22 / E24 — Redondances plus larges** : 10 variantes « lire le cache sinon Riot » (proposition : un module `matchCache.ts`, point d'appui de E01/E06/E09) ; `prisma.user.findFirst({ where: { isActive: true } })` ×70 et le résolveur « lequel de mes comptes a joué » ×5 (2 copies identiques, `analytics.ipc.ts` / `session.ipc.ts`) → `activeUser.ts` ; la cascade de résolution du joueur ×5 (3 identiques dans `eventExtractor`, `mistakeDetector`, `lanePhaseAnalyzer`) ; le calcul d'offset d'enregistrement ×3 ; `aggregateMatchLike` (main) et `buildSideStats` (renderer) partagent leurs formules. Risque faible à moyen, beaucoup de fichiers : à faire par lot, avec les tests existants.
- **E25 — Découpe des gros fichiers IPC** (`team.ipc.ts` ~1 650 l., `recording.ipc.ts`, `stats.ipc.ts`, `review.ipc.ts`, `riotClient.ts`) selon le modèle `*Core.ts` : les fonctions pures listées dans le rapport source deviennent testables. Après E19/E27.
- **E26 — Nommage des canaux IPC hétérogène** (handlers dans des fichiers d'autres domaines, préfixes `team-session:` vs `teamsession`, `sync:status` à la fois invoke et push). Pas de renommage : déplacer quand on y touche.
- **E27 — `loadGameEventsImpl` / `autoDetectMistakesImpl`**, variables de module qui n'existent que pour atteindre des fonctions définies dans `registerStatsHandlers`. Correctif : sortir les 4 fonctions (débloque E11).
- **E18 (suite) — SQL brut** sur `Clip`, `ExternalReview`, `DiscordWebhook` alors que le client Prisma les connaît : à porter modèle par modèle (attention aux dates rendues en chaîne).
- **E30 — Index Prisma** : aucun index manquant ne justifie aujourd'hui une migration (chaque migration copie toute la base au démarrage). Seul candidat : `Mistake(createdAt)` si les volumes grossissent. Le runner de migrations avale « no such column » comme idempotent : une coquille dans une migration la marquerait appliquée sans l'exécuter.
- **E31 — Backend ddagrab** (~350 lignes) derrière `NXM_RECORDER=ddagrab`, que rien ne positionne. **Décision** : garder la porte de secours ou supprimer.

### 3.2 Interface (pages et composants)

- **UI-08 — Renderer non minifié** · `electron.vite.config.ts`. 4,4 Mo → ~2,5 Mo minifié. Contrepartie : piles d'erreurs moins lisibles dans les rapports de bug (sauf `keepNames` ou source maps cachées). **Décision**.
- **UI-09 — Aucun découpage par route** · `src/App.tsx`. Tout le bundle (dont `recharts` ≈ 25 %) est parsé au démarrage. `React.lazy` pour les routes hors démarrage (garder Dashboard, Session, Revue), `ProgressChart` paresseux. Risque moyen (chargement de chunks en `file://`, flash de `Suspense` à la première visite) : à tester en build packagé + e2e.
- **UI-11 / L02 / WSC-07 — Polling et chargements en double** · `AnnouncementBubbleStack`, `NotificationBell`, `TeamSessionBanner`, `EndOfGamePrompt`, `Sidebar`, `useCollab`. ~12 appels Supabase par minute au repos, y compris fenêtre réduite (`backgroundThrottling: false`) ; `teamSessionListMyLive` interrogé par deux composants ; `TeamSessionBanner` re-interroge à chaque navigation ; chaque instance de `useCollab()` recharge les groupes (4 requêtes) — 12 requêtes identiques au lancement. Correctif : store partagé pour `useCollab` (une requête en vol), un seul poller de session en direct, pause quand la fenêtre est cachée. Risque moyen. **Décision** pour la pause fenêtre réduite (la popup de fin de partie d'équipe apparaîtrait à la restauration).
- **UI-07 — Arborescence après la restructuration** : les onglets Draft Sim, Scouting, Champion Pool et Roster vivent dans `src/pages/Team/` alors que `/team` n'affiche plus que les stats. Cible proposée : `src/pages/TeamStats/` pour les stats, `src/pages/Coaching/team/` pour Draft/Scouting/Champion Pool/Roster, `StatsTable` sorti de `DashboardLayout.tsx` vers `components/team/`. Non fait maintenant : `ChampPoolTab`, `RosterTab` et `PlayerCard` sont protégés, déplacer les autres seulement couperait le dossier en deux. À faire après la refonte Champion Pool.
- **UI-13 — Coûts de rendu plus lourds** : `VideoReviewPlayer` (2 000 lignes) re-rendu ~4×/s pendant la lecture ; ~170 icônes Data Dragon sans `loading="lazy"` dans Draft ; Historique fait un IPC `getRecording` par ligne (N+1). Risque moyen.
- **UI-14 (suite) — Éditeur de clip ×3** (`RecordPlayerPage`, `ExternalReviewPage`, `GameRecordingPanel`), extraction d'id YouTube ×3 (une copie rate les liens `/embed/` et `/shorts/`), `parseMmSs` de `RecordPlayerPage` (variante `parseInt`, lit « :30 » différemment). Un hook `useClipEditor` est proposé.
- **UI-15 / L11 — Liste des rôles redéclarée ~20 fois** (dont 4 fichiers protégés) et deux tableaux identiques dans `championRoles.ts` ; trois échelles de couleur de winrate (celle de Scouting diffère). Correctif : `ROLES`/`Role` depuis `championRoles.ts`.
- **UI-16 — Morceaux de rendu dupliqués** : icône de champion avec repli ×3, barre d'onglets soulignés identique dans `CoachingPage` et `TeamPage`, `m:ss` ×6.
- **UI-17 — 17 `(window.api as any)`** sur des méthodes typées (`RecordPlayerPage`, `RecordingMediaPanel`, `ClipSharePanel`, `ExternalReviewPage`, `SettingsPage`) : retirer et corriger ce que tsc signale.
- **UI-21 — Props jamais branchées** : bouton « Choisir » de `ObjectiveSuggestionPanel` (`onAccept` jamais passé, **décision** : le brancher sur l'ajout d'objectif ou le supprimer) ; `GameRecordingPanel.readonly` jamais passé.
- **UI-B2 — Bouton dans un bouton** · `ScoutingTab.tsx` (puce d'adversaire + suppression) : DOM invalide, accessibilité.
- **UI-B4 — Textes en dur hors i18n** : français seul dans `GameEndNav`, `ObjectiveSuggestionPanel`, `ReviewInsightPanel`, `SessionInsightPanel`, `CoachingPatternCard` ; anglais seul dans la section enregistrement des Paramètres, `LanePhasePage`, `ScoutingTab`, les toasts de `GameRecordingPanel`, `ShareButton`, le flux de revue externe. Demande d'ajouter des clés (hors règle « suppressions seulement » de cette branche).
- **UI-20 — Entrées Tailwind/CSS inutilisées** (`slide-in`, `xp-fill`, `hextech.blue-bright`, `--hextech-blue-bright`, `.hextech-border`, `.hextech-glow`, `darkMode`) : sans effet sur le CSS produit ; à retirer en gardant le format des blocs de thème que `site/build.mjs` lit.

### 3.3 Bibliothèques, stores, i18n

- **L06 — Textes légaux** : l'app affiche les CGU et la politique de confidentialité v0.1 « brouillon » (`src/legal/*.md`), le site publie la v0.2 du 18/11 (qui mentionne Discord, bien-être, YouTube, transcription). Le consentement se fait sur l'ancienne version. **Décision** (source unique) — recommandé avant la publication.
- **L07 — Version Data Dragon** : deux caches sans promesse partagée (`useChampionIconUrl`, `useAllChampions`) → ~170 requêtes `versions.json` et une double charge d'icônes à la première ouverture de Draft ou du Pool. Correctif : un `src/lib/ddragon.ts` avec une promesse unique.
- **L12 (suite) / WSC-17 — Tables de régions Riot** encore en 3-4 copies (`riotClient.ts`, `web/src/riotWeb.ts`, le proxy, `opgg.ts`) : `src/lib/regions.ts` peut les réunir. La liste de Scouting n'a que 11 régions (ME1 en plus dans l'import en masse).
- **L13 (suite) — Tag « Autre cause » archivé** : `resolveTag` (micro-review) renvoie un tag personnel archivé sans le désarchiver (contrairement à `mistake:create-tag`) : l'erreur est rattachée à un tag caché.
- **L14 — Filtre `ranked5` des sessions d'équipe** : la logique testée (`queueBucket`, `matchesQueueFilter`) n'est pas branchée ; en production `ranked5` se comporte comme `flex`. **Décision** : brancher (chevauchement du roster) ou retirer l'option.
- **L15 — `auth.getUser()` (aller-retour réseau) dans 7 fonctions Core**, dont `listPendingFinalReviews` interrogé par la bannière toutes les 15-30 s. Correctif : passer l'uid en paramètre.
- **L16 — Le preload n'est pas vérifié contre `AscendAPI`** (dérive déjà présente : `saveReview` sans `kpiNotes` côté preload) ; types de contrat redéclarés entre `src/lib/ipc.ts` et le processus principal. Correctif : `satisfies AscendAPI`, un module de contrats partagé. Et l'adaptateur web : `satisfies Partial<AscendAPI>` + un test de couverture (WSC-16), cause des bugs web corrigés ici.
- **L17 (suite) — Petits doublons** : `fmtClock` / `clockOf` / `formatGameTime` (ce dernier n'arrondit pas), `pct` / `kdaOf` ×3, `localDateKey` ×3, et trois règles de pliage d'identifiant Riot (dont `riotIdKeyOf`, protégé) — un même joueur peut être reconnu à un endroit et pas à un autre.
- **L18 — `calendarCore.isUserAvailable`** documenté « utilisé par le bot » mais réimplémenté en ligne dans `discordBotCore.findRoleReplacements`.
- **L20 — Rangement** : `useFundamentals.ts` est un hook dans `constants/` ; `useDdragonVersion` dans `useChampionIconUrl.ts` ; `useTeamCodex` / `usePrepareSession` sous `components/MicroReview` ; `ipc.ts` importe un type depuis un composant. La convention « `*Core.ts` = pur » ne correspond pas au code : 18 modules Core font de l'IO via un client injecté (ce qui est voulu) — à documenter dans un README de `src/lib`. Sans test : `microReviewCloudCore.ts`, `eventsToICS`, `championRoles.ts`.
- **L21 — Hooks de partage** (`useShareReview`, `useShareSession`) : constructeurs purs dans des hooks, `scoreBar` différent entre les deux, textes Discord en anglais seul. Correctif : `src/lib/shareCore.ts` testé. **Décision** : les messages Discord suivent-ils la langue de l'app ?
- **L22 — `check-i18n.mjs` ne voit pas les clés mortes** : les 131 clés se sont accumulées pour cette raison. Ajouter un rapport `--unused` (avertissement) sur le modèle du script d'audit, avec la liste des préfixes dynamiques.
- **L23 — Charge à l'import** : les deux locales (≈ 350 ko) sont importées statiquement ; la langue inactive pourrait être chargée à la demande. `anomalyDetector` ne tourne que dans le processus principal (pas de problème de chemin chaud).
- **L24 — Doublons contraints ou documentés** : ICS (`eventsToICS` vs edge function), `scoutingCore` vs boucles de `team.ipc.ts` (voulu), `Scrim` web vs `ScrimSummary` : garder, ajouter un test d'égalité pour l'ICS.

### 3.4 Web app, site vitrine, workers, Supabase

- **WSC-04 — Onglets équipe de Coaching sur le web** (Espace d'équipe, Champion Pool, Draft Sim, Scouting) : `GroupTeamGate` ne trouve jamais l'équipe (l'adaptateur web ne renvoie pas `groupId`, `linkTeamToGroup` n'existe pas sur le web), Scouting dépend du groupe choisi sur `/team`. **Décision** : masquer ces onglets sur le web (le web garde `/team`) ou les porter.
- **WSC-05 — `supabase/migrations` ne décrit pas la production** : 17 tables, 2 RPC, des colonnes et une migration prérequise (`e_phase0_manager_role_captain`) utilisées par les clients ne sont pas dans le dépôt ; pas de `supabase/config.toml`. La base ne peut pas être recréée depuis le dépôt. **Décision** : lire la production (lecture seule) pour versionner les migrations appliquées.
- **WSC-06 — `getSharedTeam` lit toute la table `team_pool_entries`** (sans filtre ; avec le rôle service dans le cron du bot toutes les 15 min par serveur). Correctif : filtrer par groupe (jointure `team_rosters`) ; le bot ne lit que les `user_id` du roster. Test unitaire + un passage du bot.
- **WSC-08 — Écrans web qui sur-chargent** : Accueil charge tous les scrims de tous les groupes pour en montrer 3 ; Scrims recharge tout après chaque case cochée ; Mes revues lit jusqu'à 5 000 `sync_records`.
- **WSC-10 / WSC-11 / WSC-13 — Pipeline mort du site** : après la suppression des exhibits, `styles/app.css` (21 ko des 38 ko servis), 5 view-models de `data.mjs`, ~90 textes par langue, la moitié de `engine.ts` et la lecture de 146 clés i18n de l'app (113 bloquantes si supprimées) ne servent plus ; `style-src 'unsafe-inline'` n'est gardé que pour eux. Correctif mécanique mais à valider par un diff des HTML générés.
- **WSC-12 — Captures du site** : `site/shots.cjs` clique Draft Sim / Scouting sur `/team`, qui ne les a plus depuis le 18/11 : la prochaine capture complète échouera. Pointer vers `/coaching` (et lier une équipe au groupe démo dans le harnais).
- **WSC-15 (suite)** — retirer les canaux de E15-C côté web avec leur suppression desktop.
- **WSC-18 (b, c) — Pool web** : la web app écrase les tiers choisis à la main par le coach (pas de colonne `auto_tier` sur `team_pool_entries`). **Décision** (migration de production).
- **WSC-19 — `web/src/scrims.ts` hors du modèle Core** (IO non testée, mapping d'erreurs différent) ; les scrims lient les drafts personnels synchronisés alors que le Draft Sim web écrit `team_drafts`. **Décision** sur la source des drafts.
- **WSC-20 (b-d) — Bundle web** : un seul chunk de ~2 Mo ; `StatsTable` à sortir de `DashboardLayout.tsx` (recharts ≈ 380 ko n'est tiré que par lui), `React.lazy` sur les routes, locale active seulement.
- **WSC-22 — Angles morts de la CI** : les workers ne sont pas typecheckés par `npm run typecheck` (le bot importe 5 modules Core ; 38 exports de `src/` ne servent qu'au bot, au web ou au site), le build du site n'est pas en CI, le bot importe `@supabase/supabase-js` sans le déclarer.
- **WSC-23 — Le proxy Riot relaie deux endpoints jamais appelés** (`account/v1/accounts/by-puuid`, `league/v4/entries/by-puuid`). **Décision** (déploiement du worker).
- **WSC-24 — Commentaires périmés des workers** (README inexistant, secret listé à tort, description du cron incomplète).
- **WSC-25 — Service worker web** : nom de cache constant (les assets de chaque déploiement s'accumulent), précache d'une icône inutilisée, encore « NexusMind ».
- **Collab — `collabListMemberLooks` sur le web** : absent de l'adaptateur web (appel gardé par `?.`, donc sans erreur) ; laissé à la session des cartes joueurs qui fait évoluer cette fonction.

### 3.5 Tests, outillage, docs, dépendances

- **P2 — Runtimes ONNX inutiles dans l'installeur** (363 Mo non compressés : `onnxruntime-web`, binaires `onnxruntime-node` darwin / linux / win-arm64). Exclusions proposées ; **Test** : une transcription dans un build `dist:dir`.
- **D3 / D4 — Bibliothèques du renderer et `@prisma/client` en `dependencies`** : déjà bundlées par Vite (le renderer) ou jamais chargées au runtime (le client généré est dans `prisma-client/`), elles sont repackées dans `app.asar` (~117 Mo). Les passer en devDependencies ; aligner `@prisma/client` (6.19.2) sur le CLI (6.12.0). **Test** : build packagé.
- **D6 — `ffmpeg-static` (80 Mo)** n'est qu'un repli si `resources/ffmpeg-bin` manque. **Décision**.
- **B1 suite** — le seul test du partage s'arrête à la vérification du chemin : à étendre.
- **T1 / T3 — Tests qui testent des copies** : `recordPage.test.ts` teste ses propres copies des helpers (sa copie de `getDateKey` est en UTC alors que l'app utilise le jour local) ; `recordingMatch.test.ts` teste une copie de la boucle de scan. Correctif : extraire les helpers dans un module et tester l'original.
- **T4 (suite) — Exports testés seulement** : `winProbabilityCurve`, `isReviewDone`, `isReviewReopenable`, `countsAgainstPlayer` (règle réimplémentée en ligne dans `microReview.ipc.ts`), `queueBucket` / `matchesQueueFilter` (L14), `isUserAvailable` (L18), et deux dans les fichiers protégés.
- **T5 / T6 — Aides de test dupliquées** : faux client Supabase `chain()` dans 14 fichiers, harnais IPC SQLite dans 7, constructeurs de timeline dans 5.
- **T8 — Les tests ne sont jamais typecheckés** : un `tsconfig.tests.json` trouve 1 erreur (fixture de `playerCard.test.ts` sans `updatedAt`).
- **S1 — `npm run seed`** importe `@prisma/client`, qui résout un client obsolète (7 modèles sur 31) et vide plusieurs tables. **Décision** : le réparer (importer `../prisma-client`) ou le supprimer avec `tsx`.
- **S2 — `prisma:migrate`** (`prisma migrate dev`) contredit la pratique (migrations écrites à la main) et peut proposer un reset destructif de `dev.db`. **Décision** : supprimer ou passer en `--create-only`.
- **S3 — ffmpeg téléchargé sans vérification d'intégrité** au postinstall (`scripts/download-ffmpeg.mjs`), puis livré à tous : épingler le SHA-256.
- **CI1** — ajouter `npm run site:build` (et T8) à la CI.
- **C3** — `.gitignore` : `!.env.example` et `!.dev.vars.example` ré-incluent des fichiers qui n'existent pas ; un `.env.example` documenterait les 10 variables.
- **DOC1 — `docs/SESSION_HANDOFF.md`** demande à être supprimé « une fois l'item 2 résolu » : l'item 2 (chargement infini / impossible de se reconnecter après déconnexion) n'a pas de correctif depuis le 17/11. Proposition : le passer dans `docs/INBOX.md` (Pending), puis archiver le handoff. Non fait (rituel de début de session de l'utilisateur).
- **DOC2 — `PRD.md`** décrit le produit d'avril 2026 (IA, CSP, variables d'environnement, tests, périmètre). **Décision** : archiver ou mettre à jour.
- **DOC3 — Affirmations périmées** dans `docs/ROADMAP.md` (`supabase/schema.sql` inexistant, monorepo jamais créé, `AssistantFeedback` dit non synchronisé alors qu'il l'est, compteurs d'avertissements) et `RAPPORT_FONCTIONNALITES.md`. Non modifiés ici (documents de pilotage édités en parallèle).
- **DOC4 — Deux listes de tâches** (`ROADMAP.md` et `RAPPORT_FONCTIONNALITES.md` § 2) qui divergent déjà. **Décision** : laquelle reste la référence.
- **DOC5 — `PLAN_GESTION_EQUIPE.md` et `AUDIT_REGLES_METIER.md`** : v1 livrée, mais ~60 commentaires du code et 12 migrations les citent : garder, ajouter un bandeau d'état.
- **K1 — `.claude/skills` (7,2 Mo, un tiers des octets suivis)** : politique « vendre de vraies skills » assumée. Gardé.
- **`.env` local** : contient encore `MAIN_VITE_OPENAI_API_KEY` (à révoquer selon la ROADMAP) et `GH_TOKEN` (que `release.ps1` n'utilise plus). Noms seulement relus.

## 4. Fichiers protégés : constats pour les autres sessions

Non modifiés ici ; à appliquer par la session propriétaire ou après sa fusion.

- **`src/pages/Team/ChampPoolTab.tsx`** (refonte Champion Pool) : dernier avertissement ESLint (`:155`, dépendances `[selectedMember?.id, selectedMember?.role]` voulues : lire l'id et le rôle dans des constantes, ou justifier le disable) ; branche « pas d'équipe » morte sur desktop (encore possible sur le web) ; `console.info` (`:290`) ; copie des 5 URL d'icônes de rôle et de `ROLES`.
- **`src/pages/Team/RosterTab.tsx`, `PlayerCard.tsx`, `src/lib/playerCard.ts`** (cartes joueurs) : branche `team: Team | null` / `loading` impossible sur desktop ; `riotIdKeyOf` plie les accents alors que `teamIdentity.identityKeys` et `teamSessionStatsCore` ne le font pas (un même joueur reconnu à un endroit et pas à l'autre) ; recherche de job d'arrière-plan par sous-chaîne de libellé (« Alpha » reconnaît « Alpha 2 ») — passer un `teamId` aux jobs ; fixture de `playerCard.test.ts` sans `updatedAt` (T8).
- **`src/components/team/RoleIconPicker.tsx`** : le composant n'est jamais rendu (seuls `ROLE_ICON_URLS` et `Role` sont importés) ; à réduire à un `roleIcons.ts`.
- **`src/pages/Coaching/TeamSpaceSection.tsx`, `GroupsSection.tsx`** : copie de `ROLES` ; sur le web, `collabSetMemberRole` existe maintenant dans l'adaptateur (corrigé côté `web/src/api.ts`).
- **`src/lib/collabCore.ts`, `src/lib/collab.ts`, `electron/main/cloud/collab.ts`** : `collabCore` garde sa variante étendue de `fail()` (peut envelopper `src/lib/supabaseErrors.ts`) ; `listMyGroups` sans cache (cause des 12 requêtes au lancement, L02) ; wrappers `availability:*` et `vodreview:delete-comment` sans appelant (E15-C) ; `me()` recopié dans 5 fichiers dont celui-ci.
- **`electron/main/assistant/**`** : `review:priority-game` sans appelant renderer (couvert par un test) ; `timeline.ts` est la 5ᵉ copie de la résolution du joueur (E21) ; `needsStatDeviationReassessment` et `posteriorMean` ne servent qu'aux tests (le second relève du Thompson sampling « implémenté, non activé »).
- **`src/lib/constants/fundamentals*.ts`, `src/lib/microReview/codex.*`** : `getCategoryForFundamental` et `getSubcategoryById` testés seulement ; `codex.ts` a sa propre `normalizeRole` (sens inverse de `teamIdentity.normalizeRole`, même nom).
- **`src/assets/**`** : `ascend-logo-mark.png` (12,7 ko) et `ascend-bg-swirl-2.jpg` (22 ko) ne sont référencés nulle part (Vite ne les embarque pas ; ils encombrent seulement le dépôt). Les SVG de `src/assets/brand/` sont des masters documentés : à garder.
- **`scripts/release.ps1`** : non relu pour modification ; les exclusions d'installeur de ce rapport changent ce que le build embarque, pas ce que fait le script.

## 5. Questions pour l'utilisateur

1. **Fusion** : la branche `app-audit` peut-elle être fusionnée dans `main` (après les sessions en cours) ? Les conflits attendus se limitent aux locales (suppressions seulement) et à quelques fichiers partagés (`web/src/api.ts`, `src/lib/ipc.ts`, `electron/preload/index.ts`).
2. **Déploiement web** (WSC-01/02/03) : redéployer la web app pour activer le CSP élargi et les méthodes ajoutées ?
3. **Post-partie (E10)** : appliquer le correctif de l'enrichissement (cœur du flux, à tester sur de vraies parties enchaînées) ?
4. **Renderer** : minifier (UI-08, −43 %) ? Découper par route (UI-09) ?
5. **Polling** : mettre en pause le polling de l'app quand la fenêtre est cachée (UI-11) ?
6. **Installeur** : retirer les runtimes ONNX inutiles (P2), passer les bibliothèques du renderer et `@prisma/client` en devDependencies (D3/D4), garder ou non le repli `ffmpeg-static` (D6) ? Tous demandent un build packagé de contrôle.
7. **Textes légaux** (L06) : publier la v0.2 du site dans l'app, et quelle source unique ?
8. **Produit** : le filtre `ranked5` (L14) ; les règles de disponibilité hebdomadaires (E15-C) ; les liens de partage de clip (E15-B) ; YouTube en production (E14) ; le bouton « Choisir » des suggestions d'objectif (UI-21) ; les onglets équipe de Coaching sur le web (WSC-04) ; les tiers manuels sur le web (WSC-18) ; le backend ddagrab (E31).
9. **Supabase** (WSC-05) : autoriser une lecture seule de la production pour versionner les migrations appliquées ?
10. **Docs** : archiver `PRD.md` et `SESSION_HANDOFF.md` (après passage de l'item ouvert dans `INBOX.md`) ; quelle liste de tâches garder (ROADMAP ou RAPPORT_FONCTIONNALITES) ?
11. **Scripts** : réparer ou supprimer `npm run seed` (S1) ; `prisma:migrate` (S2) ?
12. **i18n** : `microReview.reason.noPrio` peut-il encore exister dans des réponses enregistrées (sinon la clé peut partir) ? Le français écrit « parties » 241 fois et « games » 76 fois : « games » est-il du jargon voulu ?

## 6. Laissé volontairement

- Tout ce qui touche un fichier protégé (§ 4).
- Ce qui change un comportement visible sans test possible ici : E10, E06, UI-09, UI-11, P2, D3/D4/D6 (§ 3).
- Les déplacements de dossiers (UI-07) tant que la refonte Champion Pool n'est pas fusionnée.
- L'ajout de clés i18n (règle de cette branche : suppressions seulement), donc les textes en dur (UI-B4) et le libellé « Team Fundamentals ».
- `stopSyncService` (jamais appelé, mais contrepartie naturelle de `startSyncService`), `validateTemplates` et `closeDatabase` (utilitaires de test légitimes).
- Les modifications de documents de pilotage (`ROADMAP.md`, `RAPPORT_FONCTIONNALITES.md`, `SESSION_HANDOFF.md`, `INBOX.md`, `PRD.md`) : édités en parallèle par d'autres sessions ; les corrections proposées sont au § 3.5.
- Le harnais UI (`.harness/`, ignoré par git) : sa copie locale a été adaptée au port 5229 ; rien n'est versionné.
