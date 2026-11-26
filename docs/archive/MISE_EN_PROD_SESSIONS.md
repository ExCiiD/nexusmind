> **ARCHIVÉ le 26/11/2026** : document livré ou remplacé, gardé pour l'historique. Ne pas suivre comme instruction.

# Mise en production — migrations des sessions d'équipe (Back-end)

Back-end, 20/11/2026. Quatre migrations écrites, testées sur PGlite et **non appliquées**. Chaque étape demande l'accord
direct de l'utilisateur. On s'arrête à la première erreur et on applique le retour arrière de l'étape. Comme pour la
beta.10 (`MISE_EN_PROD_BETA10.md`), on part d'un export du commit de la release, et `apply_migration` enregistre la
migration sous l'heure d'application : l'étape 5 renomme les fichiers en conséquence.

## 0. Avant de commencer (local, sans accord)

```
node scripts/test-team-session-objective-results.mjs <dossier PGlite 0.3.16>
node scripts/test-team-session-auto-lifecycle.mjs    <dossier PGlite 0.3.16>
node scripts/test-team-session-prep.mjs              <dossier PGlite 0.3.16>
node scripts/test-team-sessions-hardening.mjs        <dossier PGlite 0.3.16>
node scripts/test-schema-baseline.mjs                <dossier PGlite 0.3.16>
```

En lecture seule sur la prod : la dernière migration doit être `20261120080011 member_card_champion`. Sinon, on rafraîchit
la baseline d'abord.

## 1 à 4. Migrations, dans cet ordre

| # | Fichier | Ce qu'elle fait | Retour arrière | Perdu au retour arrière |
|---|---|---|---|---|
| 1 | `20261120110354_team_session_objective_results` | verdicts « tenu / pas tenu » du staff | `supabase/rollback/20261120110354_rollback.sql` | les verdicts |
| 2 | `20261120110436_team_session_auto_lifecycle` | sessions qui s'ouvrent et se ferment seules (pg_cron chaque minute), annulation, sessions gardées après suppression du créneau | `supabase/rollback/20261120110436_rollback.sql` | **les sessions détachées** (voir l'avertissement) |
| 3 | `20261120110520_team_session_prep` | objectifs par joueur, message du coach, drafts rattachés (préparation tant que la session est prévue) ; l'analyste écrit aussi les objectifs collectifs | `supabase/rollback/20261120110520_rollback.sql` | objectifs individuels, messages et drafts rattachés ; les objectifs collectifs reviennent aux seuls gestionnaires |
| 4 | `20261120110540_team_sessions_hardening` | UPDATE de `team_sessions` par colonnes ; enregistrements par nom de fichier | `supabase/rollback/20261120110540_rollback.sql` | rien (les chemins déjà réduits au nom restent réduits) |

> **Avertissement (CyberSecurity, 20/11) : le retour arrière de 2 supprime les sessions détachées.**
> Ce sont les sessions commencées dont le créneau a été supprimé (`calendar_event_id` null). L'ancien schéma ne sait pas
> les garder, et leurs games, reviews, retours et présences partent avec elles (cascade).
> Avant d'exécuter ce retour arrière, **sauvegarder en lecture seule** les lignes concernées de :
> - `team_sessions` (`where calendar_event_id is null`) ;
> - `team_session_games`, `team_session_reviews`, `team_session_feedback` ;
> - `team_session_attendance`, `team_session_objectives` ;
> - `team_session_objective_results`, `team_session_player_objectives`, `team_session_prep_notes`, `team_session_drafts` (si 1 et 3 sont appliquées) ;
>
> pour leurs `session_id`. Exemple pour compter avant : `select count(*) from public.team_sessions where calendar_event_id is null;`.
> Garder la sauvegarde hors du dépôt (données de joueurs).

Contrôles après chaque migration :
- `get_advisors` (sécurité) : aucun nouvel avertissement « anon peut exécuter ». Les RPC ajoutées
  (`set_team_session_objective_result`, `can_prepare_team_session`) sont réservées à authenticated.
- **2** : `select jobname, schedule from cron.job where jobname = 'team-session-lifecycle'` donne `* * * * *`. Après une
  minute, une session scrim dont le créneau a commencé est `live`.
- **4** : `select count(*) from team_session_reviews where recording_local_path ~ '[/\\]'` vaut 0, et authenticated n'a
  `UPDATE` sur `team_sessions` que pour `status, responsible_user_ids, queue_filter, started_at, ended_at`.

**Sans migration** : les liaisons L2-L6 (`myNextEvent`, `myOpenTasks`, `mySessionObjectives`, `myVodActionItems`, `src/lib/myTeam.ts`) lisent des tables existantes, sauf `mySessionObjectives`, vide avant 3. `dev_plans.created_by` (l'auteur du plan) existe déjà en prod. L'API le renvoie maintenant
(`DevPlan.createdBy`, `createdByName`).

## 5. Baseline (lecture seule en prod, dépôt seulement)

Comme à l'étape 6 de `MISE_EN_PROD_BETA10.md` : `git mv` des fichiers et des retours arrière vers leurs versions de prod,
mise à jour des références (scripts de test), réexport de `prod_migrations_*` et `prod_schema_*`. Vérifier que le md5 du
schéma est le même entre la prod et le dépôt reconstruit, puis lancer `test-schema-baseline`.

## Ce que le Front doit savoir

- Avant 1 et 3, les écrans marchent sans verdicts ni préparation (`available: false`, `NOT_AVAILABLE`).
- Après 2, une session gardée sans créneau ne s'ouvre plus par `/team-session/:calendarEventId` : il faut une route par
  `sessionId`.
- Après 4, les anciennes versions de l'app lisent un nom de fichier à la place du chemin. Une transcription relancée plus
  tard depuis une ancienne version échoue (`FILE_NOT_ALLOWED`). La version qui suit la résout grâce à `resolveMediaFile`.
