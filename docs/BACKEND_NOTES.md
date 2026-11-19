# Notes du Back-end Dev — Ascend (NexusMind)

Session `backend-dev`, créée le 19/11/2026. Périmètre (voir
`docs/TEAM_ROLES.md`) : `electron/`, `src/lib/`, `prisma/`, `supabase/`,
`cloudflare/`, `web/src/api.ts`, `scripts/`. Les tâches viennent du Chief ;
une demande directe de l'utilisateur est signalée au Chief.

## 1. Carte du back-end (état au 19/11)

- **Processus principal** `electron/main/` : `index.ts` (démarrage),
  `database.ts` (Prisma + runner de migrations), `ipc/*.ipc.ts` (≈ 32
  fichiers, enregistrés depuis `index.ts`), `ipc/validate.ts`
  (`validatedHandle` + schémas zod communs), `sync/` (moteur de sync
  local ↔ `sync_records`), `cloud/` (client Supabase avec session dans le
  trousseau, wrappers desktop des Cores), `assistant/` (moteur de
  coaching), enregistrement (`recorder.ts`, `wgcRecorder.ts`,
  `recorderBackend.ts`), transcription (`transcription.ts`, Whisper),
  post-partie (`gameDetector.ts`, `riotClient.ts`, `strandedGames*.ts`).
- **Logique partagée** `src/lib/*Core.ts` (31 fichiers) : fonctions qui
  prennent un `SupabaseClient` en premier argument, sans Electron ni DOM.
  Appelées par trois adaptateurs : desktop (`electron/main/cloud/*.ts`,
  qui fournit `getSupabase()`), web (`web/src/api.ts`) et bot Discord
  (`cloudflare/discord-bot`). Types côté renderer dans `src/lib/<x>.ts`.
  Tests dans `tests/unit/<x>Core.test.ts`.
- **SQLite local** : `prisma/schema.prisma`, migrations écrites à la main
  dans `prisma/migrations/<horodatage>_<nom>/migration.sql`, appliquées au
  démarrage par `runMigrations` (sauvegarde `VACUUM INTO` avant, 5 gardées).
- **Supabase** : `supabase/migrations/*.sql` (incomplet, WSC-05),
  `supabase/functions/` (delete-account, redeem-invite, team-calendar-ics,
  team-report, web-handoff).
- **Cloudflare** : `cloudflare/riot-proxy` (proxy Riot, secret
  `RIOT_API_KEY` permanent, limiteur `USER_LIMITER`) et
  `cloudflare/discord-bot` (cron toutes les 15 min, rôle service).
  Wrangler : `node cloudflare/<worker>/node_modules/wrangler/bin/wrangler.js`
  depuis le dossier du `wrangler.toml`, jamais `npx wrangler`.

## 2. Règles que je suis

### Découpage Core / IPC
- Toute requête Supabase partagée desktop/web/bot va dans un
  `src/lib/<x>Core.ts` : pur, `sb` en paramètre, aucune dépendance
  Electron, erreurs via `fail()` de `src/lib/supabaseErrors.ts`. Les
  adaptateurs (`electron/main/cloud/<x>.ts`, `web/src/api.ts`) ne font que
  fournir le client et relayer.
- Un handler IPC fait : valider → appeler le Core ou une fonction pure →
  écrire en base. La logique calculable (tri, choix, agrégats) sort du
  handler dans une fonction pure testée (modèle `strandedGamesCore.ts`,
  `backupCore.ts`). Je ne découpe pas les gros fichiers IPC d'office
  (E25) : je déplace ce que je touche.
- Une fonction Core nouvelle ou modifiée a son test dans
  `tests/unit/<x>Core.test.ts` (client Supabase simulé).
- Canal ajouté = trois endroits cohérents : handler, `electron/preload/index.ts`,
  `src/lib/ipc.ts` (et `web/src/api.ts` si la fonction existe sur le web).
  Les fichiers `preload` et `ipc.ts` sont partagés avec le Front-end : je
  préviens le Chief avant d'y écrire.

### Validation
- Tout nouveau handler utilise `validatedHandle` avec un `z.tuple` ; ids
  via `ids.id`, URLs via `httpsUrl` / `discordWebhookUrl`, textes bornés
  (`shortText(n)`), chemins via `localPath` puis `mediaAccess`.
- Il reste ≈ 130 `ipcMain.handle` bruts (contre ≈ 187 validés) : je
  convertis ceux que je touche, sans campagne séparée sauf demande.
- Côté Supabase, la vérification qui compte est la RLS ou la fonction
  `security definer` (rôle, appartenance au groupe) : la validation
  cliente n'est qu'un confort.

### Transactions et écritures
- Plusieurs écritures liées (boucle d'upsert, suppression + recréation,
  cascade) passent par `prisma.$transaction` ; `deleteMany` / `createMany`
  plutôt qu'une boucle (E07). SQLite est en journal rollback : chaque
  instruction hors transaction est un fsync.
- Les écritures déclenchées par la sync passent par la garde `applying` du
  moteur (pas de marqueur réémis pour une ligne reçue).
- Côté Supabase, un changement multi-tables se fait dans une RPC
  (une transaction) plutôt qu'en plusieurs appels clients.

### Migrations SQLite (locales)
- Jamais `prisma migrate dev`. SQL écrit à la main dans un nouveau dossier
  horodaté, jamais une migration déjà publiée modifiée.
- **Aucun `;` dans un commentaire SQL** : `splitSqlStatements` découpe sur
  `;` avant d'enlever les `--`.
- Le runner avale `duplicate column name`, `already exists`,
  `no such column` et `UNIQUE constraint failed` : une coquille peut donc
  marquer une migration appliquée sans l'exécuter. Je vérifie chaque
  migration sur une copie de base (`NEXUSMIND_DB_PATH`) et relis le
  schéma obtenu (`sqlite_master`), pas seulement l'absence d'erreur.
- Chaque migration copie toute la base au démarrage (`VACUUM INTO`) : pas
  de migration de confort (index sans besoin mesuré, E30).
- Une table synchronisée nouvelle doit être déclarée dans
  `sync/syncSchema.ts` (triggers) et, si elle porte un `userId`, dans les
  `userColumns` du moteur et dans `syncAudit.ts` si la RLS la partage.
- `prisma generate` après un changement de `schema.prisma` (client dans
  `prisma-client/`).

### Supabase, RLS et production
- **Aucune modification de la base de production sans l'accord explicite
  de l'utilisateur, demandé au moment même** (migration, `execute_sql`
  en écriture, déploiement d'edge function, purge). Les lectures seules
  passent aussi par le Chief tant que l'utilisateur ne les a pas
  autorisées (WSC-05, question 9 de l'audit).
- Toute migration de production est d'abord un fichier
  `supabase/migrations/<horodatage>_<nom>.sql` dans le dépôt, relu par
  CyberSecurity, puis appliquée telle quelle.
- Toute nouvelle table : RLS activée, politiques explicites par opération,
  fonctions `security definer` avec `search_path` fixé, rien d'exposé
  au rôle `anon` sans raison.
- **Sync de ses propres appareils : filtrer explicitement par
  `user_id = uid` dans la requête, ne jamais compter sur la RLS seule.**
  La RLS est additive (`sync_records_read_shared` laisse déjà un coach
  lire les lignes d'un joueur partagé) ; `SupabaseSyncRemote` filtre
  `pull()` et `getRecord()` par uid, toute nouvelle requête de ce chemin
  fait de même. Même principe pour le bot (rôle service, la RLS ne
  s'applique pas) : chaque requête filtre par groupe ou par roster.
- Avant de proposer une politique RLS élargie, lister qui lit la table
  avec ses propres invariants (sync, bot, staff dashboard).

### Workers Cloudflare et API Riot
- Clé Riot permanente : un 401/403 = clé révoquée ou limite, pas une
  expiration.
- Les adresses workers.dev sont compilées dans les versions publiées
  (`MAIN_VITE_RIOT_PROXY_URL`, `DEFAULT_WEB_URL`) : ne jamais renommer un
  worker publié.
- Chaque déploiement (worker, web app, edge function) demande le go de
  l'utilisateur au moment même ; `deploy --dry-run` avant.

### Hygiène de travail
- Scripts contenant `\` : écrits avec Write puis exécutés par chemin
  (pas de heredoc ni `node -e`). Pas de `sed -i` (passe les fichiers en
  LF) : Edit ou script node qui garde le CRLF.
- Fin de tâche : `npm run typecheck`, `npm run lint`, `npx vitest run`
  (+ `npm run check:i18n` si une clé change), puis compte rendu au Chief.
  Pas de commit.

## 3. Travail du handoff qui me revient

| # handoff | Sujet | Point de départ | Bloqué par |
|---|---|---|---|
| 2 | Chargement infini / reconnexion impossible après déconnexion | `web/src/api.ts`, `electron/main/ipc/auth.ipc.ts`, `electron/main/cloud/supabase.ts` (session dans le trousseau, `onAuthStateChange`) | Desktop ou web ? Étapes exactes (à demander à l'utilisateur via le Chief) |
| 3 | Héberger les images du pack de détourage | Sortie `D:\DEV\NexusMind\cutout-pack` | Fin du calcul + vérification Graphic Design |
| 4 | Règles encore sur l'horloge 2025 (plaques, dive, roam mid, tour latérale, M12 « mort avant 4:00 ») | `electron/main/mistakeRules.ts`, `assistant/rules.ts`, `docs/RAPPORT_MOTEUR.md` | — |
| 7 | Scouting : adversaires de toutes les équipes locales | Filtre par groupe côté `scoutingCore.ts` / `team.ipc.ts`, avec le Front-end | Coordination Front-end |
| 9 | Redéployer la web app (CSP logos, page Management web) | `web/`, wrangler | Go de l'utilisateur |
| 10 | Qualité de transcription : évaluer `whisper-small` | `electron/main/transcription.ts` | — |
| 11 | Purge des marqueurs de suppression de `sync_records` > 90 jours | RPC ou cron Supabase | Accord production |

Constats de l'audit (`docs/AUDIT_APP_2026-11.md`) dans mon périmètre,
attribués par le Chief :

- **§ 3.1 processus principal** : E10 (enrichissement post-partie, cœur
  du flux, à tester sur vraies parties), E02 (mémo du radar), E03 (sonde
  ffmpeg au démarrage), E04 (travail avant la fenêtre), E06 (`MatchCache`
  sans limite, décision), E07 (transactions), E08a (`refreshAutoTiers`),
  E09 (triple fetch post-partie), E11 + E27 (sévérité apprise ignorée par
  le bouton manuel), E12 (biais sur compte lié), E14 / E15-B / E15-C / E31
  (décisions), E19-E24 (redondances : `matchCache.ts`, `activeUser.ts`),
  E18 (SQL brut), E30 (runner qui avale `no such column`).
- **§ 3.4 web / workers / Supabase** : WSC-05 (versionner la production,
  lecture seule sur accord), WSC-06 (`getSharedTeam` lit toute
  `team_pool_entries`, y compris le bot en rôle service), WSC-08 (sur-chargement
  côté données), WSC-18 (colonne `auto_tier`, migration de production),
  WSC-19 (scrims hors modèle Core), WSC-22 (typecheck des workers, dépendance
  du bot non déclarée), WSC-23 / WSC-24 (proxy Riot : endpoints morts,
  commentaires).

Ordre retenu par le Chief (19/11, `docs/PLAN_CHIEF.md`) : #2 (bloquant
pour les joueurs) → #7 (filtre Scouting par groupe, bloque le Front-end) →
WSC-06 (fuite de lecture potentielle, petit) → E11/E27 → E07/E08a → #4 →
E10 (avec test réel) → le reste. Rien ne démarre avant le go du Chief.
