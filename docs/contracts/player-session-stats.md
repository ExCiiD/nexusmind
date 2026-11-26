# Contrat — fiche « Stats individuelles » d'un joueur (session entière ou une game)

Back-end, 26/11/2026 (lot L11). Module pur, partagé desktop / web, **sans Riot, sans I/O, sans IPC** :
`src/lib/playerStatsSheetCore.ts`. Rien à brancher côté `window.api` : le Front appelle la fonction avec des données qu'il a déjà.

> À ne pas confondre avec `src/lib/playerSessionStatsCore.ts` (lot « Stats indiv joueur », § 7 de `team-session-history.md`) :
> celui-là calcule les chiffres issus de la timeline (isolement, diffs @10/@15, radar) et passe par `teamSessionPlayerStats`.
> La fiche d'ici ne refait aucun calcul : elle **sélectionne** dans `detail.whole` / `detail.games[]` (via `selectGame`,
> donc `buildSideStats`, `buildDuelRows`, `mergePlayerStats` déjà appliqués) et met en forme.

## 1. Session d'équipe

```ts
import { buildPlayerStatsSheet } from '@/lib/playerStatsSheetCore'

buildPlayerStatsSheet(detail, userId, gameIndex /* HistoryGame.index (1…n) ou null = session */): PlayerStatsSheet
```

- `detail` = le résultat de `teamSessionHistoryDetail(sessionId)` (déjà chargé par la page session ; seuls `games` et `whole` sont lus).
- `userId` = `group_members.user_id` (= `SynergyPlayerStats.memberId` côté nôtre). Joueur hors cadre des cinq : pas de ligne, pas d'erreur.
- `gameIndex` = la valeur de `parseGameParam(?game=…)`. Un index inconnu donne `status: 'unknown-game'`.
- Un utilisateur dans plusieurs groupes : une session appartient à un seul groupe, donc on appelle avec le `detail` de cette
  session. Aucun état partagé entre appels.

## 2. Session solo

```ts
buildSoloPlayerStatsSheet(games: SoloGameInput[], userId, gameIndex | null): PlayerStatsSheet
```

`games` = `activeSession.games` (store) ou les games d'une session terminée lues en local. Les games sont remises dans l'ordre
joué (`gameEndAt` croissant) ; `gameIndex` = rang 1-based dans cet ordre (l'inverse de l'affichage `#{n - idx}` de la liste).
Aucun appel Riot. Le store ne garde pour une game solo que : champion, rôle, K/D/A, CS, vision, durée, victoire. Donc :
`partial: true`, `duel: null`, et `missing` liste les champs à **ne pas afficher** (valent 0 dans `line` : or, dégâts, parts,
wards, CC, XP/min…). Une game sans K/D/A stockés est `not-fetched`. `line.displayName` vaut `''` (le Front met le pseudo du compte).

## 3. Type renvoyé (les deux cas)

```ts
type SheetGameStatus = 'ready' | 'not-fetched' | 'no-side' | 'error'

interface PlayerStatsSheet {
  source: 'team' | 'solo'
  userId: string
  gameIndex: number | null
  /** Une game : son statut, ou 'unknown-game'. Session : 'ready' dès qu'une game a ses stats, sinon le statut commun
   *  (not-fetched > no-side > error), sinon 'no-data' (aucune game). */
  status: SheetGameStatus | 'no-data' | 'unknown-game'
  playerFound: boolean                 // le joueur a une ligne dans les chiffres montrés
  line: SynergyPlayerStats | null      // une game : sa ligne ; session : moyenne par game sur les games qu'il a jouées
  duel: DuelRow | null                 // { role, our, enemy } : vis-à-vis de lane (session : adversaire combiné par rôle)
  series: SheetGamePoint[]             // TOUTES les games, dans l'ordre, pour le graphique (la game choisie aussi)
  averages: SynergyPlayerStats['averages'] | null   // = line.averages
  gamesCounted: number                 // games derrière `line` (1 ou 0 pour une game)
  gamesTotal: number                   // games de la session
  gamesWithStats: number               // games avec stats, qui que ce soit (« 3 / 4 games »)
  partial: boolean                     // solo : true
  missing: string[]                    // solo : champs à masquer
}

interface SheetGamePoint {
  gameId: string; index: number; status: SheetGameStatus
  played: boolean                      // false : joueur absent des cinq, ou game sans stats
  win: boolean | null; durationSec: number | null; championKey: string | null
  kda; kills; deaths; assists; cs; csPerMin; damagePerMin; goldPerMin; visionScore; kpPct; damagePct   // number | null
}
```

## 4. Règles d'affichage

- Statut par game (pastille / trou dans le graphique) : `series[i].status`. `ready` + `played:false` = le joueur n'a pas joué
  cette game (point absent, pas « erreur »). `not-fetched` : proposer `teamSessionFetchMatch(gameId)` puis recharger le détail.
  `no-side` / `error` : message, pas de relance automatique.
- Les valeurs de `series` sont `null` quand il n'y a rien à tracer : ne jamais les convertir en 0.
- Moyennes de session : KDA = (K + A) / D cumulés (règle de `mergePlayerStats`), pas la moyenne des KDA.
- Pas de fiche si `status` ∈ `no-data` / `unknown-game` ; `playerFound:false` avec `status:'ready'` = « n'a pas joué cette game ».

## 5. Vérifié

`tests/unit/playerStatsSheetCore.test.ts` (13 tests) : un joueur sur plusieurs games, une game sans stats (`pending_fetch`, `error`),
`no-side`, joueur absent d'une game (remplaçant), joueur étranger, index inconnu, même `userId` dans deux groupes, non-mutation du
détail, solo (session, une game, game sans stats, vide, index inconnu).

---

# Partie B — lot L11b : champs timeline étendus, session solo, comparaison 30 jours

Back-end, 26/11/2026. **Contrat écrit avant le code** ; les types ci-dessous sont ceux exportés par
`src/lib/playerSessionStatsCore.ts` (les champs de § 7 de `team-session-history.md` ne changent pas, on **ajoute**).
Règle générale : une donnée inconnue est `null`, jamais `0`.

## B1. Nouveaux champs de `PlayerGameStats` (une game)

```ts
/** = `Zone` de `src/lib/microReview/geometry.ts` (`zoneOf`), relative à notre côté. */
type MapZone = 'own-base' | 'enemy-base' | 'top-lane' | 'mid-lane' | 'bot-lane' | 'top-river' | 'bot-river' | 'own-jungle' | 'enemy-jungle'

interface PlayerGameStats {
  /* …champs existants… */
  /** Écart joueur − vis-à-vis, par minute (index = minute, 0 = début). Une case sans donnée = null. Null sans timeline `players` v2 ou sans vis-à-vis. */
  diffSeries: { gold: Array<number | null>; xp: Array<number | null>; cs: Array<number | null> } | null
  /** Morts / kills du joueur, par ordre chronologique. Null sans timeline (≠ [] : « aucune mort »). */
  deathEvents: PlayerEvent[] | null
  killEvents: PlayerEvent[] | null
  /** Participation aux objectifs (le joueur = tueur ou assistant). Null sans timeline v2. */
  objectives: ObjectiveParticipation | null
  /** Résumé de lane @10 / @15. Null si ni timeline v2 ni rapport de lane. */
  laneSummary: LaneSummary | null
  /** Chiffres du match (jamais de timeline). Chaque champ null si Riot ne le donne pas. */
  extras: PlayerExtras
  /** Points forts / à travailler de la game (§ B4). */
  highlights: Highlights
}

interface PlayerEvent {
  gameId: string
  gameIndex: number
  atSec: number                 // temps de jeu
  clock: string                 // « 12:40 »
  x: number | null; y: number | null          // unités de carte (0-14800), null si Riot n'a pas donné de position
  zone: MapZone | null          // zone approximative de (x, y), relative à NOTRE côté (own-/enemy-)
  early: boolean                // atSec < 14:00 (840 s)
  isolated: boolean | null      // aucun coéquipier vivant à ≤ 2500 unités ; null = positions inconnues. Jugé à toute minute ici
                                // (le compteur `isolatedDeathsAfter14` du § 7 ne compte, lui, que les morts ≥ 14:00)
  otherChampion: string | null  // mort : le tueur ; kill : la victime (null : exécution / inconnu)
  assisters: number             // mort : ennemis ayant assisté ; kill : alliés ayant assisté
  /** Pour la review VOD : max(0, atSec − 10). Le Front ajoute le décalage de l'enregistrement de CETTE game (comme vodTiming / gameClock). */
  vodSeekSec: number
}

type ObjectiveKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | 'tower'
interface ObjectiveLine {
  kind: ObjectiveKind
  ours: number          // pris par notre équipe (grubs : un par grub ; tower : tours détruites par nous)
  participated: number  // dont le joueur est tueur ou assistant
  killed: number        // dont le joueur est le tueur
  theirs: number        // pris par l'ennemi
}
interface ObjectiveEvent { kind: ObjectiveKind; atSec: number; clock: string; ours: boolean; participated: boolean; killed: boolean
                           subType?: string; lane?: 'TOP' | 'MID' | 'BOT'; vodSeekSec: number }
interface ObjectiveParticipation { byKind: ObjectiveLine[] /* toujours les 6 types, dans l'ordre ci-dessus */; events: ObjectiveEvent[] }

interface LaneSide { cs: number | null; gold: number | null; xp: number | null; level: number | null }
interface LaneSnap {
  minute: 10 | 15
  player: LaneSide
  opponent: LaneSide | null     // null sans vis-à-vis
  diff: LaneSide | null         // joueur − vis-à-vis, champ à champ (null si l'un des deux manque)
}
interface LaneSummary { at10: LaneSnap; at15: LaneSnap; source: 'timeline' | 'lane-report' }

interface PlayerExtras {
  soloKills: number | null; firstBloodInvolved: boolean | null; largestMultiKill: number | null
  doubleKills: number | null; tripleKills: number | null; quadraKills: number | null; pentaKills: number | null
  killingSprees: number | null; timeDeadSec: number | null; timeDeadPct: number | null
  damageToObjectives: number | null; damageToTurrets: number | null; damageMitigated: number | null
  healAndShield: number | null; objectivesStolen: number | null; visionPerMin: number | null
}
```

`timelineStatus` : `'ready'` = timeline en cache **avec bloc `players` v2** (`TimelinePlayers.v === 2`, `teamTimelineCore.PLAYERS_BLOCK_VERSION`) (tous les champs ci-dessus) ; `'no-players'` = résumé en cache
sans `players` ou en v1 (les champs v1 sont calculés, les nouveaux sont `null`) → le Front relance avec `{ enrich: true }` comme avant ;
`'no-timeline'` = rien en cache. `extras` ne dépend jamais de la timeline.

## B2. Nouveaux champs de `PlayerSessionStats` (toute la session)

```ts
interface PlayerSessionStats {
  /* …champs existants… */
  source: 'team' | 'solo'
  /** Toutes les games, mises bout à bout (chaque évènement porte son gameId / gameIndex). Null si aucune game n'a de timeline. */
  deathEvents: PlayerEvent[] | null
  killEvents: PlayerEvent[] | null
  /** Moyenne 30 jours du joueur (mêmes stats que le Dashboard), § B5. Null si indisponible. */
  avg30d: Baseline30d | null
  highlights: Highlights                 // sur les moyennes de la session
  /** Games de la session sans stats calculables (ni match ni timeline en cache). Jamais d'appel Riot pour les combler (solo). */
  unavailableGames: Array<{ gameId: string; gameIndex: number; reason: 'no-match' | 'no-side' | 'not-a-player' }>
  total: PlayerSessionTotals & {
    diffSeries: { gold: Array<number | null>; xp: Array<number | null>; cs: Array<number | null> } | null  // moyenne par minute sur les games qui ont la minute
    laneSummary: LaneSummary | null                                                                       // moyenne par game, champ à champ
    objectives: ObjectiveLine[] | null                                                                   // sommes sur les games avec timeline v2
    extras: SessionExtras                                                                                // compteurs sommés, taux moyennés (§ B3)
    deaths: EventSummary | null
    kills: EventSummary | null
    gamesWithObjectives: number
  }
}
/** = PlayerExtras sans `firstBloodInvolved`, plus `firstBloodShare: number | null` (part des games, 0-1). */
type SessionExtras = Omit<PlayerExtras, 'firstBloodInvolved'> & { firstBloodShare: number | null }
interface EventSummary { total: number; early: number; isolated: number /* jugés isolés */; judged: number /* dont la position permet de juger */
                         byZone: Partial<Record<MapZone, number>> }
```

## B3. Agrégats « toute la session »

- `diffSeries` : pour chaque minute, moyenne des games qui ont une valeur (null si aucune). `laneSummary` : moyenne par champ sur les games où il est connu (`source` = `'timeline'` si au moins une game l'est).
- `objectives` : sommes de `ObjectiveLine` sur les games avec timeline v2 ; `gamesWithObjectives` = leur nombre (dénominateur).
- `extras` : **sommés** `soloKills`, `doubleKills`, `tripleKills`, `quadraKills`, `pentaKills`, `killingSprees`, `objectivesStolen`, `timeDeadSec` ; **moyennés** les autres ; `firstBloodInvolved` → `firstBloodShare` = part des games (0-1) ; `largestMultiKill` → maximum.
- `deaths` / `kills` : comptes sur tous les évènements de la session.

## B4. Highlights

```ts
type HighlightId = 'csPerMin' | 'goldPerMin' | 'damagePerMin' | 'xpPerMin' | 'kda' | 'deaths' | 'kpPct' | 'visionScore'
                 | 'goldDiff15' | 'csDiff15' | 'deathsBefore14' | 'isolatedDeaths'
interface Highlight { id: HighlightId; value: number; reference: number; referenceSource: '30d' | 'opponent' | 'even'; deltaPct: number | null }
interface Highlights { strengths: Highlight[]; weaknesses: Highlight[] }   // 3 au plus chacun, le plus marqué d'abord
```

Dérivés des chiffres, sans IA, par le même code partout. Ratios (`csPerMin`, `goldPerMin`, `damagePerMin`, `xpPerMin`, `kda`, `kpPct`, `visionScore`, `deaths`) :
référence = moyenne 30 jours si `avg30d` la donne, sinon le vis-à-vis de lane ; écart relatif ≥ **15 %** = point fort (ou à travailler, `deaths` inversé :
moins de morts = mieux). Absolus (référence `even`) : `goldDiff15` ≥ +300 / ≤ −300, `csDiff15` ≥ +8 / ≤ −8, `deathsBefore14` ≥ 2 (à travailler), `isolatedDeaths` ≥ 2 (à travailler).
Le Front traduit `id` (`playerSheet.highlight.<id>`) ; jamais de texte côté Back.

## B5. Moyenne 30 jours (`avg30d`)

```ts
interface Baseline30d {
  source: 'dashboard'
  games: number; from: string; to: string      // ISO, fenêtre = 30 jours glissants jusqu'à maintenant
  winRate: number | null; kills: number | null; deaths: number | null; assists: number | null; kda: number | null
  csPerMin: number | null; goldPerMin: number | null; xpPerMin: number | null; damagePerMin: number | null
  visionScore: number | null; kpPct: number | null; damagePct: number | null
  goldDiff15: number | null; csDiff15: number | null; xpDiff15: number | null
}
```

Source : les `DetailedStats` locaux du joueur (mêmes chiffres, même `computeAverages` que `stats:get-account-averages` du Dashboard), games des 30 derniers jours,
**lus en local uniquement** (aucun appel Riot). Conséquence : `avg30d` n'est rempli que pour **le joueur connecté sur son propre PC** (équipe : l'entrée dont
`memberId` = son user id ; solo : toujours). Pour un coéquipier, `avg30d: null` (son Dashboard est sur son PC) et les highlights se comparent au vis-à-vis.
`attachBaseline(stats, userId, baseline)` (pur) pose `avg30d` et recalcule les `highlights`.

## B6. Équipe : `teamSessionPlayerStats(sessionId, { enrich? })`

Inchangé côté signature. Ajouts : les champs B1/B2 ; `avg30d` posé en desktop pour le joueur connecté. Les games dont le résumé en cache n'a pas
`players` **v2** passent en `timelineStatus: 'no-players'` ; avec `{ enrich: true }` elles sont ré-extraites (une fois par game, priorité background). Le web ne pose pas `avg30d`.

## B7. Solo : `window.api.soloSessionPlayerStats(sessionId?: string | null): Promise<PlayerSessionStats[]>`

- IPC `solo-session:player-stats` (zod : `[string.min(1).max(64).nullable().optional()]`), preload `soloSessionPlayerStats`, type `ElectronAPI.soloSessionPlayerStats` (`src/lib/ipc.ts`, optionnel).
- `sessionId` : id de la session solo (`Session.id`) ; `null` / absent = la session active.
- Renvoie **la même forme que l'équipe**, un tableau de 0 ou 1 élément : le joueur connecté, `memberId` = `user.id` local (celui de `useUserStore`), `source: 'solo'`. Tableau vide : pas de session, ou aucune game exploitable.
- `PlayerGameStats.gameId` = `Game.id` local ; `gameIndex` = rang 1-based dans l'ordre joué (`gameEndAt` croissant) = `soloGameRank`.
- Lecture **locale uniquement** : `MatchCache` (match + timeline), `Game.lanePhaseReport`, `DetailedStatsMemo`. Aucun appel Riot, jamais. Game sans match en cache : dans `unavailableGames` (`no-match`).
  Match en cache sans timeline : `timelineStatus: 'no-timeline'`, champs timeline `null` ; `laneSummary` retombe sur `Game.lanePhaseReport` (`source: 'lane-report'`) s'il existe.
- Plus de champ `missing` / `partial` : tout ce que la timeline et le match donnent est rempli comme en équipe. `opponent`, `vsOpponent`, `radar`, `base.averages.gold…` sont remplis (le match complet est lu).
- `buildSoloPlayerStatsSheet` (§ 2) reste valable pour la ligne simple ; le Front peut passer à `soloSessionPlayerStats` pour la fiche complète et garder l'ancien en repli (`window.api.soloSessionPlayerStats` absent).

## B8. Ce qui change pour le cache et le Front

- **Bloc `players` v2** (`TEAM_TIMELINE_VERSION` reste 1) : ajoute `lvl[]`, `cs[]` par participant (les deux côtés) et `objectives[]` (`{ t, kind, teamId, killer, assists, subType?, lane? }`). ~+4 ko par game.
  Un bloc v1 (déjà en cache) reste lisible : `timelineStatus: 'no-players'`, les champs v1 sont calculés, les nouveaux sont `null` ; le Front relance `teamSessionPlayerStats(id, { enrich: true })` comme avant (la ré-extraction se déclenche sur « pas de v2 », `analystCore.loadTeamGameTimeline`).
- Le Front peut lire `timelineStatus` pour proposer l'extraction ; en solo il n'y a **pas** d'`enrich` (aucun appel Riot) : `'no-timeline'` / `'no-players'` restent tels quels.
- `PlayerGameStats` / `PlayerSessionStats` et tous les types B1-B5 sont ré-exportés par `src/lib/teamSessionHistory.ts` (`import type { PlayerEvent, … } from '@/lib/teamSessionHistory'`).
- Solo : `soloSessionPlayerStats` n'existe que sur desktop ; le web n'a pas de session solo.
