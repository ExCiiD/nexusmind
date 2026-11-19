# #49 — Les scrims dans le Planning (proposition Back-end, sans code)

Back-end, 20/11/2026. Demande de l'utilisateur relayée par le Chief : supprimer la page Scrims et planifier les
scrims depuis le Planning. Le pop-up « nouveau créneau » propose le type Scrim ou Officiel, avec l'équipe adverse,
ses 5 joueurs, leurs rôles et l'OP.GG. Un clic sur le créneau ouvre le détail du scrim. Une équipe adverse saisie
dans un scrim apparaît dans Coaching → Scouting et comme adversaire du Draft Sim.

Graphic Design fait la maquette en parallèle. Ce document fixe le modèle, les droits et le contrat.

---

## 0. Ce qu'il faut savoir avant de commencer

**Dérive de schéma.** La production contient des colonnes qu'aucune migration du dépôt ne crée.
Elles viennent des migrations e14, e2v2, e4v2, e7v2, e9v2, e11v2, e6v2 et phase1 à phase5, appliquées en
production mais absentes de `supabase/migrations/` :

| Table | Colonnes présentes en production seulement |
|---|---|
| `scrims` | `bo_format` ('bo1', 'bo3', 'bo5'), `opponent_scouting_id` → `team_scouting` (on delete set null), `low_availability_notified` |
| `calendar_events` | `linked_scrim_id` → `scrims` (on delete set null), `attendee_scope` |
| `team_rosters` | `scouting_id` → `team_scouting` (on delete cascade), et des rôles `TOP, JUNGLE, MID, ADC, SUPPORT` (le dépôt dit `UTILITY`, `MIDDLE`, `BOTTOM`) |

Avant d'écrire la migration #49, il faut **rapatrier ces définitions dans le dépôt** : une migration
« baseline » lue en production, comme pour les trois fonctions run_* de la 280000. Sinon les tests PGlite tournent sur
un schéma faux.

**Données.** Au 20/11/2026, la production a 0 scrim, 0 disponibilité, 0 équipe scoutée et 5 événements de
calendrier dans 2 groupes. La migration des scrims existants n'a donc presque rien à déplacer, mais elle doit rester
correcte pour une base qui en aurait.

---

## 1. Le modèle actuel

### Serveur (Supabase)

- **`calendar_events`** : un créneau du Planning (`kind` parmi tournament, team_review, one_on_one, soloq_block, rest,
  other, scrim, flex, meeting, warmup_draft).
  - Il porte `linked_scrim_id` et `attendee_scope`, avec des invités dans `calendar_event_attendees`.
  - Écriture : `can_edit_calendar` (owner, coach, manager, capitaine, plus les staff_roles depuis la 280000).
    Lecture : tous les membres.
  - Trigger `auto_create_team_session` : un créneau scrim, flex, tournament ou meeting crée sa séance d'équipe.
- **`scrims`** : le détail d'un scrim.
  - Champs : title, opponent (texte libre), scheduled_at, duration_min, status, bo_format, prep_notes, checklist,
    draft_ids (ids de DraftPrep), review_notes, opponent_scouting_id, plus les drapeaux de rappel.
  - Écriture : `is_group_staff` (owner, coach, analyst). **Ce n'est pas le même groupe que le calendrier** : un
    manager ou un capitaine peut créer le créneau, mais pas le scrim.
  - Triggers `notify_scrim_created` et `notify_scrim_updated`. Jobs pg_cron `scrim-reminders` (toutes les 15 min)
    et `scrim-availability-check` (toutes les heures).
- **`scrim_availability`** : la réponse oui / peut-être / non de chaque membre à un scrim.
- **`team_scouting`** (équipe adverse : name, tag, scout_notes) et **`team_rosters`** avec `scouting_id` (ses joueurs :
  ign, tag_line, region, role).
  - Écriture : `is_group_staff`.
  - **C'est un instantané** : `publishTeam` (bouton « publier dans le groupe » du desktop) **supprime toutes les
    lignes `team_scouting` du groupe** puis les réinsère depuis le desktop. Les id changent à chaque publication, et
    `scrims.opponent_scouting_id` repasse à null (on delete set null).
- **`opponent_dossiers`** et **`draft_log`** (#40, migration 290000 pas encore en production) : les adversaires y
  sont identifiés par `opponent_key` (`opponentKeyOf` : nom sans espaces en trop, en minuscules), précisément parce
  que les id de `team_scouting` ne sont pas stables.

### Desktop (SQLite / Prisma)

- **Coaching → Scouting** et le sélecteur « vs » du **Draft Sim** lisent les `Team` **locales** avec
  `isOpponent = true` et `groupId` (`window.api.listTeams({ isOpponent, groupId, includeUnassigned })`). Le desktop
  ne lit jamais `team_scouting`.
- `DraftPrep.vsTeamId` pointe vers une `Team` locale.
- Le desktop n'a pas de page Scrims. Il lit les scrims en lecture seule (`scrimsListForGroup`) pour :
  - le sélecteur « lier à un scrim » d'EventPopup ;
  - VodReviewSection ;
  - l'export ICS de PlanningSection, qui ajoute les scrims sans créneau.

### Web

- La page `/scrims` (`web/src/pages/ScrimsPage.tsx`, `web/src/scrims.ts`) fait tout : création, disponibilités,
  checklist, notes de prépa et de review, drafts liés.
- La page `/team` lit le scouting publié (`getSharedTeam`).

### Bot Discord

- `/scrims` : les 5 prochains scrims, avec l'OP.GG de chaque adversaire lu dans le roster de
  `team_scouting` par `opponent_scouting_id`, et notre lineup.
- Le cron de 15 min annonce séparément les événements **et** les scrims qui commencent bientôt.
- `/away` liste les scrims manqués.

---

## 2. Le modèle proposé

### 2.1 Le créneau est la source, le scrim est son détail

Un scrim ou un match officiel est **un créneau `calendar_events`** de kind `scrim` ou `tournament`. « Officiel »
reprend le kind `tournament` existant : pas de nouveau kind, donc pas de changement dans auto_create_team_session,
l'ICS ou le bot. Chaque créneau de ce type a **une ligne `scrims`** qui porte le détail.

Lien : on ajoute **`scrims.calendar_event_id uuid unique references calendar_events on delete cascade`**.

- Supprimer le créneau supprime le scrim, ses disponibilités et ses rappels. Avec `linked_scrim_id` dans l'autre sens,
  ce n'est pas possible : la suppression laisserait un scrim orphelin.
- L'unicité garantit au plus un scrim par créneau.
- `scheduled_at` et `duration_min` deviennent des copies du créneau. Un trigger
  `calendar_events → scrims` les recopie à chaque modification de l'heure, pour que les rappels, la vérification des
  dispos, le bot et les anciennes versions de l'app restent justes.
- `calendar_events.linked_scrim_id` reste rempli, avec la même valeur, pendant la transition, pour les apps déjà
  installées. On le retire dans une migration ultérieure.
- Nouvelle colonne `scrims.kind` ('scrim', 'official'), recopiée du kind du créneau, pour l'affichage et le bot.

### 2.2 L'adversaire, identifié par sa clé et non par son id

On ajoute **`scrims.opponent_key text`**, la même clé que `opponent_dossiers` et `draft_log` (`opponentKeyOf`).
Un scrim désigne son adversaire par `(group_id, opponent_key)` : le lien survit aux publications, contrairement à
`opponent_scouting_id`.

Dans `team_scouting` :

- `opponent_key text not null`, avec un index unique `(group_id, opponent_key)`. Rempli par la migration depuis
  `name`.
- `source text not null default 'publish'` : 'publish' (vient du desktop) ou 'match' (créé depuis un créneau).
- `opgg_url text` (facultatif) : le lien OP.GG multisearch collé par le staff. Sans lui, on le calcule à partir des
  5 Riot ID.

`opponent_scouting_id` reste rempli, comme lien de commodité recalculé à chaque enregistrement, pour le bot actuel et
les anciennes versions.

### 2.3 Création ou réutilisation automatique de l'adversaire

À l'enregistrement d'un créneau Scrim ou Officiel avec un adversaire :

1. `key = opponentKeyOf(nom)`.
2. S'il existe une ligne `team_scouting (group_id, key)`, on la **réutilise**. On complète seulement ce qui
   manque : joueurs absents, Riot ID vides, `opgg_url` vide. **On n'écrase jamais** ce que le scouting contient
   déjà : les notes et le roster restent ceux du scout.
3. Sinon, on la **crée** avec `source = 'match'`, plus ses joueurs dans `team_rosters` (`scouting_id`, ign, tag_line,
   region, role parmi `TOP, JUNGLE, MID, ADC, SUPPORT`, status `starter`).
4. On écrit `scrims.opponent_key = key`, `opponent = nom` (pour l'affichage et les anciennes versions) et
   `opponent_scouting_id`.

Tout se fait dans **une seule RPC `security definer`** (§ 4), pour être atomique et pour que la règle de droits soit
celle du calendrier (§ 3).

### 2.4 La publication du desktop ne doit plus effacer ces adversaires

`publishTeam` devient une **mise à jour par clé** au lieu de « tout supprimer, tout réinsérer » :

- Chaque équipe adverse publiée fait un upsert sur `(group_id, opponent_key)`. Son roster est remplacé : le desktop
  fait autorité pour les adversaires qu'il connaît.
- Les lignes `source = 'publish'` absentes de la nouvelle publication sont supprimées, comme aujourd'hui.
- Les lignes **`source = 'match'` ne sont jamais supprimées** par une publication. Si le desktop publie une équipe de
  même clé, elle passe à `source = 'publish'` et son contenu l'emporte.
- Conséquence voulue : les id sont maintenant stables, ce qui règle aussi le problème signalé dans `analyst.ts`.

Comme une fonction de publication côté serveur demanderait plus de travail, c'est `teamCore.publishTeam` qui change
(Back-end). Il n'y a pas de RPC de publication aujourd'hui.

### 2.5 Faire apparaître l'adversaire dans le desktop (Scouting et Draft Sim)

Le desktop lit des `Team` locales. Il faut donc une **importation** :

- `importGroupOpponents(groupId)` dans le process main, appelée à l'ouverture de Coaching → Scouting, au chargement
  des adversaires du Draft Sim, et au rafraîchissement des groupes.
- Elle lit `team_scouting` (et son roster) du groupe. Pour chaque ligne :
  - si une `Team` locale `isOpponent` du même groupe a la même clé `opponentKeyOf(name)`, on la complète (joueurs
    manquants seulement) ;
  - sinon, on crée la `Team` locale `isOpponent = true, groupId`, avec ses `TeamMember`.
- Le contenu local n'est jamais écrasé. Une équipe supprimée localement mais toujours présente au serveur
  reviendrait : on note donc les clés écartées par l'utilisateur dans une table locale `DismissedOpponent (groupId,
  opponentKey)`.
- Sur le web, rien à faire : `/team` lit déjà `team_scouting`, et les adversaires créés depuis un créneau y
  apparaissent dès que la publication ne les efface plus.

### 2.6 Rôles

Le pop-up utilise les rôles de `team_rosters` en production : `TOP, JUNGLE, MID, ADC, SUPPORT`. Ce sont aussi les
rôles locaux (`TeamRole`, voir `isTeamRole` dans `electron/main/cloud/teamShare.ts`), donc l'import ne convertit
rien. Seul le dépôt (migration e1, `UTILITY`, `MIDDLE`, `BOTTOM`) est en retard : la baseline du § 0 le corrige.

---

## 3. Droits

| Action | Qui | Contrôle |
|---|---|---|
| Voir les créneaux, le détail d'un scrim, l'adversaire | Tous les membres | Inchangé (RLS en lecture) |
| Créer, modifier ou supprimer un créneau Scrim ou Officiel, avec son adversaire | **owner, coach, manager, capitaine** (et leurs staff_roles) | `can_edit_calendar`, dans la RPC |
| Notes de prépa et de review, checklist, drafts liés | Mêmes personnes **plus analyst** | `can_edit_calendar or is_group_staff` |
| Répondre à sa disponibilité | Chaque membre, pour lui-même | Inchangé |
| Modifier le scouting directement (pas depuis un créneau) | owner, coach, analyst | `is_group_staff`, inchangé |

La RPC tourne en `security definer` : un manager ou un capitaine peut créer l'adversaire **depuis un créneau**
même s'il n'a pas le droit d'éditer le scouting. Il ne peut que créer, ou compléter ce qui est vide, jamais
modifier ou supprimer une équipe existante. Les politiques RLS de `scrims` passent de `is_group_staff` à
`can_edit_calendar or is_group_staff`, pour que les deux populations aient les mêmes droits partout.

---

## 4. Contrat Back-end (RPC et types)

### RPC `public.save_match_event(p_group uuid, p_event jsonb, p_match jsonb) returns uuid`

Renvoie l'id du créneau. Elle crée le créneau si `p_event.id` est absent, le modifie sinon. Contrôle :
`can_edit_calendar(p_group)`, sinon FORBIDDEN.

```
p_event: { id?, kind: 'scrim' | 'tournament', title, startsAt, endsAt, notes?, attendeeScope?, attendeeUserIds? }
p_match: {
  boFormat?: 'bo1' | 'bo3' | 'bo5' | null,
  opponent?: {                       // null : scrim sans adversaire connu
    name: string,                    // 1 à 80 caractères, la clé en est dérivée
    tag?: string | null,
    opggUrl?: string | null,         // https://op.gg/... uniquement (vérifié)
    players: Array<{ role: 'TOP'|'JUNGLE'|'MID'|'ADC'|'SUPPORT', riotId: string | null, region?: string | null }>  // 0 à 5, au plus un par rôle
  } | null
}
```

Erreurs : FORBIDDEN, INVALID_KIND, INVALID_OPPONENT (nom vide ou trop long, rôle en double, plus de 5 joueurs, OP.GG
qui n'est pas op.gg), NOT_FOUND (créneau d'un autre groupe).

### Lecture : `getMatchEvent(groupId, calendarEventId) → MatchEventDetail`

```ts
interface MatchEventDetail {
  event: CalendarEvent                 // kind 'scrim' | 'tournament'
  scrimId: string
  kind: 'scrim' | 'official'
  boFormat: 'bo1' | 'bo3' | 'bo5' | null
  status: 'planned' | 'done' | 'cancelled'
  opponent: null | {
    key: string; name: string; tag: string | null; opggUrl: string | null   // opggUrl calculé si absent
    players: Array<{ role: 'TOP'|'JUNGLE'|'MID'|'ADC'|'SUPPORT'; riotId: string | null; region: string | null; opggUrl: string | null }>
    hasDossier: boolean                // un dossier #40 publié existe pour cette clé
  }
  prepNotes: string | null; reviewNotes: string | null
  checklist: Array<{ label: string; done: boolean }>
  draftIds: string[]
  availability: Array<{ userId: string; status: 'yes' | 'maybe' | 'no'; comment: string | null }>
}
```

Le reste de l'édition passe par une RPC, avec le même contrôle de droits :
`updateMatchDetail(scrimId, patch: { prepNotes?, reviewNotes?, checklist?, draftIds?, status? })`, et la
disponibilité garde sa fonction actuelle.

API renderer (`src/lib/calendar.ts`, desktop et web, les deux facultatives comme les autres nouveautés) :

```ts
calendarSaveMatchEvent?: (groupId: string, event: MatchEventInput, match: MatchInput) => Promise<string>
calendarGetMatchEvent?: (groupId: string, calendarEventId: string) => Promise<MatchEventDetail>
calendarUpdateMatchDetail?: (groupId: string, scrimId: string, patch: MatchDetailPatch) => Promise<void>
calendarSetMatchAvailability?: (scrimId: string, status: 'yes' | 'maybe' | 'no', comment: string | null) => Promise<void>
```

`CalendarEvent` reçoit en plus `match?: { scrimId: string; opponentName: string | null; boFormat: string | null }`,
pour que la grille affiche « vs X — BO3 » sans charger le détail.

---

## 5. Contrat Front-end (pop-up et détail)

- **Pop-up « nouveau créneau »** (EventPopup), types Scrim et Officiel :
  - champs titre, heure, durée et invités, comme aujourd'hui ;
  - format BO1, BO3 ou BO5 ;
  - adversaire : nom avec autocomplétion sur les adversaires connus du groupe (`team_scouting` et les dossiers). Un
    nom connu préremplit le tag, l'OP.GG et les 5 joueurs, qui restent modifiables mais ne complètent que les
    champs vides côté serveur ;
  - 5 lignes rôle et Riot ID (`Nom#TAG`), avec la région par défaut du groupe ;
  - OP.GG : un lien multisearch facultatif à coller. Sinon il est calculé ;
  - enregistrement : `calendarSaveMatchEvent`.
  - Le sélecteur « lier à un scrim existant » disparaît.
- **Clic sur un créneau Scrim ou Officiel** : le panneau de détail (`calendarGetMatchEvent`) montre
  - l'adversaire, ses 5 joueurs avec leur lien OP.GG, le lien multisearch, et un lien vers son dossier (#40) s'il
    existe ;
  - les disponibilités, avec ma réponse modifiable ;
  - les notes de prépa, la checklist et les drafts liés, en lecture pour les joueurs et modifiables pour les rôles du
    § 3 ;
  - la review après le match ;
  - « Lancer la séance » (séance d'équipe existante).
- **Grille** : le badge « vs X · BO3 » lu dans `event.match`.
- **Suppression de la page Scrims (web)** :
  - retirer la route `/scrims` et l'entrée de menu ;
  - rediriger `/scrims` vers `/coaching` (onglet Planning) ;
  - les liens de notification `/scrims` pointent vers le créneau.
- **Desktop** : PlanningSection n'a plus besoin d'ajouter les scrims sans créneau à l'export ICS, car tous les scrims
  auront leur créneau. VodReviewSection garde son sélecteur de scrims : les id de `scrims` ne changent pas.
- **Rien à faire côté Front** pour le Scouting et le Draft Sim : l'import du § 2.5 est côté Back-end (process main).

---

## 6. Migration des scrims existants

Dans la même migration, après les nouvelles colonnes :

1. Pour chaque scrim sans `calendar_event_id`, on cherche d'abord un créneau qui le désigne déjà par
   `linked_scrim_id`. S'il y en a un, on l'adopte.
2. Sinon, on crée le créneau : kind `scrim`, title, `starts_at = scheduled_at`,
   `ends_at = scheduled_at + duration_min`, `attendee_scope = 'whole_team'`, `created_by` du scrim.
   - Le trigger `auto_create_team_session` va se déclencher. Pour les scrims passés, il ne faut pas créer de séance :
     on le désactive le temps du backfill (`alter table ... disable trigger`, puis `enable`), et on ne crée de séance
     que pour les scrims à venir.
3. On remplit `opponent_key` depuis `opponent` (texte libre) quand il existe. Si un scouting de même clé existe, on
   remplit aussi `opponent_scouting_id`. **On ne crée pas d'équipe scoutée** pour un ancien scrim qui n'avait qu'un nom.
4. On remplit `team_scouting.opponent_key` depuis `name`. En cas de doublon de clé dans un groupe, on garde la ligne
   la plus récente et on rattache les rosters des autres, avant de poser l'index unique.

En production aujourd'hui : 0 scrim et 0 équipe scoutée, donc aucune donnée à déplacer. Le backfill reste testé sur
PGlite avec des cas fabriqués : scrim avec et sans créneau, avec et sans adversaire, doublons de clé. Un script de
retour arrière est écrit avant l'application, comme pour la 280000.

---

## 7. Desktop, web, bot

- **Anciennes versions de l'app** (sans le pop-up) : elles lisent toujours `scrims` et `linked_scrim_id`, qui restent
  remplis. Elles ne peuvent plus créer de scrim que par l'ancienne page web, qui disparaît. Rien ne casse.
- **Bot** :
  - `/scrims` lit les créneaux `scrim` et `tournament` à venir, joints à leur scrim. L'OP.GG vient du roster de
    l'adversaire par `(group_id, opponent_key)` (ou `opgg_url`), plus `opponent_scouting_id`. Les matchs officiels y
    apparaissent avec la mention « Official ».
  - Le cron de 15 min annonce aujourd'hui les événements et les scrims : **un scrim devenu créneau serait annoncé deux
    fois**. On n'annonce plus que les événements, et le message d'un créneau Scrim ou Officiel reprend « vs X — BO3 ».
  - `/away` lit les créneaux plutôt que les scrims.
- **Notifications** : `notify_scrim_created` et `notify_scrim_updated` restent sur `scrims`. Le calendrier n'a pas de
  notification propre, donc pas de doublon. Le lien des notifications passe de `/scrims` au créneau.
- **Rappels et dispos** (`run_scrim_reminders`, `run_scrim_availability_check`) : inchangés, ils lisent
  `scrims.scheduled_at`, tenu à jour par le trigger du § 2.1.

---

## 8. Découpage proposé

1. Back-end : migration baseline (rapatrier la dérive du § 0) et tests PGlite.
2. Back-end : migration #49 (colonnes, index, trigger de recopie, RPC, RLS, backfill), rollback, tests PGlite.
3. Back-end : `publishTeam` par clé, `importGroupOpponents` (desktop), API `calendar*Match*`, le bot.
4. Front-end : pop-up, détail, badge de grille, suppression de `/scrims` (sur la maquette de Graphic Design).
5. Audit, puis production avec l'accord de l'utilisateur.

## 9. Questions ouvertes (à l'utilisateur, via le Chief)

1. « Officiel » réutilise le kind `tournament` (affiché « Officiel ») : d'accord ?
2. Le capitaine et le manager peuvent créer un adversaire depuis un créneau, mais pas modifier une équipe déjà
   scoutée. D'accord ?
3. Supprimer un créneau supprime le scrim, ses disponibilités et ses notes. L'adversaire reste dans le scouting.
   D'accord ?
