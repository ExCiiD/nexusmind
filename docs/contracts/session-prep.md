# Contrat — préparer une session d'équipe à l'avance

Back-end, 20/11/2026. Décision de l'utilisateur du 20/11 (`docs/DECISIONS.md`) : « Coachs : préparer les sessions à
l'avance » (objectifs collectifs et individuels, drafts du Draft Sim). Spec écran validée : `DESIGN_STATE.md` § 17
(limites, message aux joueurs et visibilité alignés dessus).

Fichiers :
- types : `src/lib/sessionPrep.ts` ; calculs : `src/lib/sessionPrepCore.ts` (partagés desktop / web) ;
- desktop : IPC `session-prep:*` et preload ;
- web : `web/src/sessionPrepWeb.ts`. Le Front ajoute `...sessionPrepWebApi` à `web/src/api.ts`.

Migration : `20261120170000_team_session_prep.sql`, avec son rollback et son test PGlite, **non appliquée**. Avant
elle, la lecture renvoie des listes vides (`available: false`) et les écritures rejettent `NOT_AVAILABLE`.

## Qui prépare, et quand

- **Préparer** une session, c'est la gérer ou en faire partie du staff :
  - gérer : owner, coach, manager ou capitaine (`private.can_manage_session`) ;
  - staff : owner, coach ou analyste (`private.is_group_staff`) ;
  - l'analyste prépare donc aussi les drafts et les objectifs individuels.
- **Quand** : tant que la session est **prévue** (`scheduled`). Une fois démarrée, la préparation est en lecture seule
  (« Session en cours : les objectifs ne se modifient plus », § 17). L'historique (`team-session-history.md`) lit ce qui a
  été préparé.
- **Objectifs collectifs** : depuis la migration 170000, l'analyste peut aussi les écrire (choix de l'utilisateur sur
  l'audit des liaisons, 20/11). Ils existent déjà (`team_session_objectives`, `teamSessionGetObjectives` et
  `teamSessionSetObjectives`). Vérifié : ils sont modifiables en `scheduled`, par owner, coach, manager ou capitaine, quel
  que soit le statut. Rien ne change.

## Lecture : `sessionPrepGet(sessionId)`

```ts
interface SessionPrep {
  sessionId: string
  available: boolean                  // false avant la migration
  canPrepare: boolean                 // le lecteur peut écrire (rôle, et session prévue)
  objectives: TeamSessionObjectives | null   // collectifs, comme aujourd'hui
  message: { text: string; setBy: string | null; setAt: string } | null   // message du coach en tête de la vue joueur
  playerObjectives: PlayerSessionObjectives[]
  drafts: SessionDraft[]              // dans l'ordre (position, puis date d'ajout)
}

interface PlayerSessionObjectives {
  playerId: string
  objectiveIds: string[]              // 0 à 2 : fondamentaux ou axes de Mon plan (« de son plan »)
  kpiIds: string[]                    // KPI choisis sous ces objectifs, 10 au plus
  note: string | null                 // note courte, 140 caractères au plus
  setBy: string | null
  setAt: string
}

interface SessionDraft {
  id: string
  sourceId: string | null             // le draft d'origine (Draft Sim local ou draft partagé), pour le remplacer
  name: string
  bluePicks: string[][]; blueBans: string[][]; redPicks: string[][]; redBans: string[][]   // 5 créneaux au plus, chacun ses champions envisagés (souvent un seul), comme le Draft Sim
  myTeamSide: 'blue' | 'red'
  notes: string | null
  position: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
```

- **Visibilité** (§ 17) : tout le groupe lit les objectifs individuels. Chaque joueur voit le sien mis en avant et ceux
  des autres repliés. Le message et les drafts sont aussi lus par tout le groupe.
- **Badge « Préparation prête »** (Planning, Mon espace) : `sessionPrepReadyForEvents(calendarEventIds)` renvoie, en une
  requête pour la semaine, les événements dont la session a au moins un objectif, collectif ou individuel.

## Écriture

```ts
/** Les événements (parmi ceux donnés, 200 au plus) dont la session a au moins un objectif posé. */
sessionPrepReadyForEvents(calendarEventIds: string[]): Promise<string[]>

/** Le message aux joueurs (280 caractères) ; null ou vide le retire. */
sessionPrepSetMessage(sessionId: string, text: string | null): Promise<void>

/** Remplace les objectifs d'un joueur pour la session ; null les retire. */
sessionPrepSetPlayerObjectives(sessionId: string, playerId: string, value: { objectiveIds: string[]; kpiIds: string[]; note: string | null } | null): Promise<void>

/** Rattache une copie d'un draft. Le même sourceId remplace la copie déjà rattachée (« Mettre à jour depuis le Draft Sim »). Renvoie l'id. */
sessionPrepAttachDraft(sessionId: string, draft: SessionDraftInput): Promise<string>
/** Desktop seulement : rattache un draft du Draft Sim local (DraftPrep) par son id. */
sessionPrepAttachLocalDraft?(sessionId: string, draftPrepId: string): Promise<string>
/** Rattache un draft partagé de l'équipe (team_drafts) par son id. */
sessionPrepAttachSharedDraft(sessionId: string, teamDraftId: string): Promise<string>
sessionPrepRemoveDraft(draftId: string): Promise<void>
/** Nouvel ordre des drafts de la session (ids dans l'ordre voulu). */
sessionPrepReorderDrafts(sessionId: string, draftIds: string[]): Promise<void>

interface SessionDraftInput {
  sourceId: string | null; name: string
  bluePicks: string[][] | string[]; blueBans: string[][] | string[]; redPicks: string[][] | string[]; redBans: string[][] | string[]   // un champion seul vaut un créneau
  myTeamSide: 'blue' | 'red'; notes: string | null
}
```

- **Copie, pas un lien** : la publication de l'équipe réécrit tous les drafts partagés, qui changent alors d'id, et le
  Draft Sim est local à chaque PC. Un lien casserait. Modifier le draft d'origine ne change donc pas la copie : le
  Front propose de la remplacer.
- **Erreurs** :
  - `FORBIDDEN` : pas le droit, ou session déjà démarrée ;
  - `NOT_FOUND` : session ou draft introuvable ;
  - `INVALID` : plus de 2 objectifs, une note de plus de 140 caractères, un message de plus de 280, plus de 5
    champions par liste, un nom vide, ou un joueur hors du groupe ;
  - `NOT_AVAILABLE` : avant la migration.

## Drafts d'un scrim

La spec veut que les drafts d'un scrim (§ 13, `scrims.draft_ids`) et celles de la session soient les mêmes.
Aujourd'hui ce sont deux listes : `draft_ids` désigne des drafts partagés par leur id, qui change à chaque publication.
Proposition : le Front rattache les drafts à la session (`sessionPrepAttachSharedDraft`), et la page du scrim lit
`sessionPrepGet(...).drafts`. `draft_ids` pourra être retiré ensuite. À valider avant le Front.

## Hors de ce contrat (à décider)

- Prévenir le joueur quand le coach lui fixe des objectifs pour une session (notification).
- Bilan « tenu / pas tenu » des objectifs individuels en fin de session. Le verdict collectif existe :
  `teamSessionSetObjectiveResult`.
