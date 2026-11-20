# Audit performance n° 2 : chargements « quasi instantanés » (20/11/2026)

Session Audit, en lecture seule, sur beta.18 (`42c0d0c`, build `out/` de la release, 17:49).

Le Chief a déjà fait, dans beta.18 :
- un cache de pages qui affiche l'ancienne valeur puis rafraîchit (`queryCache` + `useCachedQuery`) ;
- un cache des listes de matchs Riot (`matchIdsCache`) ;
- les Stats qui n'attendent plus `autoSnapshot` ;
- un tableau staff qui ne télécharge plus que les champs utiles.

Le Chief a aussi en cours le rapport de phase de lane calculé en fin de partie et le préchauffage des caches au démarrage : ces deux points ne sont pas repris ici.

Objectif de l'utilisateur : des chargements quasi instantanés, et une page déjà chargée qui ne recharge pas quand on y revient.

## 0. Ce qui a pu être mesuré, et ce qui ne l'a pas été

- **Pas de mesure cloud allumé.**
  - Le proxy Riot exige une session Supabase (`riotTransport.ts:58-62`). Il faudrait donc lancer l'app avec la session réelle de l'utilisateur.
  - Une instance de test agirait alors en son nom sur la production : sync, Realtime, écritures. Je ne l'ai pas fait.
  - Les chemins Riot et Supabase sont donc analysés dans le code, avec des latences mesurées à part :

    | Destination | Aller-retour mesuré |
    |---|---|
    | Supabase (`/auth/v1/health`, depuis ce poste) | 225-230 ms, 420 ms au premier appel |
    | Proxy Riot (`/health`) | 55-62 ms, 150 ms au premier appel |

  - **Prérequis proposé (gain n° 0)** : un journal de performance activable (`NEXUSMIND_PERF_LOG=1`) qui chronomètre chaque handler IPC et chaque appel réseau dans le main. L'utilisateur le lancerait une fois sur sa vraie session. C'est la seule façon d'avoir les vrais chiffres de Gestion, Lobby et Coaching.
- **Sonde e2e sur une copie de la vraie base (cloud coupé).**
  - Elle chronomètre chaque handler `ipcMain` et compte les appels.
  - Cette copie n'a aucune `Game` locale (les parties de l'utilisateur sont dans le cloud), mais elle a 1 633 `MatchCache`.
  - Pour Accueil et Revue, la sonde a attendu 45 s. C'est la limite de la sonde, qui attend la fin des animations `animate-pulse` ; une animation reste affichée en permanence. Ce n'est pas un temps de chargement.

| Page | 1er affichage | Retour | Appels IPC (1er) | Handler ≥ 100 ms |
|---|---|---|---|---|
| Démarrage, fenêtre | 244 ms | — | 20 | `recording:get-capture-status` 138 ms |
| Accueil | n. m.* | n. m.* | **16** | aucun (cloud coupé) |
| Historique | 64 ms | 65 ms | 2 | — |
| Stats, chaque onglet (détaillé, progrès, historique, badges, stats) | 62-65 ms | 63-65 ms | 8-11 | — |
| Erreurs (`/stats/mistakes`) | 63 ms | 63 ms | 2 | — |
| Revue | n. m.* | n. m.* | 3 | — |
| Plan | 80 ms | 64 ms | 7 | — |
| Paramètres | 187 ms | 111 ms | 12 | — |
| Gestion, Lobby, Coaching | 62-77 ms | 63-64 ms | 1 | — (écran « connecte-toi », cloud coupé) |

\* n. m. : non mesuré (animation permanente, voir ci-dessus).

**À retenir.** Sans réseau, toutes les pages s'affichent en moins de 200 ms. La lenteur signalée par l'utilisateur vient donc entièrement des chaînes Riot et Supabase, et de la lecture des grosses colonnes de `MatchCache`, pas du rendu.

### Coût local mesuré sur la copie (494 Mo)

| Opération | Temps |
|---|---|
| Lire 20 lignes `MatchCache` complètes (`findUnique`, comme `fetchDetailedStatsForMatches`), disque chaud | 125 ms |
| Lire 20 lignes `matchJson` seulement | 17 ms |
| Lire 40 lignes avec timeline (32 Mo), disque froid | **4 318 ms** |
| `JSON.parse` de 40 matchs + 40 timelines | 91 ms |
| `stats:match-history` : 50 `matchJson` lus et parsés | 67 ms en parallèle, 96 ms en séquentiel |
| Une timeline gzip | 390 Ko → **34 Ko** (× 11), décompression 1 ms |

Le coût n'est pas `JSON.parse`, c'est **l'I/O des colonnes texte de 400-700 Ko** : au premier accès après un redémarrage, Windows n'a pas encore les pages de la base en cache.

## 1. Chaînes séquentielles (waterfalls)

### A. Accueil (radar), Stats détaillées (moyennes), autoSnapshot : `fetchDetailedStatsForMatches` (`stats.ipc.ts:65-120`)

- Les matchs sont traités **un par un**, dans une boucle `for … await`.
- Pour chaque match absent du mémo :
  1. lecture de la ligne `MatchCache` complète ;
  2. si le match manque : `getMatch`, **puis** `getMatchTimeline`, à la suite ;
  3. puis l'écriture.
- Le mémo (`detailedStatsMemo.ts:14-16`) n'existe **qu'en RAM**. Après chaque redémarrage, le radar relit et reparse jusqu'à 40 lignes. Mesuré : de 0,1 s (disque chaud) à **4,3 s (disque froid)**.
- Sur un profil sans cache (nouvel utilisateur, ou timelines purgées), c'est jusqu'à **80 appels Riot en file**. À ~60 ms de proxy + 100-300 ms de Riot, cela fait **15 à 25 s**, dans la limite du budget de 100 appels / 2 min.
- La timeline est téléchargée **même pour les matchs d'un autre rôle**, qui sont ensuite écartés (`mainRole`, l. 117).
- Les appels utilisent la région `user.region` du compte principal (`stats.ipc.ts:93`, `103`, `585`, `671`, `975`, `988`), et non celle du compte qui a joué. Un match d'un second compte sur un autre serveur échoue puis est sauté. C'est un trou de « serveur par compte ».
- `stats:auto-snapshot` (`stats.ipc.ts:965-990`) refait la même boucle sur **100 matchs, sans le mémo**.

### B. Phase de lane (`stats.ipc.ts:461-521` → `ensureMatchCache`, l. 205-250)

- Enchaînement : `game` → `user` → `accounts` → `MatchCache` → `getMatch` → `getMatchTimeline`, en séquence, puis l'analyse.
- Sur un match non mis en cache, c'est ≥ 2 allers-retours Riot avant le premier pixel.
- Le Chief y travaille (calcul en fin de partie) ; à vérifier : même trou `user.region` (l. 227 et 242).
- `LanePhasePage.tsx:90-97` : `useEffect` direct, sans `useCachedQuery`. Revenir sur la page refait le chargement.

### C. Gestion › tableau staff (3,4 s signalées pour 2 lignes)

Chaîne avant que le tableau puisse s'afficher, en allers-retours Supabase séquentiels (≈ 230 ms chacun) :

| Étape | Code | Allers-retours |
|---|---|---|
| `cloudStatus` (session) | `useCollab.ts:36` | 0 ou 1 |
| `collabListGroups` : memberships, puis groupes, membres et partages en parallèle | `collabCore listMyGroups` (`selectMemberships`, puis `Promise.all`) | 2 |
| Rendu de l'onglet, puis `getStaffDashboard` : `group_members`, puis `sync_records` et `wellbeing_checkins` en parallèle | `staffDashboardCore.ts:37-56` | 2 |

- Cela fait **4 à 5 allers-retours au minimum, soit ≈ 1 à 1,2 s**. Les 2 s restantes ne sont pas expliquées par le code ; il faudrait le journal du gain n° 0 pour trancher.
- Pistes :
  - attente du verrou d'auth de supabase-js : chaque requête passe par `auth.getSession` ;
  - processus main occupé au même moment par le rattrapage de démarrage ;
  - jusqu'à 12 appels IPC de Gestion lancés d'un coup.
- Le cache de groupes du main (`collab.ts:168-205`, 60 s) ne sert pas au 1er affichage après un démarrage.

### D. Accueil et Historique : `stats:match-history` (`stats.ipc.ts:564-614`)

- Liste des matchs (cache de 60 s, beta.18), puis pour chaque id : `findUnique` + `JSON.parse` du match complet (~75 Ko), puis `game.findUnique` avec `review`.
- Pour 50 matchs : ≈ 70-100 ms en local.
- Un match absent du cache déclenche un `getMatch` avec `user.region`.
- Le calcul est refait à chaque appel. Accueil (10) et Historique (20) relisent les mêmes matchs.

## 2. Ce qui reste hors `useCachedQuery`

Seuls passent par le cache : Accueil, Historique, Stats (landing), StaffDashboardSection et OrganisationTab.

Les écrans suivants rechargent à chaque visite :

| Écran | Fichier |
|---|---|
| Phase de lane | `src/pages/Stats/LanePhasePage.tsx:90` |
| Stats détaillées d'un match | `src/pages/DetailedStats/` (hors landing) |
| Onglets de `AnalyticsPage` (progrès, historique, badges, stats) | `src/pages/Analytics/AnalyticsPage.tsx` |
| Erreurs | `MistakeStatsPage` |
| Revue | `src/pages/Review/ReviewPage.tsx:66-252`, 4 `useEffect` |
| Gestion › Mon espace | `src/pages/Management/MySpaceTab.tsx` |
| Planning, Bien-être, Ops d'équipe, Essais, Groupes (en Gestion et Coaching) | `src/pages/Coaching/` |
| Lobby d'équipe, Sessions d'équipe | `src/pages/TeamSpace/`, `src/pages/TeamSessions/` |
| Paramètres | `src/pages/Settings/` (12 appels à chaque visite, 111-187 ms) |

### Handlers main qui attendent Riot ou le réseau avant de répondre (lus au chargement d'une page)

| Handler | Fichier | Attend |
|---|---|---|
| `stats:match-history` | `stats.ipc.ts:564` | Riot (liste en cache, matchs absents) |
| `stats:get-fundamentals-radar` | `stats.ipc.ts:782` | Riot, boucle A |
| `stats:get-account-averages` | `stats.ipc.ts:727` | Riot, boucle A |
| `stats:get-lane-phase` | `stats.ipc.ts:560` | Riot, chaîne B |
| `stats:get-detailed` | `stats.ipc.ts:620-680` | Riot (match puis timeline) |
| `mistake-stats:occurrences` | `mistakes.ipc.ts:191` | Riot |
| `review:get-prefilled-notes` | `stats.ipc.ts:536` | Riot |
| `external-review:fetch-player-history` | `externalReview.ipc.ts:90` | Riot |
| `stats:auto-snapshot` | `stats.ipc.ts:935` | Riot, 100 matchs (lancé sans attente depuis beta.18) |
| Tous les `collab:*`, `teamSession:*`, `calendar:*`, `tasks:*`, `availability:*` | — | 1 à 3 allers-retours Supabase chacun, sans cache dans le main (sauf la liste des groupes) |

### `JSON.parse` lourds

Timelines de 400-700 Ko :
- `stats.ipc.ts:90`, `668`, `971` ;
- `review.ipc.ts:137` ;
- `session.ipc.ts:288` ;
- `microReview.ipc.ts:78` ;
- `cloud/analyst.ts:41` ;
- `lanePhaseAnalyzer.ts:325`, `mistakeDetector.ts:139`, `eventExtractor.ts:295`.

Le parse lui-même coûte ~2 ms par timeline. Ce qui coûte, c'est la lecture de la colonne (voir 0), et le fait que **plusieurs analyseurs reparsent la même timeline** pour un même match : lane phase, erreurs, événements, micro-revue.

## 3. Le top 5 d'AUDIT_PERF.md, revu

| N° | Gain (AUDIT_PERF) | Encore d'actualité ? | Gain attendu maintenant |
|---|---|---|---|
| 1 | Routes paresseuses + découpage | **Oui** : `lazy(` = 0 dans `App.tsx`, renderer **3 205 Ko** (contre 3 123 le 20/11 au matin) | Démarrage −200 à −400 ms de parse (estimation), web −50 % de JS initial. Ne rend pas une page plus rapide une fois l'app lancée. |
| 2 | Sauvegardes de migration | **Oui** : toujours 5 conservées (`database.ts:12`), `backups` = 1,7 Go | Disque, et −2 s au 1er lancement après une mise à jour avec migration |
| 3 | Gzip / purge de MatchCache | **Oui, plus important qu'annoncé** : c'est l'I/O de ces colonnes qui ralentit les stats à froid (4,3 s pour 40 lignes, disque froid). Gzip ×11. | Radar et moyennes à froid : de 4,3 s à ~0,4 s (estimation), base 494 → ~150 Mo |
| 4 | RPC « boîte de réception » | **Moins utile** depuis Realtime (beta.15/16) : le polling n'est plus qu'un filet | Faible ; à garder pour le 1er chargement (3 allers-retours → 1) |
| 5 | Cache R2 du proxy | **Déjà fait. Je retire ce point** : le proxy phase 1 est déployé avec R2 depuis le 19/11 (`PLAN_CHIEF.md:300`). Mon premier rapport le disait à tort non déployé. | — |

## 4. Les 10 plus gros gains, classés par gain / effort

Effort : **S** < ½ j, **M** ≈ 1 j, **L** > 2 j.

| N° | Gain | Où | Effet attendu | Effort | Risque |
|---|---|---|---|---|---|
| 0 | **Journal de performance** (`NEXUSMIND_PERF_LOG=1`) : durée de chaque handler IPC et de chaque appel Riot ou Supabase, lancé une fois par l'utilisateur sur sa session | `electron/main/index.ts` (enveloppe de `ipcMain.handle` / `validatedHandle`, `fetch`) | Les vrais chiffres cloud allumé (Gestion, Lobby, Coaching), dont les 2 s inexpliquées du tableau staff. Prérequis pour juger 5 et 6. | S | Nul (désactivé par défaut) |
| 1 | **Mémo des stats détaillées persistant** : table locale `(matchId, puuid, version) → stats` de quelques Ko, lue avant `MatchCache` | `detailedStatsMemo.ts:14-40`, `stats.ipc.ts:76`, `965` | Après un redémarrage, radar, moyennes et autoSnapshot sans relire ni reparser 40 à 100 timelines : de 0,1-4,3 s à < 50 ms (estimation) | S-M | Faible : la clé de version invalide au changement de formule |
| 2 | **Boucle A parallèle et économe** : 4 matchs à la fois sous `withRiotPriority` ; rôle lu dans `matchJson` **avant** de télécharger la timeline ; région tirée du matchId (`platformOfMatchId`) au lieu de `user.region` | `stats.ipc.ts:74-113`, `93`, `103`, `585`, `671`, `975`, `988` ; `ensureMatchCache` l. 227 et 242 | Profil sans cache : de 15-25 s à 3-5 s (estimation). Moins de timelines inutiles. Les matchs des seconds comptes sur un autre serveur ne sont plus perdus. | S | Moyen : budget Riot (garder la priorité et la limite) |
| 3 | **`useCachedQuery` sur les écrans restants** (§ 2), en commençant par phase de lane, onglets Stats, Revue, Mon espace, Planning, Lobby | Fichiers du § 2 | Retour sur une page = affichage immédiat (demande explicite de l'utilisateur) | M (mécanique) | Faible ; penser aux invalidations (fin de partie, mutations) |
| 4 | **Amorçage du cloud au démarrage**, plus les groupes en cache local : un seul appel `collab:bootstrap` (statut + groupes) lancé au boot, et la dernière liste de groupes conservée d'une session à l'autre (`queryCache` persisté) | `useCollab.ts:31-50`, `collab.ts:193-205` | Gestion, Lobby et Coaching n'attendent plus 2-3 allers-retours (−0,5 à −0,7 s) au 1er affichage | S | Faible : affiche l'ancienne liste puis rafraîchit |
| 5 | **RPC `staff_dashboard(group_id)`** : membres + agrégats `sync_records` calculés en base, au lieu de 2 allers-retours et d'un téléchargement jusqu'à 20 000 lignes | `staffDashboardCore.ts:37-110` + migration Supabase (`security definer`, `search_path=''`) | Tableau staff : −1 aller-retour, charge utile divisée par 10 ou plus ; tient à 100 joueurs | M | Moyen : RLS à reproduire (revue Cyber) |
| 6 | **Timelines gzip** dans `MatchCache` (lecture : gunzip si l'en-tête est présent ; migration paresseuse à la lecture) | `MatchCache.timelineJson` (`schema.prisma:169`) et les 10 lectures du § 2 | I/O à froid ÷ 11 (4,3 s → ~0,4 s pour 40 lignes, estimation) ; base 494 → ~150 Mo | M | Faible : décompression de 1 ms |
| 7 | **Résumé par match** (champion, KDA, durée, rôle, victoire) stocké à l'écriture du match, pour Accueil et Historique | `stats.ipc.ts:575-611` | `stats:match-history` sans 50 parses de ~75 Ko : de 70-100 ms à < 10 ms ; moins de mémoire dans le main | S | Faible |
| 8 | **Une timeline parsée une fois par match** et partagée par les analyseurs (lane phase, erreurs, événements, micro-revue) en fin de partie | `lanePhaseAnalyzer.ts:325`, `mistakeDetector.ts:139`, `eventExtractor.ts:295`, `microReview.ipc.ts:78` | Fin de partie plus courte, le main moins bloqué au moment où l'utilisateur ouvre l'Accueil (à coordonner avec le travail en cours du Chief) | S | Faible |
| 9 | **Sauvegardes de migration** : 2 au lieu de 5, compressées, rotation appliquée aussi aux `before-delete-*` | `database.ts:12`, `102-125` | 1,7 Go → ~200 Mo ; 1er lancement après mise à jour −2 s | S | Faible |
| 10 | **Routes paresseuses + `manualChunks`** (recharts, Supabase, Équipe, Coaching, revue vidéo) | `src/App.tsx:55-87`, `electron.vite.config.ts`, `web/vite.config.ts` | Démarrage −200 à −400 ms (estimation), web −50 % de JS initial | M | Faible : un `Suspense` par route |

Les gains n° 1, 2 et 6 visent la plainte « Stats et Historique très lents ». Les n° 0, 4 et 5 visent Gestion. Le n° 3 vise « ne pas recharger au retour ».
