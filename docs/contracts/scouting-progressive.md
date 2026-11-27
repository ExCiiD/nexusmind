# Contrat : scout d'équipe progressif (27/11/2026)

Livré par Back-end pour le Front-End (`src/pages/Team/ScoutingTab.tsx`, `src/store/useBackgroundJobsStore.ts`). Décision du 24/11 : **plus vite, jamais moins de données** (la saison complète reste la profondeur par défaut). Code : `src/lib/scoutEngine.ts` (moteur partagé desktop + web), `electron/main/ipc/team.ipc.ts` (`team:scout-team`), `web/src/scoutingWeb.ts`.

## Ce qui change pour l'écran

Avant : `scoutMember(id)` membre par membre, rien à afficher avant la fin de chaque membre (des dizaines de minutes sur le proxy).
Maintenant : **un seul appel pour toute l'équipe**, et l'écran reçoit des morceaux dans cet ordre :

1. `mastery` : un pool **instantané** par joueur (1 requête chacun), quelques secondes.
2. `ids` puis `plan` : combien de parties, combien de distinctes pour l'équipe (les parties communes ne sont téléchargées qu'une fois).
3. `chunk` : le pool **partiel** d'un joueur, recalculé avec les parties déjà analysées (les plus récentes d'abord).
4. `member-done` : le joueur est complet et **écrit en base** (les pools de `team:list` / `listChampionPool` sont à jour).
5. `done` : fin de l'ensemble, avec les chiffres.

`scoutMember` et `autoFillPool` existent toujours, inchangés pour l'appelant (`scoutMember` passe maintenant par le même moteur).

## API (`window.api`, optionnelle : absente sur un vieux build, retomber sur `scoutMember`)

```ts
scoutTeam?(memberIds: string[], opts?: { count?: number; roleOnly?: boolean; scoutId?: string }): Promise<ScoutTeamResult>
scoutCancel?(scoutId: string): Promise<{ ok: true; found: boolean }>
onScoutProgress?(cb: (event: ScoutEvent) => void): () => void   // retourne la fonction de désabonnement
```

Types : `import type { ScoutEvent, ScoutTeamResult, ScoutPoolEntry } from '@/lib/scoutEngine'`.

- `count` : parties par joueur ; `<= 0` ou absent de la portée « Complete » = **toute la saison** (`scopeToMatchCount('complete')` = -1). Défaut 100 (« quick »), comme avant.
- `roleOnly` : défaut `false` pour le scout (comptes comme op.gg), comme avant.
- `scoutId` : à fournir (≥ 4 caractères, ≤ 64) pour **filtrer les événements** de son scout et pouvoir l'annuler. Si omis, le main en génère un (visible dans `start`).
- Le **plafond de 20 membres** par appel est validé côté main.
- `scoutMember(id, count, { scoutId })` : avec un `scoutId`, il émet aussi les événements ; sans, comportement identique à avant (aucun événement).

## Événements (`ScoutEvent`, tous portent `scoutId`)

| `type` | Champs | Quand |
|---|---|---|
| `start` | `members: {memberId, displayName}[]` | tout de suite |
| `mastery` | `memberId`, `pool: ScoutPoolEntry[]` | dès que la maîtrise d'un joueur est lue. **Absent** si la maîtrise est vide ou en échec. Un événement par joueur, dans l'ordre d'arrivée (pas l'ordre de l'équipe). |
| `ids` | `memberId`, `total` | la liste de parties du joueur est lue (après application de `count`) |
| `plan` | `rawIds`, `uniqueIds`, `sharedIds` | une fois, quand toutes les listes sont lues : `rawIds - uniqueIds = sharedIds` parties épargnées |
| `chunk` | `memberId`, `processed`, `total`, `pool`, `history` | à chaque ~10 parties analysées d'un joueur (ou 1 s), et à sa dernière partie. `processed` ne décroît jamais ; `processed/total` donne la barre de progression |
| `member-done` | `memberId`, `upserted`, `totalMatches`, `sameRoleCount`, **`failed`**, **`unreadable`** | le joueur est complet **et écrit**. `failed` = parties non analysées (404 Riot + illisibles), `unreadable` = celles qui n'ont **pas pu être lues** (réseau, proxy, erreur Riot, après 2 nouvelles tentatives). À afficher dans « Terminé » dès que `failed > 0` (ex. « 3 parties non lues »). |
| `member-error` | `memberId`, `code`, `message` | `code`: `RIOT_RATE_LIMITED` \| `CANCELLED` \| `FAILED`. **Rien n'est écrit** pour ce joueur (un pool incomplet n'écrase pas l'ancien). `FAILED` couvre : liste de parties impossible à lire (**plus jamais présentée comme « aucune partie »**), trop de parties illisibles (> max(2, 2 % de ses parties)), session expirée. |
| `done` | `cancelled`, `rateLimited`, `stats` | toujours le dernier, même après erreurs ou annulation |

`ScoutPoolEntry` : `{ championKey, role, games, wins, winRate|null, kda|null, masteryPoints|null, firstPlayedAt|null, lastPlayedAt|null, tier }`.

- `pool` est **toujours la liste complète** du joueur à cet instant (pas un delta) : l'écran remplace, il ne fusionne pas.
- `mastery.pool` : champions de la maîtrise **dans le rôle du joueur** (même filtre que la carte du Lobby), `games: 0`, `winRate: null`. Il est **remplacé** par les `chunk` ensuite ; un champion de maîtrise sans partie de saison disparaît du `chunk` (comme dans l'écriture finale du scout).
- `tier` des `chunk` est **provisoire** (même règle que l'écriture finale, avec les parties vues jusque-là). Les afficher sans les présenter comme définitifs avant `member-done`.
- `history` : `{ from, to }` (ms) de toutes les parties analysées.

## Ordre

- Maîtrise d'abord (priorité `background` comme sur le web : le proxy classe cette route en arrière-plan), puis listes d'ids de tous les joueurs en parallèle.
- Les parties de **toute l'équipe** sont triées de la plus récente à la plus ancienne (le timestamp est dans l'id) ; les parties **déjà en cache local** sont lues d'abord (gratuit), puis les manquantes téléchargées dans l'ordre, au plus 10 en vol.
- Les `chunk` de joueurs différents s'entrelacent. Un joueur qui n'a que des parties récentes peut finir (`member-done`) bien avant les autres.

## Fin, annulation, erreurs

- `scoutTeam` **résout** toujours (sauf erreur de validation) avec `ScoutTeamResult` : `{ scoutId, cancelled, rateLimited, stats, members: [{ memberId, ok, upserted, totalMatches, sameRoleCount, error? }] }`. Une erreur d'un joueur n'arrête pas les autres. `scoutMember` (un seul joueur) **rejette** comme avant.
- Limite Riot qui dure plus que les retries : tous les téléchargements s'arrêtent, les joueurs incomplets reçoivent `member-error` `RIOT_RATE_LIMITED`, `done.rateLimited = true`. Les parties déjà téléchargées restent en cache : **relancer reprend où ça s'est arrêté**, presque sans requête. Le message d'erreur contient `RIOT_RATE_LIMITED` : `isRiotRateLimited` (`src/lib/riotErrors.ts`) le reconnaît toujours.
- **Nouveaux cas d'erreur (audit du 27/11).** (1) Une liste de saison dont **une** file (solo, flex, clash) échoue est une erreur du joueur (`member-error FAILED`, ou `RIOT_RATE_LIMITED`), jamais « aucune partie », et le cache de scout n'est pas mis à jour : le scout incrémental suivant relit tout. `member-done` avec `totalMatches: 0` signifie donc vraiment « aucune partie ». (2) Une partie qui échoue pour une autre raison qu'un 404 est réessayée 2 fois, puis comptée `unreadable`. (3) Une **session expirée** arrête tout le scout : tous les joueurs incomplets reçoivent `member-error FAILED` (message : session expirée), `done.rateLimited = false` ; proposer de se reconnecter, pas « Reprendre ». (4) `scoutCancel` reçu **avant** l'enregistrement du scout est mémorisé : le scout démarre annulé (`found: false` dans la réponse, mais l'annulation est prise en compte). Un `scoutId` déjà en cours est refusé (erreur). (5) L'annulation est aussi vérifiée pendant la première phase (compte, maîtrise, listes), entre deux joueurs et deux étapes.
- `scoutCancel(scoutId)` : plus aucun nouveau téléchargement ; ceux en cours finissent (quelques secondes) ; les joueurs incomplets reçoivent `member-error` `CANCELLED`. Fermer la page n'annule pas : appeler `scoutCancel` à la fermeture si on veut l'arrêter.
- `stats` (dans `done` et le résultat) : `{ members, rawIds, uniqueIds, sharedIds, fromCache, downloaded, failed, firstPoolMs, totalMs }`. `failed` = parties non analysées, dont `unreadable` illisibles ; les 404 ne sont pas redemandées avant ~6 h **sauf si la partie est récente** (un 404 n'est mémorisé qu'après 30 min d'absence), cache borné à 5 000 entrées.

## Cas à gérer à l'écran

- Joueur **sans partie** : pas de `chunk`, `member-done` avec `upserted: 0`.
- Joueur sans maîtrise : pas de `mastery`, l'écran garde ce qu'il avait.
- Plusieurs scouts à la fois : filtrer par `scoutId`. Le débit Riot est partagé, ils s'attendent.
- Un chunk arrive après l'écran fermé : le main ignore les fenêtres détruites ; se désabonner au démontage.
- Les pools de la base ne changent **qu'à `member-done`** : un rechargement de page en cours de scout montre l'ancien pool.

## Web (`window.api` dans `web/src/api.ts`)

Mêmes noms, mêmes événements (`onScoutProgress` via un petit émetteur dans la page), même moteur. Différences :
- **pas de cache local de parties** (`fromCache` = 0) : c'est le magasin partagé du proxy (R2) qui répond gratuitement aux parties déjà lues par n'importe qui, sans toucher au budget Riot ;
- pas de scout incrémental (la liste de saison est relue en entier) ;
- **la reprise sur le web ne relit pas de cache local** : après une limite Riot ou une coupure, relancer relit les listes et retélécharge les parties (celles déjà lues par n'importe quel joueur reviennent vite du magasin R2 du proxy, sans toucher au budget Riot). Le texte web de la bannière ne doit **pas** promettre « les parties déjà lues sont gardées » ;
- **pacing porté sur le web** (`web/src/riotWeb.ts`) : 16 appels / min en arrière-plan, + 18 / 2 min dès qu'un 429 `proxy-user-share` est vu ; ce 429 ne met en pause que les appels `background`, il est réessayé jusqu'à 12 fois et son `Retry-After` (jusqu'à 120 s) est attendu au lieu de faire échouer le scout ;
- les écritures vont dans Supabase (`upsertPoolEntry`), à `member-done` aussi.

## Mesures (27/11/2026) : calculées depuis le code, PAS mesurées en direct

Aucun appel Riot réel n'a été lancé (pas de scout complet dans cette session). Hypothèse : 5 joueurs, ~300 parties de saison chacun (250 solo + 50 flex), `puuid` connus.

| Requêtes pour un scout de 5 | Avant | Après |
|---|---|---|
| comptes Riot ID (puuid inconnu) | 0 à 5 | 0 à 5 (inchangé) |
| région active (`active-regions`) | 5 | 5 |
| listes d'ids (3 files × pages de 100) | 25 | 25 (inchangé ; incrémental si déjà scouté) |
| maîtrise | 5 | 5 (maintenant en tête, priorité interactive) |
| détails de parties | 1 500 − déjà en cache (la déduplication ne jouait qu'entre membres scoutés l'un après l'autre) | **parties distinctes** de l'équipe − cache − 404 connus : 1 500 sans recoupement (adversaires solo-queue), **300** si les 5 jouent ensemble (flex / scrim : 4/5 épargné) |
| timelines | 0 | 0 |
| **Total** | ≈ 1 540 | ≈ 1 540 au pire (aucun recoupement), ≈ 340 au mieux |

Quantité de données : identique (saison complète par défaut, aucune partie ignorée ; seules les parties **inconnues de Riot** (404) ne sont plus redemandées pendant ~6 h).

| Temps estimé (1 500 détails non en cache) | Avant | Après |
|---|---|---|
| via le proxy, plafond par joueur **18 appels / 2 min en arrière-plan** (`USER_WINDOW_SHARE` 25 % × 95, 80 %, −1) | ≈ 167 min **plus** des 429 en rafale : le client envoyait jusqu'à 100 / 2 min avec 10 appels en vol, le proxy en laisse passer 18, et chaque 429 compte aussi dans le limiteur de 16 / min ; après 3 essais la partie était abandonnée sans bruit | ≈ 167 min mais **sans appel perdu** : le client se cale sur 16 / min, ajoute la fenêtre de 2 min dès le premier 429 « share », met tous les appels en pause ensemble et réessaie jusqu'à 12 fois (au lieu de 3) |
| clé de dev en direct (100 / 2 min) | ≈ 30 min | ≈ 30 min (même plafond Riot) |
| **premier résultat utile** (pool de champions) | à la fin du 1er joueur : ≈ 33 min (300 appels à 9 / min) | **quelques secondes** (5 appels de maîtrise) ; puis parties récentes d'abord, pool partiel toutes les ~10 parties |
| relance après coupure / 429 | relit tout, abandons silencieux | parties déjà lues = cache local, reprise quasi sans requête |

**Le vrai plafond est le proxy, pas le client** : tant que le budget par joueur reste à 18 appels / 2 min en arrière-plan, 1 500 détails non partagés prennent ≈ 2 h 45 quoi qu'on fasse côté app. Deux changements du **worker** (non faits, à décider ; ils déclencheraient une revue CyberSecurity) le feraient bouger vraiment :
1. faire passer la lecture du magasin R2 **avant** `USER_LIMITER` / `USER_LIMITER_BACKGROUND` et avant le budget : une partie déjà lue par n'importe qui coûterait zéro appel au joueur (aujourd'hui elle ne consomme que le budget global mais compte dans les 16 / min) ;
2. relever la part d'un joueur en arrière-plan (`USER_WINDOW_SHARE`) quand peu de joueurs sont actifs.
Si l'un des deux est adopté, ajuster `PROXY_BACKGROUND_PER_MINUTE` / `PROXY_BACKGROUND_PER_2_MIN` dans `src/lib/riotLimits.ts` (le client reflète le worker).

## Changements pour le Front (27/11, après audit)

1. `member-done` : lire `failed` et `unreadable` (nouveaux champs) et les afficher dans « Terminé ».
2. `done.stats.unreadable` (nouveau).
3. `member-error FAILED` n'est plus seulement une erreur de compte : il couvre liste en échec, trop de parties illisibles et session expirée ; le message est celui de l'erreur.
4. Plus de faux « Aucune partie trouvée » sur un échec de liste : `noGames` ne doit venir que d'un `member-done` avec `totalMatches: 0`.
5. Web : retirer la promesse de reprise sans cache dans la bannière.
6. `scoutMember` valide ses arguments (zod) : `scoutId` de 4 à 64 caractères, ou absent.
