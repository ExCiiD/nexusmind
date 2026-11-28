# Supabase : performance advisor, migration `20261128120000_rls_performance` (28/11/2026)

Généré par `scripts/gen-rls-perf-migration.mjs` à partir des politiques de production du 28/11 (copiées telles quelles).
**Non appliquée.** Revue Cyber, puis production seulement sur accord explicite de l'utilisateur.

## Principe : mêmes accès

- Postgres combine les politiques *permissive* d'une même commande par **OU** (USING avec USING, WITH CHECK avec
  WITH CHECK). Une politique `ALL` équivaut exactement à SELECT + INSERT + UPDATE + DELETE avec les mêmes
  expressions (pour INSERT et UPDATE, le WITH CHECK, ou le USING s'il n'y en a pas).
- Donc chaque politique en doublon est découpée par commande, et les morceaux d'une même commande sont réunis
  par OU dans **une** politique : mêmes lignes lisibles, mêmes lignes modifiables, mêmes contrôles à l'écriture.
- Les politiques fusionnées visent `authenticated`. Certaines d'origine visaient `public` (donc aussi `anon`),
  mais toutes leurs expressions exigent une ligne liée à `auth.uid()` (`private.group_role`, `is_group_staff`,
  `can_edit_calendar`, `can_manage_session`, `can_prepare_session` filtrent `group_members` sur
  `user_id = auth.uid()`, ou la colonne utilisateur de la ligne = `auth.uid()`). Pour `anon`, `auth.uid()`
  vaut NULL : `anon` n'a jamais eu d'accès par elles. Point à confirmer par Cyber.
- `auth.uid()` devient `(select auth.uid())` partout (évalué une fois par requête au lieu d'une fois par ligne).

## Politiques fusionnées (multiple_permissive_policies, 45 alertes sur 31 tables)

| Table | Avant | Après |
|---|---|---|
| `announcements` | `announcements_read` SELECT → authenticated<br>`announcements_write` ALL → public | `announcements_select` (announcements_read + announcements_write)<br>`announcements_insert` (announcements_write)<br>`announcements_update` (announcements_write)<br>`announcements_delete` (announcements_write) → authenticated |
| `availability_exceptions` | `availability_exceptions_read` SELECT → authenticated<br>`availability_exceptions_write` ALL → public | `availability_exceptions_select` (availability_exceptions_read + availability_exceptions_write)<br>`availability_exceptions_insert` (availability_exceptions_write)<br>`availability_exceptions_update` (availability_exceptions_write)<br>`availability_exceptions_delete` (availability_exceptions_write) → authenticated |
| `availability_rules` | `availability_rules_read` SELECT → authenticated<br>`availability_rules_write` ALL → public | `availability_rules_select` (availability_rules_read + availability_rules_write)<br>`availability_rules_insert` (availability_rules_write)<br>`availability_rules_update` (availability_rules_write)<br>`availability_rules_delete` (availability_rules_write) → authenticated |
| `calendar_event_attendees` | `calendar_event_attendees_read` SELECT → public<br>`calendar_event_attendees_write` ALL → public | `calendar_event_attendees_select` (calendar_event_attendees_read + calendar_event_attendees_write)<br>`calendar_event_attendees_insert` (calendar_event_attendees_write)<br>`calendar_event_attendees_update` (calendar_event_attendees_write)<br>`calendar_event_attendees_delete` (calendar_event_attendees_write) → authenticated |
| `calendar_events` | `calendar_events_read` SELECT → authenticated<br>`calendar_events_write` ALL → public | `calendar_events_select` (calendar_events_read + calendar_events_write)<br>`calendar_events_insert` (calendar_events_write)<br>`calendar_events_update` (calendar_events_write)<br>`calendar_events_delete` (calendar_events_write) → authenticated |
| `dev_plan_axes` | `dev_plan_axes_read` SELECT → authenticated<br>`dev_plan_axes_write_staff` ALL → authenticated | `dev_plan_axes_select` (dev_plan_axes_read + dev_plan_axes_write_staff)<br>`dev_plan_axes_insert` (dev_plan_axes_write_staff)<br>`dev_plan_axes_update` (dev_plan_axes_write_staff)<br>`dev_plan_axes_delete` (dev_plan_axes_write_staff) → authenticated |
| `dev_plan_checkins` | `dev_plan_checkins_read` SELECT → authenticated<br>`dev_plan_checkins_write_staff` ALL → authenticated | `dev_plan_checkins_select` (dev_plan_checkins_read + dev_plan_checkins_write_staff)<br>`dev_plan_checkins_insert` (dev_plan_checkins_write_staff)<br>`dev_plan_checkins_update` (dev_plan_checkins_write_staff)<br>`dev_plan_checkins_delete` (dev_plan_checkins_write_staff) → authenticated |
| `dev_plan_progress` | `dev_plan_progress_read` SELECT → authenticated<br>`dev_plan_progress_write_own` ALL → authenticated | `dev_plan_progress_select` (dev_plan_progress_read + dev_plan_progress_write_own)<br>`dev_plan_progress_insert` (dev_plan_progress_write_own)<br>`dev_plan_progress_update` (dev_plan_progress_write_own)<br>`dev_plan_progress_delete` (dev_plan_progress_write_own) → authenticated |
| `dev_plans` | `dev_plans_read` SELECT → authenticated<br>`dev_plans_write_staff` ALL → authenticated | `dev_plans_select` (dev_plans_read + dev_plans_write_staff)<br>`dev_plans_insert` (dev_plans_write_staff)<br>`dev_plans_update` (dev_plans_write_staff)<br>`dev_plans_delete` (dev_plans_write_staff) → authenticated |
| `discord_guild_links` | `discord_guild_links_read` SELECT → authenticated<br>`discord_guild_links_write_staff` ALL → authenticated | `discord_guild_links_select` (discord_guild_links_read + discord_guild_links_write_staff)<br>`discord_guild_links_insert` (discord_guild_links_write_staff)<br>`discord_guild_links_update` (discord_guild_links_write_staff)<br>`discord_guild_links_delete` (discord_guild_links_write_staff) → authenticated |
| `group_fundamentals` | `group_fundamentals_read` SELECT → public<br>`group_fundamentals_write` ALL → public | `group_fundamentals_select` (group_fundamentals_read + group_fundamentals_write)<br>`group_fundamentals_insert` (group_fundamentals_write)<br>`group_fundamentals_update` (group_fundamentals_write)<br>`group_fundamentals_delete` (group_fundamentals_write) → authenticated |
| `group_sharing` | `sharing_own_rows` ALL → authenticated<br>`sharing_staff_read` SELECT → authenticated | `group_sharing_select` (sharing_own_rows + sharing_staff_read)<br>`group_sharing_insert` (sharing_own_rows)<br>`group_sharing_update` (sharing_own_rows)<br>`group_sharing_delete` (sharing_own_rows) → authenticated |
| `scrim_availability` | `availability_read_members` SELECT → authenticated<br>`availability_write_own` ALL → authenticated | `scrim_availability_select` (availability_read_members + availability_write_own)<br>`scrim_availability_insert` (availability_write_own)<br>`scrim_availability_update` (availability_write_own)<br>`scrim_availability_delete` (availability_write_own) → authenticated |
| `staff_notes` | `staff_notes_read_staff` SELECT → authenticated<br>`staff_notes_write_staff` ALL → authenticated | `staff_notes_select` (staff_notes_read_staff + staff_notes_write_staff)<br>`staff_notes_insert` (staff_notes_write_staff)<br>`staff_notes_update` (staff_notes_write_staff)<br>`staff_notes_delete` (staff_notes_write_staff) → authenticated |
| `tasks` | `tasks_read` SELECT → authenticated<br>`tasks_write_staff` ALL → authenticated<br>`tasks_update_own_assignment` UPDATE → authenticated | `tasks_select` (tasks_read + tasks_write_staff)<br>`tasks_insert` (tasks_write_staff)<br>`tasks_update` (tasks_write_staff + tasks_update_own_assignment)<br>`tasks_delete` (tasks_write_staff) → authenticated |
| `team_codex_rules` | `team_codex_read` SELECT → authenticated<br>`team_codex_write_staff` ALL → authenticated | `team_codex_rules_select` (team_codex_read + team_codex_write_staff)<br>`team_codex_rules_insert` (team_codex_write_staff)<br>`team_codex_rules_update` (team_codex_write_staff)<br>`team_codex_rules_delete` (team_codex_write_staff) → authenticated |
| `team_custom_games` | `team_custom_games_read` SELECT → authenticated<br>`team_custom_games_write_staff` ALL → authenticated | `team_custom_games_select` (team_custom_games_read + team_custom_games_write_staff)<br>`team_custom_games_insert` (team_custom_games_write_staff)<br>`team_custom_games_update` (team_custom_games_write_staff)<br>`team_custom_games_delete` (team_custom_games_write_staff) → authenticated |
| `team_drafts` | `team_drafts_read` SELECT → authenticated<br>`team_drafts_write_staff` ALL → authenticated | `team_drafts_select` (team_drafts_read + team_drafts_write_staff)<br>`team_drafts_insert` (team_drafts_write_staff)<br>`team_drafts_update` (team_drafts_write_staff)<br>`team_drafts_delete` (team_drafts_write_staff) → authenticated |
| `team_pool_entries` | `team_pool_read` SELECT → authenticated<br>`team_pool_write` ALL → authenticated | `team_pool_entries_select` (team_pool_read + team_pool_write)<br>`team_pool_entries_insert` (team_pool_write)<br>`team_pool_entries_update` (team_pool_write)<br>`team_pool_entries_delete` (team_pool_write) → authenticated |
| `team_rosters` | `team_rosters_read` SELECT → authenticated<br>`team_rosters_write_staff` ALL → authenticated | `team_rosters_select` (team_rosters_read + team_rosters_write_staff)<br>`team_rosters_insert` (team_rosters_write_staff)<br>`team_rosters_update` (team_rosters_write_staff)<br>`team_rosters_delete` (team_rosters_write_staff) → authenticated |
| `team_scouting` | `team_scouting_read` SELECT → authenticated<br>`team_scouting_write_staff` ALL → authenticated | `team_scouting_select` (team_scouting_read + team_scouting_write_staff)<br>`team_scouting_insert` (team_scouting_write_staff)<br>`team_scouting_update` (team_scouting_write_staff)<br>`team_scouting_delete` (team_scouting_write_staff) → authenticated |
| `team_session_attendance` | `team_session_attendance_read` SELECT → authenticated<br>`team_session_attendance_write` ALL → authenticated | `team_session_attendance_select` (team_session_attendance_read + team_session_attendance_write)<br>`team_session_attendance_insert` (team_session_attendance_write)<br>`team_session_attendance_update` (team_session_attendance_write)<br>`team_session_attendance_delete` (team_session_attendance_write) → authenticated |
| `team_session_drafts` | `team_session_drafts_read` SELECT → authenticated<br>`team_session_drafts_write` ALL → authenticated | `team_session_drafts_select` (team_session_drafts_read + team_session_drafts_write)<br>`team_session_drafts_insert` (team_session_drafts_write)<br>`team_session_drafts_update` (team_session_drafts_write)<br>`team_session_drafts_delete` (team_session_drafts_write) → authenticated |
| `team_session_objectives` | `team_session_objectives_read` SELECT → public<br>`team_session_objectives_write` ALL → public | `team_session_objectives_select` (team_session_objectives_read + team_session_objectives_write)<br>`team_session_objectives_insert` (team_session_objectives_write)<br>`team_session_objectives_update` (team_session_objectives_write)<br>`team_session_objectives_delete` (team_session_objectives_write) → authenticated |
| `team_session_player_objectives` | `team_session_player_objectives_read` SELECT → authenticated<br>`team_session_player_objectives_write` ALL → authenticated | `team_session_player_objectives_select` (team_session_player_objectives_read + team_session_player_objectives_write)<br>`team_session_player_objectives_insert` (team_session_player_objectives_write)<br>`team_session_player_objectives_update` (team_session_player_objectives_write)<br>`team_session_player_objectives_delete` (team_session_player_objectives_write) → authenticated |
| `team_session_prep_notes` | `team_session_prep_notes_read` SELECT → authenticated<br>`team_session_prep_notes_write` ALL → authenticated | `team_session_prep_notes_select` (team_session_prep_notes_read + team_session_prep_notes_write)<br>`team_session_prep_notes_insert` (team_session_prep_notes_write)<br>`team_session_prep_notes_update` (team_session_prep_notes_write)<br>`team_session_prep_notes_delete` (team_session_prep_notes_write) → authenticated |
| `team_session_reviews` | `team_session_reviews_read` SELECT → public<br>`team_session_reviews_write` ALL → public | `team_session_reviews_select` (team_session_reviews_read + team_session_reviews_write)<br>`team_session_reviews_insert` (team_session_reviews_write)<br>`team_session_reviews_update` (team_session_reviews_write)<br>`team_session_reviews_delete` (team_session_reviews_write) → authenticated |
| `vod_review_assignments` | `vod_assignments_read` SELECT → authenticated<br>`vod_assignments_write_staff` ALL → authenticated<br>`vod_assignments_update_own_status` UPDATE → authenticated | `vod_review_assignments_select` (vod_assignments_read + vod_assignments_write_staff)<br>`vod_review_assignments_insert` (vod_assignments_write_staff)<br>`vod_review_assignments_update` (vod_assignments_write_staff + vod_assignments_update_own_status)<br>`vod_review_assignments_delete` (vod_assignments_write_staff) → authenticated |
| `vod_review_sessions` | `vod_sessions_read` SELECT → authenticated<br>`vod_sessions_write_staff` ALL → authenticated | `vod_review_sessions_select` (vod_sessions_read + vod_sessions_write_staff)<br>`vod_review_sessions_insert` (vod_sessions_write_staff)<br>`vod_review_sessions_update` (vod_sessions_write_staff)<br>`vod_review_sessions_delete` (vod_sessions_write_staff) → authenticated |
| `sync_records` | `sync_records_read_shared` SELECT → authenticated<br>`sync_records_select_own` SELECT → authenticated | `sync_records_select` (sync_records_read_shared + sync_records_select_own) → authenticated |
| `micro_review_verdicts` | `micro_verdicts_delete_orphaned` DELETE → authenticated<br>`micro_verdicts_delete_own` DELETE → authenticated | `micro_review_verdicts_delete` (micro_verdicts_delete_orphaned + micro_verdicts_delete_own) → authenticated |

## auth.uid() en initplan (auth_rls_initplan, 18 alertes)

Les politiques `availability_rules_write` et `availability_exceptions_write` sont traitées par la fusion ci-dessus.

| Table | Politique (inchangée sauf l'expression) | Après |
|---|---|---|
| `team_discussion_comments` | `team_discussion_insert` INSERT → public | same, `(select auth.uid())` |
| `team_discussion_comments` | `team_discussion_delete` DELETE → public | same, `(select auth.uid())` |
| `calendar_event_requests` | `calendar_event_requests_insert` INSERT → public | same, `(select auth.uid())` |
| `calendar_event_requests` | `calendar_event_requests_read` SELECT → public | same, `(select auth.uid())` |
| `calendar_event_requests` | `calendar_event_requests_delete` DELETE → public | same, `(select auth.uid())` |
| `announcement_dismissals` | `announcement_dismissals_own` ALL → public | same, `(select auth.uid())` |
| `team_session_feedback` | `team_session_feedback_write` INSERT → public | same, `(select auth.uid())` |
| `team_session_feedback` | `team_session_feedback_update` UPDATE → public | same, `(select auth.uid())` |
| `micro_review_answers` | `micro_answers_read` SELECT → authenticated | same, `(select auth.uid())` |
| `micro_review_answers` | `micro_answers_insert_own` INSERT → authenticated | same, `(select auth.uid())` |
| `micro_review_answers` | `micro_answers_update_own` UPDATE → authenticated | same, `(select auth.uid())` |
| `micro_review_answers` | `micro_answers_delete_own` DELETE → authenticated | same, `(select auth.uid())` |
| `micro_review_verdicts` | `micro_verdicts_read` SELECT → authenticated | same, `(select auth.uid())` |
| `micro_review_verdicts` | `micro_verdicts_write_staff` INSERT → authenticated | same, `(select auth.uid())` |
| `micro_review_verdicts` | `micro_verdicts_update_own` UPDATE → authenticated | same, `(select auth.uid())` |

## Index

- **70 index** de clés étrangères (`<table>_<colonne>_fk_idx`) : accélèrent les `ON DELETE` en
  cascade et les jointures. Base de 23 Mo : création instantanée, quelques centaines de Ko au total.
- **9 index « inutilisés » gardés** : l'app a quelques semaines et peu de trafic sur ces écrans ; la plupart
  couvrent une clé étrangère, les supprimer ferait revenir l'alerte `unindexed_foreign_keys`.

## Hors migration

- `auth_db_connections_absolute` : réglage du serveur Auth (10 connexions fixes) dans le tableau de bord, sans
  effet tant que l'instance ne change pas de taille.
