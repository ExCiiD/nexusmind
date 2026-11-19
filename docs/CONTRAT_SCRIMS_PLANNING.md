# #49 — Contrat Back-end → Front-end : les scrims dans le Planning

Back-end, 20/11/2026. Tout est en local, rien en production. La maquette validée est dans `docs/DESIGN_STATE.md`
§ 13, la proposition dans `docs/PROPOSITION_SCRIMS_PLANNING.md`.

Ce qui est livré côté Back-end :

- la migration `20261120120000_scrims_in_planning.sql`, avec son retour arrière et son test PGlite (58 contrôles) ;
- l'API partagée par le desktop et le web ;
- l'import des adversaires dans le Scouting et le Draft Sim du desktop ;
- `publishTeam` par clé ;
- le bot.

Écart avec la proposition, aligné sur la maquette : **la présence se donne sur le créneau** (« Je serai là / Je ne
peux pas », `calendarRespond`), pas dans `scrim_availability`. Le contrôle des dispos (`run_scrim_availability_check`)
lit désormais ces réponses.

## 1. Types (`src/lib/matchEvent.ts`)

- `MatchEventKind = 'scrim' | 'tournament'` : « Officiel » est le kind `tournament` (CHOIX 1, voir § 6).
- `matchKindOf(kind)` et `isMatchKind(kind)` disent si un créneau est un match.
- `DEFAULT_MATCH_MINUTES = { bo1: 60, bo3: 150, bo5: 240 }` : la durée de la maquette quand on choisit le format.
- `OPPONENT_ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']`. Afficher TOP / JGL / MID / ADC / SUP, mais envoyer
  ces valeurs.
- `CalendarEvent.match?: MatchSummary` = `{ scrimId, kind: 'scrim' | 'official', opponentName, opponentKey, boFormat,
  status }`. Il est rempli par `calendarListEvents` / `calendarGetEvent` pour la carte de la grille (« vs KCA · Bo3 »)
  et absent avant la migration.
- `MatchEventDetail` (panneau de détail) : `{ event, scrimId, kind, boFormat, status, opponent, prepNotes, reviewNotes,
  checklist, draftIds }`.
  - `opponent` vaut `{ key, name, tag, opggUrl, source, players, hasDossier }`, ou null.
  - `players` contient au plus un joueur par rôle, dans l'ordre des lanes : `{ role, riotId, region, opggUrl }`.
  - `opggUrl` de l'équipe = le lien collé, sinon un multisearch op.gg construit à partir des Riot ID complets.
  - `hasDossier` vaut false tant que la migration analyste (#40) n'est pas en prod.
- `KnownOpponent` (select « Équipe connue ») : `{ key, name, tag, opggUrl, lastMatchAt, players }`, trié par dernier
  match puis par nom.
- `splitRiotIdInput('Nom#TAG')` renvoie `['Nom', 'TAG']` ; `toOpponentPlayer` et `opponentOpggUrl` donnent les liens.

## 2. API (`window.api`, toutes facultatives, déclarées dans `CalendarApi`)

```ts
calendarSaveMatchEvent?(groupId, event: MatchEventInput, match: MatchInput): Promise<string>   // id du créneau
calendarGetMatchEvent?(calendarEventId): Promise<MatchEventDetail | null>
calendarUpdateMatchDetail?(scrimId, patch: MatchDetailPatch): Promise<void>
calendarListKnownOpponents?(groupId): Promise<KnownOpponent[]>
riotAccountExists?(riotId: 'Nom#TAG', region: 'EUW1' | 'NA1' | ...): Promise<{ exists: boolean; puuid?: string }>
```

- `riotAccountExists` alimente le statut « ✓ trouvé » / « Introuvable » à la sortie du champ Riot ID.
  - Il renvoie `{ exists: false }` si Riot répond 404 (compte inconnu) ou 400 (Riot ID invalide), ou si la valeur
    n'a pas de tag : afficher « Introuvable ».
  - **Toute autre erreur est levée** (limite de débit, hors ligne, session) : afficher « — », pas « Introuvable ».
  - Côté desktop, l'appel passe en priorité interactive. La logique est dans `src/lib/riotAccountCheck.ts`
    (`checkRiotAccount`).

- `MatchEventInput = { id?, kind, title, startsAt, endsAt, notes?, attendeeScope?, attendeeUserIds? }`.
  - Sans `id`, on crée ; avec `id`, on modifie.
  - `attendeeUserIds` = nos 5 joueurs (bloc « Notre roster »). **Si on l'omet lors d'une modification, les invités ne
    changent pas.**
- `MatchInput = { boFormat?, opponent?: { name, tag?, opggUrl?, players?: [{ role, riotId?, region? }] } | null }`.
  - Nom : de 1 à 80 caractères. Tag : 16 caractères au plus (la maquette dit 2 à 5, à contrôler côté écran).
  - Au plus 5 joueurs, un par rôle. Un `riotId` vide est ignoré.
  - `opggUrl` doit être en https et venir de op.gg, blitz.gg, u.gg, porofessor.gg, deeplol.gg, mobalytics.gg ou
    leagueofgraphs.com. Pour remplir les 5 Riot ID depuis un lien collé : `parseMultiGgUrl` (`src/lib/multiGgParser.ts`).
- `MatchDetailPatch = { prepNotes?, reviewNotes?, checklist?: [{ label, done }], draftIds?, status?: 'planned' | 'done' | 'cancelled', opponentRoles?: [{ riotId, role }] }`.
  Seuls les champs envoyés sont modifiés. « Marquer joué » envoie `status: 'done'`, « Annuler » envoie `'cancelled'`.
- `opponentRoles` sert au select de rôle des adversaires dans le panneau (§ 13.2, bloc 3).
  - Envoyer `{ riotId: player.riotId, role }` pour chaque joueur dont le rôle change. Deux joueurs peuvent échanger
    leurs rôles dans le même appel.
  - Seuls les rôles de ces joueurs changent, rien d'autre de l'équipe scoutée. Le Riot ID est comparé sans tenir
    compte de la casse ni des espaces autour.
  - Au plus 5 entrées, chaque rôle et chaque Riot ID une seule fois.
  - Un Riot ID qui n'est pas un joueur de l'adversaire, ou un scrim sans adversaire scouté → `INVALID_DETAIL`, et
    rien n'est écrit.
  - Droit : le même que la préparation (`canEditCalendar || isLegacyStaff`). Recharger avec
    `calendarGetMatchEvent` ensuite.
- Supprimer : `calendarDeleteEvent(eventId)` supprime aussi le scrim, mais garde l'adversaire (CHOIX 3).
- Présence : `calendarRespond(eventId, 'confirmed' | 'declined', note)`, sans changement.
- Erreurs (`MATCH_ERROR_CODES`, à traduire) :
  - `FORBIDDEN` ;
  - `NOT_FOUND` ;
  - `INVALID_KIND` ;
  - `INVALID_EVENT` (dates, titre ou format invalides) ;
  - `INVALID_OPPONENT` (nom, tag, OP.GG ou rôles) ;
  - `INVALID_DETAIL`.

  Toute autre erreur : message générique.

## 3. Droits (pour masquer ou désactiver les boutons)

- **Créer ou modifier un créneau Scrim / Officiel et son adversaire** : `canEditCalendar(role, isCaptain, staffRoles)`
  (owner, coach, manager, capitaine).
- **Préparation, review, statut, drafts liées** : `canEditCalendar(...) || isLegacyStaff(role, staffRoles)`, ce qui
  ajoute l'analyste.
- **Un manager ou un capitaine** complète un adversaire déjà scouté (champs vides, rôles manquants), mais ne modifie
  pas ce qui existe. **Le staff** (owner, coach, analyst) peut le modifier (CHOIX 2). Le serveur applique la règle, et
  l'écran peut l'expliquer.
- Les joueurs voient tout en lecture seule.

## 4. Ce que le Front a à faire

- **Pop-up** (EventPopup), types Scrim et Officiel, selon la maquette § 13.1 :
  - enregistrer via `calendarSaveMatchEvent` ;
  - le select « Équipe connue » utilise `calendarListKnownOpponents` ;
  - retirer le sélecteur « Lier à un scrim existant ».
- **Panneau de détail**, selon la maquette § 13.2 : `calendarGetMatchEvent(event.id)`, puis `calendarUpdateMatchDetail`
  pour la préparation et la review. Le fil de discussion reste `DiscussionThread` avec le sujet `scrim` et l'id
  `scrimId`.
- **Grille** : afficher le badge à partir de `event.match`.
- **Web** : supprimer la route `/scrims` et son entrée de menu ; rediriger `/scrims?scrim=<id>` vers le Planning (le
  créneau est `ScrimSummary.calendarEventId`).
- **`PlanningSection`** : l'export ICS n'a plus besoin d'ajouter les scrims sans créneau. Après la migration, tous en
  ont un ; on peut garder le filtre en attendant.
- **Rien à faire pour le Scouting et le Draft Sim du desktop** : `team:list` importe les adversaires du groupe (au plus
  une fois par minute), et une sauvegarde avec adversaire les importe aussitôt. Un adversaire supprimé localement ne
  revient pas.
- **Desktop** : les 5 lignes de `electron/preload/index.ts` sont déjà en place (Back-end, accord du Chief).
- **Ligne à ajouter dans `web/src/api.ts`** (Front-end), avec
  `import * as matchEvents from '../../src/lib/matchEventCore'` et `import { checkRiotAccount } from '../../src/lib/riotAccountCheck'` :
  ```ts
  calendarSaveMatchEvent: (groupId, event, match) => matchEvents.saveMatchEvent(sb, groupId, event, match),
  calendarGetMatchEvent: (calendarEventId) => matchEvents.getMatchEvent(sb, calendarEventId),
  calendarUpdateMatchDetail: (scrimId, patch) => matchEvents.updateMatchDetail(sb, scrimId, patch),
  calendarListKnownOpponents: (groupId) => matchEvents.listKnownOpponents(sb, groupId),
  riotAccountExists: (riotId, region) => checkRiotAccount((n, t, r) => riotWeb.getAccountByRiotId(n, t, r), riotId, region),
  ```

## 5. Bot (fait)

- Le cron de 15 min annonce un créneau Scrim / Officiel **une seule fois**, sous la forme « Starting soon: Scrim vs KCA
  (BO3) ». Le scrim lié n'est plus annoncé à part.
- `/calendar` liste un match une seule fois.
- `/scrims` retrouve l'adversaire par sa clé (le lien survit aux publications) et affiche « Official » pour un match
  officiel.

## 6. Les 3 choix, confirmés par l'utilisateur le 20/11/2026 (chacun à un seul endroit)

1. **Officiel = kind `tournament`** : `private.match_kind_of` (migration) et `matchKindOf` (matchEvent.ts).
2. **Le capitaine et le manager complètent l'adversaire sans le modifier, le staff le modifie** : `v_may_overwrite`
   dans `save_match_event`.
3. **Supprimer le créneau supprime le scrim et garde l'adversaire** : `on delete cascade` sur
   `scrims.calendar_event_id`. Avec `on delete set null`, on garderait le scrim.
