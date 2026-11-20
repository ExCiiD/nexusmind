# Contrat — historique des sessions d'équipe

Back-end, 20/11/2026. Données des deux pages de `DESIGN_STATE.md` § 15 (liste `/team-sessions` et page d'une session
terminée). Les ajouts du § 15.3 ne sont **pas** couverts. Types dans `src/lib/teamSessionHistory.ts`, calculs dans
`src/lib/teamSessionHistoryCore.ts` (partagés desktop / web).

Branchement :
- desktop : déjà dans `window.api` (IPC `team-session-history:*` + preload) ;
- web : le Front ajoute `...teamSessionHistoryWebApi` (`web/src/teamSessionHistoryWeb.ts`) à `web/src/api.ts`,
  comme `analystWebApi`.

Aucune fonction de ce contrat n'appelle Riot. Les stats viennent du `match_json` déjà mis en cache sur chaque game, et la
timeline du `timeline_summary` déjà calculé. Pour une game qui n'a pas encore l'un ou l'autre, le Front appelle les
fonctions qui existent déjà, puis recharge le détail :
- `teamSessionFetchMatch(gameId)` → met le match en cache ;
- `teamObjectivesGameTimeline(gameId)` → calcule et met en cache la timeline (or à 15:00, frise d'objectifs).

## 1. Liste : `teamSessionHistoryList(groupId, filters)`

```ts
type SessionKind = 'flex' | 'scrim' | 'tournament' | 'meeting' | 'other'
type HistoryPeriod = '30d' | 'season' | 'all'

interface TeamSessionHistoryFilters {
  kind: SessionKind | 'all'
  period: HistoryPeriod
  /** Pagination : les 20 premières, puis `before` = `startsAt` de la dernière ligne reçue. */
  before?: string | null
  limit?: number            // 20 par défaut, 50 au plus
}

interface TeamSessionHistoryPage {
  sessions: TeamSessionHistoryRow[]   // plus récentes en haut
  hasMore: boolean
  /** Sur toute la période filtrée (pas seulement la page). */
  summary: TeamSessionHistorySummary
}

interface TeamSessionHistoryRow {
  sessionId: string
  calendarEventId: string             // pour ouvrir /team-session/:calendarEventId
  kind: SessionKind
  title: string                       // titre du créneau (« vs Karmine Academy »)
  opponent: string | null             // nom de l'adversaire (scrim, ou nom saisi sur une game)
  startsAt: string                    // ISO, début du créneau
  endsAt: string
  format: 'bo1' | 'bo3' | 'bo5' | null   // scrim ou officiel planifié depuis le Planning
  games: Array<{ gameId: string; win: boolean | null; durationSec: number | null }>   // dans l'ordre joué ; win null = stats pas encore chargées
  wins: number
  losses: number
  playedSec: number                   // somme des durées connues (« 1 h 34 de jeu »)
  objectives: { total: number; held: number; judged: number }   // « 2 / 3 tenus » = held / total
  hasNotes: boolean                   // notes du scrim, ou retours des joueurs
  review: 'done' | 'pending' | 'none' // review de session ou d'une game : faite, commencée, aucune
  eventDeleted?: boolean              // créneau supprimé après le début : la ligne lit la copie gardée par la session (§ 6)
  meeting?: MeetingRowInfo            // réunions seulement (§ 5)
}

interface TeamSessionHistorySummary {
  sessions: number
  byKind: Record<SessionKind, number> // « dont 6 scrims, 2 tournois »
  games: number
  wins: number
  losses: number
  winRate: number | null              // 0-100, null sans game connue
  objectivesHeld: number              // « 27 sur 40 »
  objectivesTotal: number
  reviewed: number                    // « 11 / 14 · 3 sessions sans review » (sessions de jeu seulement)
  withoutReview: number
  meetings: { count: number; averageAttendancePct: number | null; summariesDone: number; recordedSec: number | null }   // tuiles « Réunion » (§ 5)
}
```

Règles :
- **Sessions listées** : statut `ended` seulement.
- **Visibilité** : le staff du groupe (owner, coach, analyste, manager, capitaine) les voit toutes. Un joueur voit
  celles dont il fait partie : créneau « toute l'équipe » ou « tous les joueurs », invité du créneau, présence
  enregistrée, ou une de ses games.
- **Type** : celui du créneau (`scrim`, `flex`, `tournament`, `meeting`). Sinon celui des games (file 440 → flex,
  700 → tournoi). Sinon `other` : il n'apparaît que dans « Toutes ».
- **Période** : `30d` = 30 derniers jours ; `season` = depuis le 1er janvier de l'année en cours (la saison commence
  au patch .1 de janvier) ; `all` = tout.
- **Objectif tenu** :
  - le verdict « toute la session » du staff s'il existe ;
  - sinon tenu sur plus de la moitié des games jugées ;
  - sans verdict, l'objectif n'est pas jugé (compté dans `total`, pas dans `judged`).

## 2. Détail : `teamSessionHistoryDetail(sessionId)`

```ts
interface TeamSessionHistoryDetail {
  header: {
    sessionId: string; calendarEventId: string; kind: SessionKind; title: string; opponent: string | null
    startsAt: string; endsAt: string; format: 'bo1' | 'bo3' | 'bo5' | null
    wins: number; losses: number
    responsibleUserIds: string[]
    status: TeamSessionStatus          // 'ended' pour le mode historique ; les autres statuts gardent la page actuelle
    eventDeleted?: boolean
  }
  games: HistoryGame[]                 // G1, G2… dans l'ordre joué
  /** « Toute la session » : cumul des games dont les stats sont prêtes. Null s'il n'y en a aucune. */
  whole: {
    gamesCounted: number
    team: TeamTotals                   // nous / eux cumulés, moyennes de durée et d'écart d'or à 15:00
    players: SynergyPlayerStats[]      // nos joueurs, moyennes par game (gamesPlayed = nombre de games)
    enemyPlayers: SynergyPlayerStats[] // vis-à-vis cumulés par rôle (memberId = rôle)
    duels: DuelRow[]                   // buildDuelRows(players, enemyPlayers)
  } | null
  objectives: Array<{
    objectiveId: string                // id du fondamental (libellé côté Front, comme aujourd'hui)
    session: boolean | null            // verdict « toute la session » du staff
    byGame: Record<string, boolean>    // gameId → tenu / pas tenu
    held: boolean | null               // même règle que la liste
  }>
  kpiIds: string[]                     // KPI choisis au lancement (rangés sous leur objectif par le Front, comme aujourd'hui)
  reviews: TeamSessionReview[]         // session, meeting et par game (gameId)
  feedback: TeamSessionFeedback[]      // retours des joueurs
  scrimNotes: { prepNotes: string | null; reviewNotes: string | null; checklist: Array<{ label: string; done: boolean }>; status: 'planned' | 'done' | 'cancelled' } | null
  attendance: Record<string, boolean>  // userId → présent
  meeting?: MeetingDetail             // réunions seulement (§ 5)
}

interface HistoryGame {
  gameId: string
  index: number                        // 1, 2, 3…
  matchId: string
  /** 'ready' : stats calculées ; 'not-fetched' : appeler teamSessionFetchMatch ; 'no-side' : notre côté introuvable ; 'error' : game non trouvée chez Riot. */
  stats: 'ready' | 'not-fetched' | 'no-side' | 'error'
  win: boolean | null
  durationSec: number | null
  enemyTeamName: string | null
  team: TeamTotals | null              // nous / eux de cette game
  players: SynergyPlayerStats[]        // nos 5 (memberId = userId du membre, sinon le nom en jeu)
  enemyPlayers: SynergyPlayerStats[]
  duels: DuelRow[]
  /** Timeline mise en cache (frise d'objectifs § 10, écart d'or). Null : appeler teamObjectivesGameTimeline(gameId). */
  timeline: TeamGameTimeline | null
}

interface TeamTotals {
  our: SideTotals; enemy: SideTotals
  avgDurationSec: number
  /** Notre or moins le leur à 15:00 (moyenne sur les games dont la timeline est connue), null sinon. */
  goldDiffAt15: number | null
}
interface SideTotals { kills: number; deaths: number; assists: number; gold: number; damage: number; vision: number }
```

Le filtre par game (`?game=2`) est côté Front : `games[1]` pour une game, `whole` pour toute la session.

## 3. Écriture : `teamSessionSetObjectiveResult(sessionId, objectiveId, gameId, met)`

`gameId` null = verdict « toute la session » ; `met` null efface le verdict. Réservé aux gestionnaires de la session
(owner, coach, manager, capitaine : `private.can_manage_session`). Les autres reçoivent `FORBIDDEN`.

**Migration nécessaire** (écrite, **non appliquée**) :
- `supabase/migrations/20261120150000_team_session_objective_results.sql`, avec son rollback et son test PGlite ;
- ajoute la table `team_session_objective_results` : le verdict tenu / pas tenu du staff, par objectif et par game ;
- la mesure automatique (§ 8 de `PROPOSITION_ANALYSTE.md`) n'existe pas encore, et les KPI sont qualitatifs.

Avant la migration :
- la liste et le détail marchent, mais les objectifs n'ont pas de verdict (`held: null`, `judged: 0`) ;
- l'écriture renvoie `NOT_AVAILABLE`.

## 4. États (§ 15)

- Liste vide : `sessions: []` avec `summary.sessions = 0`.
- Session sans game : `games: []`, `whole: null`.
- Game sans stats Riot : `stats: 'error'` (« Stats indisponibles pour la G3 : game non trouvée chez Riot »).
- Session introuvable ou hors du groupe du lecteur : `teamSessionHistoryDetail` rejette avec `NOT_FOUND`.

## 5. Réunions (§ 15.2 bis)

Les sessions dont le créneau est de type `meeting` ont le type `'meeting'` (filtre « Réunion »). Elles sont mêlées aux
sessions de jeu par date en « Toutes ». Pour une réunion : `games: []`, `whole: null`, objectifs vides.

```ts
type MeetingScope = 'whole_team' | 'all_players' | 'all_staff' | 'custom'
type PresenceStatus = 'present' | 'absent' | 'no-answer'

interface MeetingRowInfo {             // ligne de la liste
  present: number; concerned: number  // « 5 / 6 présents »
  scope: MeetingScope                 // « Toute l'équipe », « Staff », « 2 personnes » (custom : concerned)
  durationSec: number                 // durée du créneau
  recorded: boolean; transcript: boolean
  summary: 'done' | 'pending' | 'none'   // « RÉSUMÉ ✓ » / « RÉSUMÉ À FAIRE »
  people: Array<{ userId: string; name: string | null; status: PresenceStatus }>   // pastilles d'initiales : vert présent, rouge absent, gris sans réponse
}

interface MeetingDetail {              // page d'une réunion
  reason: string                      // le titre du créneau (pas de champ dédié aujourd'hui)
  notes: string | null                // les notes du créneau
  organizerId: string | null          // le créateur du créneau
  scope: MeetingScope
  people: Array<{ userId: string; role: string; status: PresenceStatus; absenceNote: string | null }>
  present: number; concerned: number
  recording: { localPath: string | null; youtubeUrl: string | null; youtubeVisibility: YoutubeVisibility; recordedBy: string | null; recordedAt: string } | null
  summary: string | null; transcript: string | null
  reviewId: string | null             // la review de scope 'meeting', pour éditer le résumé (teamSessionReviewUpdate)
  reviewStatus: ReviewStatus | null   // 'processing' : « Transcription en cours… »
}
```

Règles :
- **Personnes concernées** :
  - `whole_team` : tout le groupe ;
  - `all_players` : les joueurs, et un owner qui joue aussi ;
  - `all_staff` : owner, coach, analyste, manager, ou un rôle staff en plus ;
  - `custom` : les invités du créneau.
- **Présence** :
  - la case cochée pendant la réunion (présent / absent) ;
  - sinon une réponse « je ne viens pas » au créneau, qui compte comme absent avec sa note (« raison d'absence ») ;
  - sinon « pas répondu ».
- **Présence moyenne** : moyenne de présents / concernés sur les réunions qui concernent au moins une personne.
- **Temps enregistré** : non stocké aujourd'hui, l'enregistreur ne garde pas de durée. `recordedSec: null`, et la tuile
  affiche « — » tant qu'il ne l'enregistre pas.

## 6. Sessions automatiques (migration `20261120160000_team_session_auto_lifecycle`, non appliquée)

Création (existait déjà) : un créneau scrim, flex, tournoi ou réunion crée sa session vide (`scheduled`), à la création,
ou quand un créneau change pour l'un de ces types.

**Ouverture et clôture automatiques** (pg_cron `team-session-lifecycle`, chaque minute) :
- **Ouverture** : un scrim, flex ou tournoi s'ouvre tout seul (`live`) à l'heure de début du créneau.
  - Responsable : celui déjà choisi, sinon le créateur du créneau s'il est encore membre, sinon les owners du groupe.
  - File : celle du type. Un tournoi est en parties personnalisées (ses matchs passent par des codes de tournoi), pour ne pas ramasser la soloQ jouée pendant ce temps.
  - Les objectifs se règlent avant ou pendant la session, comme aujourd'hui.
  - Le bouton « Démarrer » n'est plus nécessaire ; il reste utilisable avant l'heure.
- **Clôture** : une session ouverte se termine 1 h après la fin du créneau, pour ne pas ramasser d'autres games ensuite.
- **Réunions** : elles gardent leur lancement et leur fin à la main (MeetingSetupCard).

**Le créneau bouge** : la session suit, puisqu'elle lit l'heure du créneau. Une session ouverte par l'horloge et
encore vide repasse en `scheduled` si le créneau part plus tard.

**Annulation** :
- Créneau supprimé, ou scrim marqué annulé : sa session est supprimée si elle est vide (aucune game, review, retour ni
  présence).
- Une session commencée est gardée : elle se termine si elle était ouverte, et `calendar_event_id` passe à null.
  - Elle garde une copie de son créneau, que lisent l'historique et `eventDeleted: true`.
  - Sa route `/team-session/:calendarEventId` ne trouve plus le créneau : la page devra s'ouvrir par `sessionId`
    (à prévoir côté Front).
- Un créneau qui passe à un type sans session (repos, autre) emporte aussi sa session vide.

Avant la migration, rien ne change : ouverture et fin à la main, et suppression du créneau = suppression de la session.
