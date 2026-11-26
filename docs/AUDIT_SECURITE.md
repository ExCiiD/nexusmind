# Audit de sécurité — Phase S (1ʳᵉ passe)

> Première itération de l'audit défensif prévu en Phase S (voir `ROADMAP.md`). Mené sur l'infrastructure réelle (Supabase, dépendances npm), sans compte de test tiers. À compléter avant la publication publique du site complet par les points S4–S8 (en-têtes, XSS, Electron, pentest manuel/outillé).

## 1. Dépendances npm (`npm audit`)

| Avant | Après |
|---|---|
| 15 vulnérabilités (3 modérées, 12 hautes) | 3 restantes (2 modérées, 1 haute) |

**Corrigé automatiquement** (`npm audit fix`, non cassant, seul `package-lock.json` a changé) : `builder-util-runtime` (electron-updater — fuite de `PRIVATE-TOKEN`/`Authorization` sur redirection cross-origin, **haute**, code concerné : mise à jour auto de l'app), `deepmerge-ts`, `defu`, `effect`, `fast-uri`, `lodash`, `undici`, `ws` (dépendances transitives des outils de build/Prisma, exposition réelle faible mais corrigées par prudence).

**Restant, reporté volontairement** (nécessite une montée de version majeure, risque de régression à ne pas faire à l'aveugle) :
- `zod` 3.25 → 4.6.7 (**haute** : épuisement mémoire sur des collections contraintes de grande taille). `zod` valide toutes les entrées IPC de l'app (`validatedHandle`) : une montée en v4 change l'API et doit être migrée avec les tests de validation, pas par un simple `--force`.
- `react-router(-dom)` 6.30 → 7.18 (**modérée**, redirection ouverte via backslash dans `<Link>`/`useNavigate`). Risque pratique faible ici : aucune route ne navigue vers une URL fournie par un tiers (les fragments `#invite=`/`#handoff=` sont lus puis retirés de la barre d'adresse avant tout rendu, jamais passés à `Link`/`navigate`). Migration v7 à planifier séparément (changements d'API).

**Action à suivre** : migration dédiée `zod` v4 + `react-router` v7, avec sa propre PR et ses propres tests — à inscrire dans la suite de la Phase S.

## 2. Supabase (`get_advisors`)

| Constat | Niveau | Statut |
|---|---|---|
| `access_invite_attempts` : RLS activé sans policy | INFO | ✅ intentionnel — la table n'est écrite/lue que par le rôle `service_role` (Edge Function `redeem-invite`), qui contourne RLS ; aucune policy signifie qu'`anon`/`authenticated` n'y ont aucun accès, ce qui est le comportement voulu. |
| 4 fonctions `SECURITY DEFINER` appelables en RPC par `authenticated` (`create_access_invite`, `create_group`, `create_group_invite`, `join_group`) | WARN | ✅ revues : chacune vérifie elle-même l'authentification (`auth.uid()`) et l'autorisation (`private.is_app_admin()`, `private.is_group_staff()`, rôle `owner`) avant d'agir, et tourne avec `search_path = ''` (pas de détournement de schéma). Design voulu : ce sont des points d'entrée contrôlés qui doivent justement dépasser RLS pour créer la première ligne (groupe, invitation). |
| Protection « mot de passe compromis » (HaveIBeenPwned) désactivée | WARN | ⏳ **action manuelle requise** : Authentication → Policies → Password → activer « Leaked password protection ». Pertinent maintenant que l'app propose un mot de passe optionnel (session du 13/11). |

## 3. Environnement de développement

En corrigeant les dépendances, `electron` a été réinstallé : npm a bloqué son script d'installation (téléchargement du binaire) via la liste blanche `allowScripts`. Les paquets de build légitimes et déjà utilisés (`electron`, `esbuild`, `ffmpeg-static`, `prisma`, `@prisma/client`, `@prisma/engines`) ont été explicitement approuvés et la liste est maintenant persistée dans `package.json` (`allowScripts`), pour que les futures installations ne rouvrent pas la question. Un zip d'Electron en cache a aussi été ré-extrait (`extract-zip`/`yauzl` s'arrêtait après la première entrée dans cet environnement) ; contourné avec l'extraction native Windows.

## 3bis. Secret OAuth YouTube embarqué dans le build (même famille de bug que la clé Riot)

`electron/main/ipc/youtube.ipc.ts` envoie `MAIN_VITE_GOOGLE_CLIENT_SECRET` à Google lors de l'échange de code et du rafraîchissement de token. Le préfixe `MAIN_VITE_` est inliné en clair dans `app.asar` à chaque build (c'est documenté comme tel dans `electron/env.d.ts` — « Secrets never use the MAIN_VITE_ prefix » — mais ce secret-ci y déroge). N'importe qui peut l'extraire d'un installeur publié.

**Pas corrigé maintenant**, volontairement : la vraie solution (faire transiter l'échange de token par une Edge Function côté serveur, comme pour le proxy Riot) change un flux OAuth tiers déjà utilisé, impossible à valider de bout en bout sans un vrai compte Google en session interactive — un correctif à l'aveugle risquerait de casser le lien YouTube pour de vrai plutôt que de simplement rester vulnérable.

**Plan recommandé** (à faire en présence de l'utilisateur, pas en autonome) :
1. Ajouter PKCE (`code_verifier`/`code_challenge`, méthode `S256`) à la demande d'autorisation.
2. Créer une Edge Function `youtube-oauth-exchange` (service role) : reçoit `{ code, codeVerifier, redirectUri }` ou `{ refreshToken }`, appelle l'endpoint token de Google avec le vrai secret (stocké en secret Supabase, jamais côté client), authentifie l'appelant via son JWT Ascend.
3. Le desktop n'appelle plus Google directement pour l'échange — seulement pour l'autorisation (pas de secret nécessaire côté navigateur).
4. Retirer `MAIN_VITE_GOOGLE_CLIENT_SECRET` de `.env`/`electron/env.d.ts` une fois le flux migré, et vérifier si le client OAuth Google doit passer en type « Application de bureau » (sans secret attendu par Google pour ce type).
5. Tester avec un vrai compte Google avant de considérer que c'est fait.

## 4. Points déjà couverts ailleurs

Auth, invitations, RLS des tables applicatives, durcissement Electron (sandbox, CSP, `nxm://`) : voir la checklist complète S1–S8 dans `ROADMAP.md`. Ce document ne couvre que ce qui a été vérifié dans cette passe (S2 partiel, S4 lu pour `react-router`) ; S4 (en-têtes), S5 (XSS), S7 (Electron) et le test d'intrusion manuel restent à faire avant publication.

---

## 19/11/2026 — Mise à jour (session CyberSecurity)

Passe en **lecture seule** : rien n'a été modifié (ni code, ni base de production, ni secret). Sources : advisors Supabase, requêtes `SELECT` sur le catalogue Postgres, lecture du code (`main` local, 2 commits d'avance sur `origin/main`), `npm audit` dans chaque paquet, en-têtes HTTP des sites en ligne (`curl -I`), réglages Auth publics (`/auth/v1/settings`). Les valeurs des secrets n'ont été ni affichées ni copiées : seuls leurs noms et leurs longueurs ont été lus.

**Bilan :** aucune faille critique exploitable à distance n'a été trouvée. La RLS couvre toutes les tables, les CSP sont en place et en ligne, et la configuration Electron est solide. Les risques principaux viennent de la **chaîne de livraison** : Electron en fin de vie, installeurs non signés mis à jour automatiquement, ffmpeg non vérifié, dépendances qui ont régressé. Il faut aussi corriger **une faille d'autorisation dans le bot Discord**.

### Constats, par sévérité

| ID | Sévérité | Constat | Session |
|---|---|---|---|
| S19-01 | **Haute** | Electron 33 en fin de vie | Back-end |
| S19-02 | **Haute** | Installeurs non signés et mise à jour automatique sans vérification de signature | Chief + utilisateur, puis Back-end |
| S19-16 | **Haute** | Suppression de compte en échec (9 clés étrangères `NO ACTION`) ; le créateur d'un groupe qui supprime son compte efface tout le groupe | Back-end (prod : accord) + Front-end |
| S19-03 | **Moyenne-haute** | Bot Discord : `/availability` sans contrôle d'appartenance au groupe | Back-end |
| S19-17 | Moyenne | Données d'équipe d'un membre (rosters, scouting, drafts, scrims) lisibles par tout membre de **n'importe lequel** de ses groupes, partage actif par défaut | Back-end (prod : accord) |
| S19-04 | Moyenne | ffmpeg téléchargé et embarqué sans empreinte (S3, toujours ouvert) | Back-end |
| S19-05 | Moyenne | `npm audit` : régression à 45 vulnérabilités, dont des paquets d'exécution | Back-end |
| S19-06 | Moyenne | Clé OpenAI toujours dans `.env` (non révoquée) | Utilisateur |
| S19-07 | Moyenne | Fonctions `SECURITY DEFINER` de cron appelables par `anon`/`authenticated` | Back-end (prod : accord) |
| S19-08 | Moyenne | Données de bien-être (santé, art. 9 RGPD) et textes légaux de l'app (v0.1) en retard sur le site (v0.2) | Front-end (textes) + utilisateur (décision) |
| S19-09 | Basse-moyenne | Protection « mot de passe compromis » toujours désactivée | Utilisateur (tableau de bord) |
| S19-10 | Basse-moyenne | Proxy Riot : 300 req/min par compte, une seule personne peut épuiser le quota Riot de l'app | Back-end |
| S19-11 | Basse | ~130 handlers IPC sans validation zod | Back-end |
| S19-12 | Basse | `sync_push` : ni liste de tables autorisées, ni taille maximale, dates futures acceptées | Back-end (prod : accord) |
| S19-13 | Basse | `team_session_games` modifiable et supprimable par n'importe quel membre | Back-end (après décision produit) |
| S19-14 | Basse | Droits par défaut d'`anon` sur toutes les tables (la RLS est la seule barrière) | Back-end (prod : accord) |
| S19-15 | Info | Secret YouTube (§ 3bis) : plus embarqué dans le build actuel, mais le lien YouTube ne marche probablement plus dans l'app installée | Back-end |

#### S19-01 — Electron 33 en fin de vie (Haute)
- **Impact :** Electron 33 (installé : 33.4.11) n'est plus maintenu. Les failles Chromium/V8 corrigées depuis ne le sont pas dans Ascend. Or le rendu charge du contenu distant : iframes YouTube, images DDragon/CommunityDragon, logos Supabase, et du texte écrit par d'autres membres du groupe (commentaires, notes, drafts). Une faille de moteur exploitée par ce biais tournerait dans un rendu doté de `window.api`, même s'il reste sandboxé. `npm audit` signale aussi un contournement de l'intégrité ASAR (corrigé en 45.4.1).
- **Preuve :** `package.json` → `"electron": "^33.2.0"` ; `node_modules/electron/package.json` → 33.4.11 ; `npm audit` → `electron (direct) fix: electron@45.4.1 MAJOR`.
- **Correctif :** monter vers une version d'Electron maintenue (≥ 45.4.1), dans une branche à part, avec `electron-builder` ≥ 26.18 (S19-05). Vérifier ensuite la capture WGC/ddagrab, le `nxm:` (Range/206), `safeStorage`, la mise à jour automatique et le démarrage avec Windows. Activer dans la foulée les *fuses* Electron (`RunAsNode` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on).
- **Session :** Back-end, puis revue Audit + CyberSecurity avant la release.

#### S19-02 — Installeurs non signés et mise à jour automatique (Haute)
- **Impact :** `electron-builder.yml` contient `sign: false`. Sans signature ni `publisherName`, `electron-updater` installe tout binaire publié dans la release GitHub, sur la seule foi du HTTPS. Quiconque obtient l'accès au compte ou à un jeton GitHub de publication exécute donc son code chez **tous** les utilisateurs, à la prochaine mise à jour. S'y ajoutent l'avertissement SmartScreen et l'impossibilité, pour un joueur, de vérifier l'éditeur.
- **Preuve :** `electron-builder.yml` lignes 51-52 (`sign: false`, `signingHashAlgorithms: []`).
- **Correctif :** 1) tout de suite, sans coût : 2FA matérielle sur le compte GitHub, jeton de publication à portée minimale (un seul dépôt, `contents:write`) et à durée limitée ; `GH_TOKEN` est vide dans `.env`, donc à garder hors du fichier. 2) Ensuite, signature de code (Azure Trusted Signing ou certificat OV/EV) et `publisherName` dans `win`, pour que `electron-updater` vérifie la signature avant d'installer. Le coût est une décision de l'utilisateur.
- **Session :** Chief (décision de l'utilisateur), puis Back-end.

#### S19-03 — Bot Discord : écriture dans un groupe sans en être membre (Moyenne-haute)
- **Impact :** `/availability away|back` résout l'utilisateur Ascend lié au compte Discord (`discord_user_links`) et le groupe lié au serveur (`discord_guild_links`). Il écrit ensuite dans `availability_exceptions` avec la **clé service_role** (donc sans RLS) **sans vérifier que l'utilisateur est membre du groupe**. Tout membre du serveur Discord ayant un compte Ascend lié (un serveur communautaire, un adversaire de scrim invité, un ancien joueur) peut donc créer ou effacer des absences dans le planning d'une équipe dont il ne fait pas partie, et lancer la recherche de remplaçant des scrims. Par ailleurs, `/set-channel` peut être lancé par n'importe quel membre du serveur et redirige les rappels vers un autre salon. Enfin, `/calendar`, `/scrims` et `/common-availability` montrent le planning à tout membre du serveur. C'est voulu, mais à documenter.
- **Preuve :** `cloudflare/discord-bot/src/handlers.ts:128-160` (aucun contrôle de `group_members`) ; `src/lib/discordBotCore.ts:136` (`upsert` direct) ; `cloudflare/discord-bot/scripts/register-commands.mjs` (aucun `default_member_permissions`).
- **Correctif :** dans `handleAvailability`, refuser si `group_members(group_id = link.groupId, user_id = userId)` n'existe pas. Dans `handleSetChannel`, exiger que l'utilisateur Discord soit lié à un membre staff du groupe, ou la permission Discord `MANAGE_GUILD` (vérifier `member.permissions` dans l'interaction, et `default_member_permissions` à l'enregistrement de `/set-channel` et `/link-team`). Ajouter des tests unitaires sur les deux refus.
- **Session :** Back-end (redéploiement du worker : accord de l'utilisateur).

#### S19-04 — ffmpeg sans vérification d'empreinte (Moyenne)
- **Impact :** `postinstall` télécharge `ffmpeg-8.1-essentials_build.zip` depuis un dépôt GitHub tiers (`GyanD/codexffmpeg`), l'exécute (`-version`) puis l'embarque dans chaque installeur (`extraResources`). La seule vérification porte sur la chaîne de version. Un fichier de release remplacé chez ce tiers serait exécuté sur le poste de build, puis livré à tous les utilisateurs (S19-02 aggrave le risque).
- **Preuve :** `scripts/download-ffmpeg.mjs:26` et `:116-118` ; `electron-builder.yml:25-27`. Empreinte SHA-256 du `ffmpeg.exe` présent localement (référence à confronter à celle publiée par l'éditeur) : `1a65d5b0b10d8d9a81d2824a3538046a40ed3607c906b335a166add87613f705`.
- **Correctif :** épingler le SHA-256 du zip (publié par gyan.dev) dans le script, refuser en cas d'écart, et ne rien exécuter avant cette vérification.
- **Session :** Back-end.

#### S19-05 — Dépendances : régression (Moyenne)
- **Impact :** on est passé de 3 vulnérabilités restantes le 13/11 à **45** (3 critiques, 24 hautes, 15 modérées, 3 basses). La plupart touchent les outils de développement ou de build (vitest UI, tinypool, tar et la chaîne electron-builder, vite, postcss). Côté exécution, chez l'utilisateur : `electron` (S19-01), `zod` 3 (épuisement mémoire, déjà connu) et `builder-util-runtime`. La faille de fuite de jeton sur redirection de ce dernier, corrigée le 13/11, réapparaît via electron-builder 25 ; à vérifier sur la copie utilisée par `electron-updater`. `cloudflare/riot-proxy` et `cloudflare/discord-bot` : 0 vulnérabilité. `web/` n'a pas de `package-lock.json` propre (dépendances de la racine).
- **Preuve :** `npm audit --json` à la racine (19/11).
- **Correctif :** `npm audit fix` pour les correctifs non cassants (vitest, vite, postcss, tmp, form-data…). Montée majeure `electron-builder` 26.18 à faire avec S19-01. Migration `zod` v4 et `react-router` v7 dans leur propre branche (déjà prévue au § 1). Lancer `npm audit` à chaque revue avant release.
- **Session :** Back-end.

#### S19-06 — Clé OpenAI dans `.env` (Moyenne)
- **Impact :** `MAIN_VITE_OPENAI_API_KEY` (164 caractères) est toujours présente dans `.env`. **Bonne nouvelle :** plus aucun code ne la lit, et elle n'apparaît ni dans `out/` ni dans `app.asar`, donc elle n'est pas livrée. Mais c'est une clé valide en clair sur le disque : sauvegardes, outils, sessions. Le préfixe `MAIN_VITE_` l'embarquerait de nouveau dès qu'un code la lirait.
- **Preuve :** nom et longueur lus dans `.env` ; recherche par motif dans `out/` et `release/win-unpacked` : aucune occurrence.
- **Correctif :** l'utilisateur révoque la clé dans la console OpenAI, puis on retire la ligne de `.env`. Même vérification à faire pour `RIOT_DEV_API_KEY` (clé de dev, lue à l'exécution en dev seulement, jamais embarquée).
- **Session :** Utilisateur (révocation), puis n'importe quelle session pour retirer la ligne.

#### S19-07 — Fonctions `SECURITY DEFINER` appelables via l'API (Moyenne)
- **Impact :** les fonctions de cron `run_weekly_load_check`, `run_review_pending_check`, `run_dev_plan_period_check` et `run_scrim_availability_check` sont exécutables par `anon` et `authenticated` via `/rest/v1/rpc/...`. La clé `anon` est publique, puisqu'elle est dans l'app. N'importe qui peut donc lancer, aussi souvent qu'il le veut, des parcours complets de `sync_records`, `wellbeing_checkins` et `scrims` avec les droits du propriétaire (charge et déni de service léger), et déclencher les notifications avant l'heure. Les doublons sont évités (drapeaux `*_notified` et contrôle sur 3 jours), donc pas de spam illimité. Les quatre autres `run_*` ont déjà le droit retiré : c'est incohérent. `set_captain` et `set_weekly_load_threshold` sont aussi ouvertes à `anon` (inoffensif, car `auth.uid()` vaut NULL et la fonction refuse, mais inutile). Les fonctions de trigger (`auto_create_team_session`, `notify_calendar_event_request`) sont listées, mais PostgreSQL refuse de les appeler hors trigger.
- **Preuve :** advisors `anon_security_definer_function_executable` (8) et `authenticated_security_definer_function_executable` (15) ; `has_function_privilege('anon', …)` = true pour ces 4 `run_*`, false pour `run_scrim_reminders`, `run_inactive_player_check`, `run_objective_overdue_check` et `run_wellbeing_alert_check`.
- **Correctif :** une migration `revoke execute on function public.run_…() from public, anon, authenticated` pour les 4 `run_*` et les 2 fonctions de trigger, et `revoke … from anon` sur `set_captain` et `set_weekly_load_threshold`. `pg_cron` tourne en `postgres` et n'en dépend pas. Penser aux `alter default privileges` pour les fonctions futures.
- **Session :** Back-end (base de production : accord de l'utilisateur).

#### S19-08 — Données de santé et textes légaux (Moyenne)
- **Impact :** les check-ins de bien-être (humeur, énergie, sommeil) sont des données de santé au sens de l'art. 9 du RGPD. Ils sont stockés dans le cloud (`wellbeing_checkins`) dès qu'ils sont saisis avec un compte. Or le site (v0.2) ne fonde le consentement explicite que sur le **partage** avec le staff, pas sur le stockage dans le cloud lui-même. Les textes de l'app (`src/legal/*.md`, v0.1, « brouillon ») ne décrivent que les sauvegardes et le relais Riot. Il y manque la synchronisation, les groupes, le bien-être, le bot Discord, YouTube, les signalements, les notifications et la mention des mineurs. Absents des deux versions : la présence aux réunions (`team_session_attendance`, nouvelle du 19/11), les récompenses MVP / Grinder, les liens publics de rapport d'équipe (`team-report/<token>`, sans connexion, avec les noms des joueurs), le flux calendrier `.ics` à jeton et les logos d'équipe publics (bucket `group-logos` public).
- **Preuve :** `src/legal/privacy.fr.md` (en-tête « Version 0.1 ») contre `site/src/legal/confidentialite.html` (« Version 0.2 · mise à jour le 18 nov ») ; tables `wellbeing_checkins`, `team_session_attendance`, `report_shares`, `calendar_subscriptions` ; bucket `group-logos` (`public = true`).
- **Correctif :** aligner l'app sur la v0.2 (L06 de l'audit app), puis compléter la v0.3 avec les points manquants. Ajouter une case de consentement explicite au **premier** check-in de bien-être (stockage et synchronisation), retirable, avec suppression des check-ins. Faire relire par l'utilisateur ; la qualification juridique est sa décision.
- **Session :** Front-end (textes et case), Back-end (suppression des check-ins si besoin), utilisateur (validation).

#### S19-09 — Mots de passe compromis (Basse-moyenne)
- Toujours désactivée (advisor `auth_leaked_password_protection`), voir § 2. **Correctif :** dans le tableau de bord, Authentication → Policies → Password → « Leaked password protection ». **Session :** Utilisateur. Vérifié au passage : l'inscription libre est **fermée** côté serveur (`disable_signup: true`) et la connexion anonyme est **désactivée**, donc le mode sur invitation ne dépend pas du seul `shouldCreateUser: false` côté client.

#### S19-10 — Quota Riot partagé (Basse-moyenne)
- **Impact :** `USER_LIMITER` autorise 300 requêtes par minute et par compte, alors que la clé Riot de l'app (une clé personnelle ou de production) a un quota global plus bas. Un seul compte, légitime ou malveillant (le scouting automatique, par exemple), peut épuiser le quota pour tous : les 429 de Riot sont alors renvoyés à tout le monde. `url.search` est relayé sans filtre (sans danger sur les chemins autorisés, mais inutile).
- **Preuve :** `cloudflare/riot-proxy/wrangler.toml` (`limit = 300, period = 60`) ; `cloudflare/riot-proxy/src/routing.ts:54`.
- **Correctif :** caler la limite par compte sur une fraction du quota de la clé (par exemple 30/min), et ne relayer que les paramètres de requête attendus (`start`, `count`, `queue`, `type`, `startTime`, `endTime`).
- **Session :** Back-end (redéploiement du worker : accord).

#### S19-11 — IPC sans validation (Basse)
- **Impact :** sur environ 320 handlers, 188 passent par `validatedHandle` (zod) et ~130 restent en `ipcMain.handle` brut. Ces derniers reçoivent surtout des identifiants (`team.ipc.ts` 23, `session.ipc.ts` 10, `recording.ipc.ts` 10, `stats.ipc.ts` 9, `mistakes.ipc.ts` 8). Aucun ne reçoit de chemin de fichier ni de commande shell : les suppressions passent par un id en base, ffmpeg est lancé avec un tableau d'arguments, et le SQL brut est paramétré ou limité à des noms de table connus. L'exploitation suppose un rendu déjà compromis, ce que la CSP (`script-src 'self'`) rend difficile.
- **Correctif :** migrer progressivement vers `validatedHandle`, en commençant par `team.ipc.ts` et `recording.ipc.ts` (`clip:*`), et faire refuser par le lint tout nouveau `ipcMain.handle` brut.
- **Session :** Back-end.

#### S19-12 — `sync_push` (Basse)
- **Bon point :** `SECURITY INVOKER`, `auth.uid()` imposé, 500 lignes au plus par appel, `search_path` vide. Le correctif du 19/11 (pas de réécriture d'une ligne identique) est correct.
- **Faiblesses :** pas de liste blanche de `table_name`, pas de taille maximale pour `data`, et `updated_at` peut être dans le futur. Un compte peut gonfler le stockage, ou fausser ses propres durées de parties lues par `run_weekly_load_check` (impact limité à ses propres données et alertes).
- **Correctif :** `check` sur `table_name` (tables synchronisées connues), sur `pg_column_size(data) < 256 kB` et sur `updated_at <= now() + interval '5 minutes'`.
- **Session :** Back-end (base de production : accord).

#### S19-13 — `team_session_games` (Basse)
- La politique `team_session_games_write` (ALL) n'exige que d'être membre du groupe, alors que les objectifs, reviews et présences d'une session exigent `can_manage_session`. N'importe quel joueur peut donc retirer ou ajouter les parties d'une session d'équipe. **Correctif :** si ce n'est pas voulu, limiter la suppression au staff ou au capitaine. **Session :** Back-end, après décision du Chief.

#### S19-14 — Droits d'`anon` sur les tables (Basse)
- Les 61 tables de `public` ont la RLS **activée** : c'est vérifié, y compris `team_session_attendance` (lecture par les membres, écriture par `can_manage_session`, rôle `authenticated`). Mais `anon` garde les droits SELECT, INSERT, UPDATE et DELETE par défaut de Supabase sur toutes. Les politiques en `{public}` dépendent de `auth.uid()` (NULL pour `anon`), donc rien n'est exposé aujourd'hui. Mais une future politique écrite par erreur en `using (true)` serait ouverte à tout Internet. **Correctif :** `revoke all on all tables in schema public from anon` plus `alter default privileges … revoke … from anon`, l'app n'ayant aucun usage non connecté de PostgREST. À tester avant (pages publiques, edge functions en service_role non concernées). **Session :** Back-end (base de production : accord).

#### S19-15 — Secret YouTube (Info, met à jour le § 3bis)
- `youtube.ipc.ts` lit `process.env.MAIN_VITE_GOOGLE_CLIENT_SECRET` (et non `import.meta.env`). electron-vite ne l'inline donc pas : le secret est absent de `out/main/index.js` et de `app.asar` (recherche de la valeur exacte : 0 occurrence). Le risque d'extraction du § 3bis n'existe plus dans le build actuel. **Conséquence :** dans l'app installée, sans `.env`, le client OAuth n'a ni ID ni secret, et le lien YouTube doit échouer (« Google OAuth credentials not configured »). Le plan du § 3bis (PKCE + edge function) reste la bonne solution le jour où la fonction doit marcher. Autre point : les jetons YouTube retombent dans un fichier `.plain` quand `safeStorage` n'est pas disponible. **Session :** Back-end (si la fonction YouTube est gardée).

### Vérifié et conforme
- **Supabase :** RLS active sur les 61 tables ; les 4 tables sans politique (`access_invite_attempts`, `discord_dm_sent`, `discord_notifications_sent`, `scrim_availability_reminders`) ne sont lues que par le service_role, ce qui est voulu. Stockage : `backups` privé, limité au dossier `auth.uid()`, 50 Mo, gzip seulement ; `group-logos` public en lecture par URL, écriture via `can_edit_group_logo`, 512 ko, images seulement ; `set_group_logo` valide l'URL par regex. Les 5 edge functions (`verify_jwt = false`) vérifient elles-mêmes : `getUser(token)` pour `delete-account` et `web-handoff`, un jeton aléatoire pour `team-report` et `team-calendar-ics`, et `redeem-invite` est limitée à 10 échecs par IP et par heure. `team-report` échappe tout le HTML (`esc`).
- **Desktop :** `contextIsolation: true`, `nodeIntegration: false` et `sandbox: true` sur les trois fenêtres ; `setWindowOpenHandler` refuse et `will-navigate` bloque, seul le `http(s)` part vers le navigateur. CSP du rendu : `script-src 'self'`, `object-src 'none'`. Le `nxm:` exige une extension média, refuse `..` et n'ouvre que les dossiers d'enregistrement configurés, avec `realpath` (`mediaAccess.ts`).
- **Web et site (en ligne, `curl -I` le 19/11) :** CSP stricte, HSTS, `nosniff`, `X-Frame-Options: DENY` et `frame-ancestors 'none'` sur la web app comme sur le site ; site en `noindex`. La règle CSP des logos (`img-src … supabase.co`) est déjà servie en ligne.
- **Workers :** proxy Riot avec JWT Supabase vérifié (JWKS, `iss` et `aud`), comptes anonymes refusés, liste blanche hôte + chemin, GET seulement, 401/403 de Riot masqués. Bot Discord : signature Ed25519 vérifiée avant tout traitement.
- **Secrets :** `.env` ignoré par git ; aucun fichier de secret suivi ; aucun secret dans `out/` ni dans `app.asar`.

#### S19-16 — La suppression de compte échoue ou efface le groupe des autres (Haute — droit à l'effacement)
*Trouvé le 19/11 pendant la rédaction de la v0.3 (`docs/LEGAL_V0.3_DRAFT.md`).*
- **Impact :**
  1. `delete-account` appelle `auth.admin.deleteUser(uid)`. Or neuf tables pointent vers `auth.users` avec `ON DELETE NO ACTION` : `team_discussion_comments.author_id`, `team_session_feedback.user_id`, `team_session_games.reported_by`, `team_session_reviews.recorded_by`, `team_session_objectives.set_by`, `calendar_event_requests.requested_by`, `group_fundamentals.created_by`, `report_shares.created_by` et `calendar_subscriptions.created_by`. Pour tout utilisateur qui a écrit au moins une de ces lignes, la suppression échoue en 500 (`delete_user_failed`). Le bouton « Supprimer mon compte » promis par la politique de confidentialité ne marche donc pas pour les membres actifs d'une équipe.
  2. À l'inverse, `groups.created_by` est en `ON DELETE CASCADE` : quand le **créateur** d'un groupe supprime son compte, tout le groupe disparaît pour tous ses membres (planning, scrims, sessions, rosters…), sans avertissement.
  3. Les logos du bucket `group-logos` ne sont pas supprimés (seul `backups` est vidé).
- **Preuve :** `pg_constraint` (`confdeltype = 'a'` pour les 9 colonnes, `'c'` pour `groups.created_by`) ; `supabase/functions/delete-account/index.ts:26-39`.
- **Correctif :**
  1. Migration : passer les 9 colonnes en `ON DELETE SET NULL` (colonne rendue nullable, l'interface affiche « ancien membre ») ou `CASCADE`. L'éditeur choisit entre anonymiser et supprimer ; voir le § 7 du brouillon v0.3.
  2. Ne plus faire dépendre la vie du groupe de son créateur. Soit `groups.created_by` passe en `SET NULL` ; soit `delete-account` transmet d'abord le rôle `owner` à un autre membre du staff, et ne supprime le groupe que s'il n'y en a pas, après confirmation dans l'interface.
  3. Test de bout en bout sur un compte de test qui a écrit dans chaque table.
- **Session :** Back-end (migration de prod et redéploiement de la fonction : accord de l'utilisateur), Front-end (avertissement avant la suppression du compte du créateur).

#### S19-17 — Les données d'équipe d'un membre sont lisibles depuis **tous** ses groupes (Moyenne, confidentialité)
*Trouvé le 19/11 pendant la tâche #41 (Stats collectives).*
- **Impact :** `private.can_read_player_table` (politique `sync_records_read_shared`) autorise **tout membre** d'un groupe commun, joueurs compris, à lire les lignes `Team`, `TeamMember`, `ChampionPoolEntry`, `DraftPrep` et `CustomGame` d'un autre membre, dès que `share_team` vaut vrai **ou n'est pas défini** (`coalesce(s.share_team, true)`). Le contrôle ne porte que sur « avons-nous un groupe en commun », **pas sur le groupe auquel la donnée appartient**. Un coach qui travaille avec deux équipes A et B expose donc aux joueurs de A ses rosters, son scouting d'adversaires, ses drafts et les résultats de scrims importés pour B. Une équipe rivale qui partage un coach ou un analyste peut lire la préparation de l'autre. Le partage est en plus actif par défaut, sans choix explicite.
- **Preuve :** le corps de `private.can_read_player_table` en production, avec la branche `p_table in ('Team','TeamMember','ChampionPoolEntry','DraftPrep','CustomGame') and coalesce(s.share_team, true)`, sans condition de rôle ni de groupe sur la donnée.
- **Correctif :**
  1. **Court terme (migration de production, sur accord) :** passer `coalesce(s.share_team, true)` à `false`, pour un partage explicite, et réserver cette branche au staff (`viewer.role in ('owner','coach','analyst','manager')`), comme les deux autres branches.
  2. **Fond :** les données d'équipe d'un groupe ne devraient pas transiter par les `sync_records` personnels d'un membre. Elles relèvent de tables **rattachées au groupe** (comme `team_rosters` et `team_drafts`, déjà RLS par `group_id`). Voir le plan #41.
- **Vérifier d'abord :** si une fonction de l'app lit aujourd'hui ces lignes chez un coéquipier, la restreindre la casserait. Recherche à faire par le Back-end : lectures de `sync_records` hors `user_id = auth.uid()`.
- **Session :** Back-end (migration de production : accord de l'utilisateur).

### Verdict sécurité beta.8 (`origin/main..main`, 19/11) : **OK**
- **Périmètre :** `4ffef1d` et la fusion `41f457c`, 14 fichiers, uniquement de l'interface (`src/pages/Management`, `src/pages/TeamSpace`, `src/components/team/TeamSection.tsx`, `NotificationBell.tsx`, routes desktop et web, i18n). Aucun changement dans `supabase/`, `prisma/`, `electron/` ou `cloudflare/` : ni nouvelle table, ni nouvelle requête Supabase, ni nouvel IPC (seul `linkTeamToGroup`, déjà existant, est réutilisé).
- **`?tab=` dans l'URL :** la valeur est comparée à la liste des onglets visibles, et la page retombe sur l'onglet par défaut sinon. Masquer un onglet n'est qu'un confort d'interface : les données restent protégées par la RLS. `trial_candidates` et l'écriture de `tasks` sont réservés au staff, `wellbeing_checkins` n'est lisible que par son auteur ou via `can_read_wellbeing`, ce qui exige le partage. L'onglet bien-être est visible par un joueur, mais il ne peut y lire que ses propres données.
- **Liens des notifications :** `linkOf()` ne réécrit que `'/coaching'` vers des routes internes figées. Le champ `link` vient des triggers serveur. Les utilisateurs ne peuvent pas créer de notification : pas de politique INSERT, et l'UPDATE est limité à leurs propres lignes, ce qui ne touche qu'eux. Pas d'ouverture de redirection.
- **Pas de nouveau puits HTML :** ni `dangerouslySetInnerHTML`, ni `innerHTML`, ni `openExternal` dans ce diff.
- **Réserves, hors beta.8 et non bloquantes pour elle :** S19-01, S19-02 et S19-03 restent ouverts.

### Plan de correction #13 (priorisé, 19/11)

| Ordre | Point | Qui corrige | Fichiers | Fin |
|---|---|---|---|---|
| 1 | **Clé OpenAI dans `.env`** (S19-06) | **Utilisateur** (révocation), puis Back-end (ménage) | `.env` (local, non suivi par git) | Clé révoquée chez OpenAI, ligne retirée, recherche à vide dans `out/` |
| 2 | **ffmpeg sans empreinte** (S3 / SEC-4 / S19-04) | Back-end | `scripts/download-ffmpeg.mjs` | Le script refuse un zip dont le SHA-256 diffère, avant toute exécution |
| 3 | **Textes légaux v0.1 → v0.2, puis v0.3** (L06 / S19-08) | Front-end (app), Graphic Design (site), utilisateur (validation) | `src/legal/privacy.{fr,en}.md`, `src/legal/terms.{fr,en}.md`, `site/src/legal/{confidentialite,privacy,conditions,terms}.html`, et le composant qui affiche les textes dans l'app | App et site à la même version ; points manquants ajoutés ; consentement au bien-être |
| 4 | **Secret OAuth YouTube** (SEC-2 / § 3bis / S19-15) | Chief + utilisateur (décision), puis Back-end | `electron/main/ipc/youtube.ipc.ts`, `electron/env.d.ts`, `.env`, nouvelle `supabase/functions/youtube-oauth-exchange/index.ts` | Aucun secret côté client, lien YouTube testé avec un vrai compte |

Pourquoi cet ordre : la clé OpenAI est un secret **valide** qui ne demande qu'une action de deux minutes. ffmpeg est un binaire livré à tous les utilisateurs, avec un correctif d'une dizaine de lignes. Les textes légaux sont une obligation de conformité avant toute ouverture publique. Le secret YouTube n'est **plus embarqué** dans le build actuel (S19-15) : le risque immédiat est tombé, il reste une fonction cassée à décider.

**1. Clé OpenAI — étapes pour l'utilisateur**
1. Ouvrir platform.openai.com → *API keys* (ou *Projects → API keys* si la clé est une clé de projet `sk-proj-…`).
2. Repérer la clé à ses derniers caractères : ouvrir `.env` localement et comparer avec la fin affichée par la console, sans la coller nulle part.
3. *Revoke* la clé. Si aucune fonction d'Ascend ne s'en sert (c'est le cas : aucun code ne lit `MAIN_VITE_OPENAI_API_KEY`), ne pas en recréer.
4. Dans *Usage*, vérifier qu'aucune consommation inattendue n'a eu lieu, et sinon prévenir CyberSecurity.
5. Supprimer la ligne `MAIN_VITE_OPENAI_API_KEY=` de `D:\DEV\NexusMind\NexusMind\.env` (n'importe quelle session peut le faire sur demande).
6. Vérifier aussi les copies de `.env` éventuelles (sauvegardes, autre PC, `backups/`) et les y retirer.
- **Règle pour la suite :** un secret ne porte jamais le préfixe `MAIN_VITE_` (déjà écrit dans `electron/env.d.ts`). CyberSecurity cherche les motifs `sk-`, `GOCSPX-`, `RGAPI-`, `ghp_` et `github_pat_` dans `out/` et `app.asar` à chaque revue avant release.

**2. ffmpeg — Back-end, `scripts/download-ffmpeg.mjs`**
1. Récupérer le SHA-256 officiel de `ffmpeg-8.1-essentials_build.zip` publié par gyan.dev (fichier `.sha256` à côté de l'archive), le confronter à celui du zip téléchargé et l'écrire en constante (`EXPECTED_ZIP_SHA256`).
2. Après le téléchargement, calculer le SHA-256 du zip (`crypto.createHash('sha256')` en flux) et, en cas d'écart, supprimer le fichier et quitter avec une erreur. Tout cela **avant** l'extraction et avant le `spawnSync(DEST_BIN, ['-version'])` de la ligne 116.
3. Optionnel : épingler aussi le SHA-256 de `ffmpeg.exe` extrait (référence locale du 19/11 : `1a65d5b0…13f705`, à confirmer avec l'archive officielle).
4. Mettre à jour la constante à chaque changement de `TARGET_VERSION`, avec un commentaire qui indique où l'empreinte a été lue.
5. Test : un zip altéré (un octet modifié) doit faire échouer `npm install`.

**3. Textes légaux — Front-end (app), Graphic Design (site)**
1. **Front-end :** remplacer `src/legal/privacy.{fr,en}.md` et `terms.{fr,en}.md` (v0.1) par le contenu de la v0.2 du site, en gardant le jargon LoL en anglais, et retirer la mention « brouillon ».
2. **Contenu v0.3, rédigé par CyberSecurity, à valider par l'utilisateur, puis reporté par le Front-end dans l'app et par Graphic Design dans `site/src/legal/*.html`.** Ajouter :
   - la présence aux réunions (`team_session_attendance`) ;
   - les récompenses MVP / Grinder ;
   - les liens publics de rapport d'équipe (`team-report/<token>` : accessibles sans connexion, avec les noms des joueurs) ;
   - le flux calendrier `.ics` à jeton ;
   - les logos d'équipe publics ;
   - les micro-reviews (réponses et verdicts partagés avec le coach) ;
   - la conservation des données de groupe après le départ d'un membre.
3. **Bien-être (art. 9) :** le Front-end ajoute au premier check-in une case de consentement explicite au stockage et à la synchronisation, retirable dans les réglages, et le texte le mentionne. Le Back-end vérifie que retirer le consentement supprime bien les check-ins (`wellbeing_checkins`, données de prod : accord de l'utilisateur).
4. Une seule version affichée partout (« Version 0.3 · date ») ; l'Audit vérifie la cohérence app et site avant release.

**4. Secret OAuth YouTube — décision d'abord**
- **Constat du 19/11 :** le secret n'est pas inliné (`process.env`, non remplacé par electron-vite) et il est absent de `out/` et de `app.asar`. Dans l'app installée, le lien YouTube échoue faute d'ID et de secret.
- **Option A (rapide, recommandée si YouTube n'est pas prioritaire) :** masquer le bouton YouTube dans l'app installée tant que le flux serveur n'existe pas (Front-end, selon que `youtube:*` répond « non configuré »), et retirer `MAIN_VITE_GOOGLE_CLIENT_SECRET` de `.env`.
- **Option B (fonction réelle) :** le plan du § 3bis, avec les étapes suivantes.
  1. PKCE S256 dans `youtube.ipc.ts`.
  2. Edge function `youtube-oauth-exchange` (JWT Ascend vérifié par `getUser`, secret en secret Supabase, échange et rafraîchissement).
  3. Client Google en type « Application de bureau ».
  4. Renommer la variable en `GOOGLE_CLIENT_SECRET`, côté serveur seulement.
  5. Supprimer le repli `.plain` des jetons, ou au minimum avertir l'utilisateur.
  6. Tester avec un vrai compte Google.
  Le déploiement de la fonction et le secret Supabase relèvent de la production, donc de l'accord de l'utilisateur.
- **Qui :** le Chief fait trancher A ou B par l'utilisateur ; le Back-end réalise (et le Front-end pour A).

### Revue d'après mise en production de la beta.10 — 20/11/2026, vers 07:05 (lecture seule) : **OK, aucun problème critique, haut ou moyen**
- **Migrations appliquées :** de `member_staff_roles` à `roster_member_link` (4 nouvelles). Les objets en production correspondent à ce qui a été revu :
  - `staff_roles` non modifiable par les clients ;
  - `can_read_wellbeing` exige `role <> 'player'` **et** `not also_plays` ;
  - `team_session_games` a 4 politiques séparées, avec un UPDATE par colonnes sans `timeline_summary` ;
  - `link_roster_member` ne réécrit qu'un Riot ID vérifié ;
  - un dossier adverse brouillon n'est visible que du staff ;
  - la RLS est active sur **toutes** les tables de `public`.
- **Advisors :** la catégorie « exécutable par `anon` » a **disparu** : les 8 `run_*`, les fonctions de trigger, `set_captain` et `set_weekly_load_threshold`. **S19-07 est levé.** « Leaked password protection » n'apparaît plus, donc elle est **activée** : **S19-09 est levé.** Les 18 fonctions « exécutables par `authenticated` » se contrôlent toutes elles-mêmes et ont été revues.
- **Nouvelle fonction non revue jusqu'ici, `set_my_also_plays` :** vérifiée, OK. Réservée à l'owner, elle ne touche que **sa propre** ligne. La colonne `also_plays` n'est pas modifiable directement (valeur par défaut `false`, NOT NULL), et un owner qui joue est exclu de la lecture du bien-être.
- **Infrastructure :**
  - **Bot Discord : les 3 secrets sont maintenant présents** (`DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, noms seulement), et un POST non signé reçoit toujours 401. Le blocage du 19/11 est levé.
  - **Proxy Riot** (version du 20/11 à 06:07) : `RIOT_API_KEY` présent. **R2 : cycle de vie de 90 jours actif, et accès public `r2.dev` désactivé** (vérifié).
- **Web :** la web app est maintenant sur `https://app.asc3nd.app` (l'ancienne adresse `workers.dev` redirige en 301). CSP, HSTS et `X-Frame-Options` y sont servis, avec l'hôte des détourages dans `img-src`. Préflight CORS testé sur les fonctions serveur : `app.asc3nd.app` est accepté par `verify-member-puuid` et `redeem-invite`, `asc3nd.app` (le site) par `redeem-invite` seulement, et une origine tierce reçoit 403. C'est conforme.
- **Restent ouverts, en basse priorité :**
  - S19-17 résiduel : la lecture des données d'équipe n'est pas restreinte au groupe d'origine.
  - Le droit `TRUNCATE` par défaut pour `authenticated`, hors de portée de PostgREST.
  - S19-01 (Electron 33) et S19-02 (signature, reportée à environ 300 utilisateurs, décision de l'utilisateur) restent hors de cette release.

### Revue d'après déploiement — 19/11/2026, vers 17:05 (lecture seule)
**Verdict : la production correspond à ce qui a été revu. Un problème bloquant pour le bot Discord, qui n'est pas une régression.**

**Base (migrations 20261119165228 à 20261119165525, c'est-à-dire de 200000 à 270000 en local ; la 280000, rôles staff, n'est pas appliquée, comme prévu) :**
- Suppression de compte : **0** clé étrangère `NO ACTION` vers `auth.users`, `groups.created_by` en `SET NULL`, trigger `hand_over_groups_before_delete` présent. `hand_over_groups_of` contient bien la condition « autre owner » et le capitaine, et n'est pas exécutable par `authenticated`. Seuls `group_invites`, `access_invites` et `discord_guild_link_codes` restent en `CASCADE` sur l'auteur, comme prévu.
- La politique `micro_verdicts_delete_orphaned` (`coach_id is null and is_group_staff`) est en place.
- **Bien-être :** les 4 politiques prévues (INSERT conditionné au consentement), `set_wellbeing_consent` et `unlink_discord_guild` non exécutables par `anon`. Sur `wellbeing_consent_events`, `authenticated` n'a ni INSERT, ni UPDATE, ni DELETE. Il garde en revanche `TRUNCATE`, `REFERENCES` et `TRIGGER`, droits par défaut de Supabase. Ils sont inaccessibles par PostgREST, mais je recommande un `revoke truncate` par prudence, pour tout le schéma (basse).
- **puuid :** `puuid` et `puuid_status` non modifiables par `authenticated`, index unique `group_members_group_puuid_uniq` et trigger `group_members_riot_id_resets_puuid` présents.
- **S19-17 :** la branche « équipe » de `can_read_player_table` exige le rôle principal staff **et** `share_team is true`. `team_custom_games` a la RLS active, avec lecture pour les membres et écriture pour le staff.
- **Codes d'invitation :** `private.random_code` utilise `extensions.gen_random_bytes`, avec un tirage sans biais (rejet au-delà de 248 = 31×8). Il n'est pas exécutable par `anon`. Longueurs de 12 (accès) et 10 (groupe).
- **Advisors de sécurité :** **aucun nouveau constat.** `set_wellbeing_consent` et `unlink_discord_guild` apparaissent dans « exécutable par authenticated », ce qui est voulu, puisqu'elles se contrôlent elles-mêmes. S19-07 est inchangé, puisque la 280000 qui retire les `run_*` n'est pas appliquée. Il reste en plus `run_review_pending_check`, les deux fonctions de trigger, et `set_captain` et `set_weekly_load_threshold` pour `anon`.

**Fonctions serveur :**
- `verify-member-puuid` v1, `redeem-invite` v3 et `team-report` v3 sont actives, toutes en `verify_jwt = false` avec authentification interne.
- Les tests de fumée visibles dans les journaux sont conformes : 403 pour une origine non autorisée, 415 sans JSON, 400 sur des entrées invalides, 401 sans jeton, OPTIONS 204 pour l'origine autorisée.
- **`cf-connecting-ip` est présent sur 8 requêtes sur 8** (attributs des journaux), et l'avertissement « no cf-connecting-ip » n'apparaît pas. La limite par IP fonctionne donc.

**Web app :** CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` et `Permissions-Policy` servis en ligne.

**Secrets :**
- Proxy Riot : `RIOT_API_KEY` est présent. Pas de `SUPABASE_JWT_SECRET`, donc la vérification se fait par JWKS, ce qui est normal. La phase 1 du proxy n'est pas encore déployée, donc la vérification de R2 est reportée.
- Supabase : les noms des secrets des fonctions ne sont **pas lisibles** avec mes outils. Le Back-end doit vérifier `RIOT_PROXY_URL` avec `supabase secrets list` (noms seulement). Sans lui, `verify-member-puuid` répond 500 `proxy_not_configured`. `WEB_APP_ORIGINS` et `INVITE_ALLOWED_ORIGINS` ont des valeurs par défaut correctes.
- **Bot Discord : bloquant (fonctionnel).** La version déployée `9f0e4bae` **n'a aucun secret** : seule `SUPABASE_URL` est liée. `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` et `SUPABASE_SERVICE_ROLE_KEY` manquent. La version précédente `f9312e8b` (18/11) n'en avait pas non plus : **le bot n'a jamais été configuré en production**. Côté sécurité, il **échoue fermé** : un POST non signé reçoit 401, testé. Côté fonctionnement, toutes les commandes et le cron échouent.
  - **À faire par l'utilisateur**, puisque les valeurs sont des secrets : `wrangler secret put` pour les 3 secrets, dans `cloudflare/discord-bot`, **puis** réenregistrer les commandes.
  - La clé service_role ne doit être posée **que** comme secret du worker, jamais dans `wrangler.toml`.

**« Leaked password protection » désactivée — avis :** à activer, en priorité basse à moyenne. L'app propose un mot de passe facultatif, en plus de la connexion par code e-mail. La règle actuelle, `isAcceptablePassword` (longueur, une lettre et un chiffre), laisse passer des mots de passe connus des fuites, comme « azerty123 ». La vérification contre HaveIBeenPwned (k-anonymat : seuls 5 caractères du hash partent) les refuse sans coût pour l'utilisateur. Réglage : Authentication → Policies → Password. **À vérifier :** Supabase réserve cette option aux offres payantes. Si le projet est en offre gratuite, la compenser par une longueur minimale de 10 et une liste locale des mots de passe les plus courants dans `isAcceptablePassword` (Back-end).

### Revues de livraisons

#### beta.20 — revue groupée (21/11, arbre non commité, lecture seule) : **non bloquant, 2 correctifs de textes légaux avant de publier le site**
*`docs/DECISIONS.md` du 20 et du 21/11 relu.*
1. **YouTube :** déjà revu (section suivante), et rien n'a changé depuis. Le secret n'est jamais journalisé, il n'y a pas de repli en clair, la file d'envoi est vidée quand on désactive ou se déconnecte, et `youtube:upload-clip` passe par `isMediaPathAllowed`.
2. **Politique de confidentialité du site (non déployée) :** le § 4 bis (une seule autorisation, l'upload automatique, ce qui est gardé et où), le § 6 (conditions et règles de Google, cache R2) et le § 8 (révocation) correspondent au code.
   - **Manque 1 :** la phrase sur **la voix de tiers** dans les parties publiées automatiquement, avec le micro activé par défaut et le vocal capté. C'est ma remarque moyenne du lot YouTube : à ajouter au § 4 bis et aux conditions d'utilisation, à côté de la phrase sur les réunions.
   - **Manque 2 :** **litterbox.catbox.moe** n'est cité nulle part (voir le point 3).
3. **Clips :**
   - **`clip:delete`** ne supprime que des fichiers situés **dans** les dossiers d'enregistrement de l'utilisateur ou dans le dossier de l'enregistrement d'origine (`isInsideDirs`, qui normalise le chemin). Un chemin enregistré ailleurs est ignoré, et l'identifiant est validé par zod. OK.
   - **Lien temporaire (`share:upload-temp`)** : extension vidéo, existence du fichier et `isMediaPathAllowed` sont vérifiés, la durée est limitée à 1, 12, 24 ou 72 h, et l'URL renvoyée doit être en `https`. Mais **le clip est envoyé à un hébergeur tiers anonyme** : il devient lisible par **quiconque a le lien**, jusqu'à 72 h, et **il ne peut pas être supprimé avant l'échéance**. **Correctifs :**
     - ajouter catbox/litterbox au § 6 de la politique (destinataires), avec ce qu'il advient du fichier ;
     - afficher un avertissement d'une ligne dans l'app au moment de créer le lien (« lien public, actif jusqu'à X h, impossible à retirer avant »).
   - **Discord en un clic :** il passe par `share:send-file-to-discord`, qui exige une URL de webhook validée (`discordWebhookUrl`) et un fichier autorisé. OK.
4. **Nouvelles tables et IPC :**
   - `UserPreference` est synchronisée, avec `userId` réécrit en local et une clé naturelle `(userId, key)`. Elle n'est **pas** dans les tables lisibles par d'autres membres (`can_read_player_table`), donc elle reste privée.
   - `prefs:set-player-filters` est validé par zod.
   - `mistake:retag`, `mistake:dismiss-detected` et `mistake:undo-correction` passent tous par zod : identifiants, `reason` dans une liste fermée, `note` limitée à `CORRECTION_NOTE_MAX`, `strict()`.
   - Micro-review : `customLabel` de 60 caractères, `reason` en regex, `note` et `myReasons` de 1 000 au plus.
   - Objectifs personnalisés : un tableau validé par zod, avec un nombre maximum.
   - Review courte : `game:mark-short-review`, avec un id et une source dans une liste fermée.
   - La migration Prisma `20261121010000` n'a pas de point-virgule dans ses commentaires. OK.
5. **`site/worker.ts` :** le fichier de vérification Google n'est servi **qu'à ce chemin exact**, avec un contenu fixe et sans autre logique. C'est sans risque. Il ne reçoit pas les en-têtes de sécurité du site, ce qui est sans enjeu pour un texte statique. Le site répond bien en 200.

#### Lot YouTube : client « Desktop app » + PKCE et upload automatique (21/11, non commité, lecture seule) : **OK, 1 remarque moyenne (vie privée) et 2 basses**
*`docs/DECISIONS.md` du 21/11 relu : client « Desktop app » et secret livré dans le build (remplace l'option A), upload automatique au choix du joueur, lancement de la vérification Google. La revue s'y conforme.*
- **Identifiants au build :** seules `MAIN_VITE_GOOGLE_CLIENT_ID` et `_SECRET` sont nouvellement inlinées. Vérifié : le code ne lit `import.meta.env` que propriété par propriété (`SUPABASE_URL`, `ANON_KEY`, `RIOT_PROXY_URL`, `WEB_URL`, `GOOGLE_CLIENT_ID` et `_SECRET`), jamais l'objet entier. La clé OpenAI encore présente dans `.env` **n'est donc pas embarquée**. `release.ps1` n'affiche que « on » ou les **noms** manquants, et l'erreur devient `YOUTUBE_UNAVAILABLE`, sans nom de variable. Pour un client « Desktop app », le secret n'est pas confidentiel pour Google, et PKCE et `state` sont en place : c'est conforme à la décision.
  - **Règle de revue mise à jour :** la recherche de secrets dans `out/` et `app.asar` doit maintenant **tolérer `GOCSPX-`** (attendu) et continuer à refuser `sk-`, `RGAPI-`, `ghp_` et `github_pat_`.
- **Écarts de la revue précédente :** tous levés.
  - le repli en clair des jetons est supprimé (`ENCRYPTION_UNAVAILABLE`) et un ancien fichier `.plain` est effacé sans être lu ;
  - les textes décrivent maintenant les trois envois et l'endroit où chaque lien est gardé ;
  - le § 2.2 ajoute l'accord des participants à une réunion.
- **Upload automatique :**
  - désactivé par défaut, non répertorié par défaut ;
  - la file ne contient que des identifiants et est relue de façon stricte (`parseQueue`), avec une écriture atomique (`.tmp` puis `rename`) ;
  - un envoi à la fois, avec revérification de l'URL déjà présente, donc pas de double envoi ;
  - `isMediaPathAllowed` est appliqué à chaque fichier ;
  - désactiver ou se déconnecter coupe l'envoi en cours (`AbortController`) et vide la file ;
  - les réunions ne sont jamais envoyées automatiquement ;
  - le quota est respecté (attente de la remise à zéro du Pacifique) avec un backoff plafonné. C'est conforme.
- **Remarque moyenne (vie privée) : le son des parties enregistrées.** Le micro est **activé par défaut** depuis le 19/11, et la capture peut inclure le son du bureau, donc la voix des coéquipiers sur Discord. Avec l'upload automatique, **chaque partie part sans relecture**, éventuellement en **public**. La voix de tiers peut donc être publiée sans leur accord.
  - **Correctifs proposés :**
    1. à l'activation, un avertissement clair : « tes parties partent avec leur son, ta voix et celle de ton vocal si elles sont captées » ;
    2. si le joueur choisit **public**, une confirmation supplémentaire ;
    3. une option « envoyer sans le son du micro » ou « sans audio », si c'est faisable (Front-end et Back-end).
  - Côté textes : ajouter aux conditions d'utilisation (§ 2.2) la même phrase que pour les réunions : le joueur est responsable des voix d'autres personnes présentes dans ses parties publiées.
- **Remarques basses :**
  1. Le réglage est une **UserPreference synchronisée** : l'activer sur un PC l'active sur tous les PC du compte, y compris pour les parties enregistrées ailleurs. À dire dans l'écran des réglages (« s'applique à tous tes PC »), ou à garder local.
  2. Le client OAuth étant public, n'importe qui peut s'en servir **avec ton quota** YouTube. Risque accepté par la décision ; à surveiller dans la console Google, dont les alertes de quota sont gratuites.

#### `docs/GOOGLE_YOUTUBE_VERIFICATION.md` § 2 et § 3 face au code (21/11, lecture seule) : **4 écarts, dont 2 bloquants pour la vérification Google**
**Conforme au code :**
- scope unique `youtube.upload` (`YOUTUBE_SCOPE`) ;
- PKCE `S256` avec `state` vérifié au retour ;
- révocation `oauth2.googleapis.com/revoke` à la déconnexion, puis effacement des jetons ;
- aucune lecture de la chaîne (`channelName = null`) ;
- envoi direct du PC vers YouTube, `unlisted` par défaut ;
- seuls des fichiers sous les dossiers autorisés peuvent être envoyés (`isMediaPathAllowed`).

**Écarts :**
1. **Bloquant : la fonction est désactivée dans l'app installée.** `youtubeUploadAvailable()` renvoie `!app.isPackaged && …` (décision « option A » du 19/11 : pas de secret OAuth dans un build). Les § 3.1 à 3.5 décrivent une fonction **publique** que les testeurs de Google ne pourront pas utiliser. Il faut d'abord trancher **comment** l'activer, ce qui est une décision de l'utilisateur :
   - soit un client OAuth Google de type « Application de bureau », pour lequel Google considère le secret comme non confidentiel quand PKCE est en place (c'est le cas maintenant), ce qui revient à revoir l'option A ;
   - soit l'échange de jetons par une Edge Function.
   Tant que ce n'est pas tranché, la demande de vérification n'a pas d'objet.
2. **Bloquant : « rien côté serveur » et « seulement l'adresse du clip, sur le PC » sont faux.** Il existe **3** chemins d'envoi, et non un seul :
   - `youtube:upload-clip` : l'URL est gardée sur `Clip`, qui est local et non synchronisé. C'est conforme au texte ;
   - `youtube:upload` depuis `RecordPlayerPage` : la **partie entière** est envoyée, pas un clip de 2 min au plus, et l'URL est enregistrée sur `Recording.youtubeUrl`. Or `Recording` est **synchronisé** (`SYNC_TABLES`, seuls `filePath` et `thumbnailPath` restent locaux) : l'URL part donc dans `sync_records` et devient lisible par le staff quand les reviews sont partagées ;
   - `youtube:upload` depuis `ReviewRecorder` (session d'équipe) : l'URL va dans **`team_session_reviews.youtube_url`, dans le cloud**, et elle est visible de tout le groupe. Cette vidéo de réunion contient aussi **la voix et l'image d'autres membres**.
   Il faut donc soit corriger le code (ne garder les URL qu'en local et ne pas les synchroniser), soit **corriger les textes**. Les textes justes sont proposés ci-dessous.
3. **Jetons chiffrés : pas toujours.** Si `safeStorage` n'est pas disponible, les jetons sont écrits **en clair** (`youtube-tokens.json.plain`). **Correctif recommandé :** supprimer ce repli et refuser de connecter YouTube avec un message clair. Sinon, ajouter au texte « chiffrée quand Windows le permet ».
4. **§ 3.1 « clips de 2 minutes au plus, un clip à la fois » :** c'est inexact tant que l'envoi de la partie entière et celui de la réunion d'équipe existent. Il faut décrire les trois usages, ou retirer les deux autres.

**Textes corrigés si les trois envois sont gardés tels quels** (à reporter dans le § 2.1 et le § 3.3 et 3.4, FR et EN) :
- FR : « Ascend garde l'adresse de la vidéo publiée. Pour un clip, elle reste sur votre PC. Pour la vidéo d'une partie, elle est synchronisée avec votre compte Ascend et visible du staff de vos groupes si vous partagez vos reviews. Pour l'enregistrement d'une réunion d'équipe, elle est visible des membres du groupe. Ascend ne garde aucune autre donnée YouTube. »
- EN : « Ascend keeps the link of the published video. For a clip, it stays on your PC. For a full game video, it is synced with your Ascend account and visible to your groups' staff if you share your reviews. For a team meeting recording, it is visible to the group's members. Ascend stores no other YouTube data. »
- § 3.3 et 3.4 : remplacer « No YouTube data is stored on Ascend servers » par « Only the uploaded video's link is stored, as described in the privacy policy; no other YouTube data is stored on Ascend servers ». Remplacer aussi « Ascend servers never hold YouTube data » par la même précision.
- **Réunions d'équipe :** ajouter que la personne qui publie doit avoir l'accord des participants, enregistrés en voix et en image (§ 2.2, conditions d'utilisation).

#### beta.19 — lot de performances (`docs/AUDIT_PERF_2.md`, gains 0 à 4, 6, 7 et 9 ; arbre non commité, lecture seule) : **non bloquant, 1 correctif bas**
1. **`perfLog.ts` :** inactif sauf si `NEXUSMIND_PERF_LOG=1` (`perfLogEnabled`). Il écrit dans `userData/logs/perf.log` : **le nom du canal IPC seulement** (aucun argument), et pour le réseau un **libellé** tiré de `labelForUrl`.
   - Supabase : 3 ou 4 segments, du genre `/rest/v1/<table>`, `/functions/v1/<nom>`, `/storage/v1/object/<bucket>`. Le jeton de `team-report` et le chemin `<uid>/…` du stockage sont coupés.
   - Riot : `:id`, `:match`, `:name` et `:tag` remplacent le puuid, le matchId et le Riot ID.
   - Les autres hôtes : l'hôte seul.
   - **La query n'est jamais écrite** (seul `pathname` est utilisé), et aucun en-tête ni jeton non plus. C'est conforme.
   - **Correctif (bas) :** `decodeURIComponent(segments[i])` peut lever une exception sur un `%` mal formé. Comme `labelForUrl` est appelé **avant** `baseFetch`, l'appel réseau échouerait alors quand le journal est actif. Il faut entourer ce décodage d'un `try`, en gardant le segment brut, ou appeler `labelForUrl` dans un `try` (Back-end).
2. **Cache du rendu (`queryCache` et `dropCachedData`) :** il est entièrement vidé quand le profil local **ou** le compte cloud change (`scopeChanged`, sans effet au premier chargement). Les clés sont séparées par utilisateur et par groupe. Un autre profil ou un autre compte ne peut pas voir ces données : c'est conforme.
3. **`collabPersist.ts` :** il enregistre dans le `localStorage` la liste des groupes **avec leurs membres** (noms, Riot ID, rôles), **rattachée à l'uid** : `savedGroupsFor` ne la rend qu'au même uid. Elle est effacée à la déconnexion, au changement de compte et quand le cloud est absent (`useCollab.ts`). Le contenu est **acceptable** : ce sont les données déjà affichées, sans jeton ni bien-être. À noter : sur un navigateur partagé, cette liste reste jusqu'à la déconnexion, comme la session Supabase elle-même.
4. **`collab:bootstrap` :** validé par zod (sans argument). Il ne renvoie que `{ status (configured, user, riotMode, lastBackupAt), groups }`, soit **exactement** l'équivalent de `cloudStatus` et `listMyGroups`, sans rien de plus. Une panne d'authentification renvoie `AUTH_UNREACHABLE`, sans passer pour une déconnexion.
5. **`matchIdsCache.ts` :** `userData/match-ids-cache.json`, avec des clés par puuid et des listes d'identifiants de matchs. Ce sont des identifiants Riot publics, stockés localement, sans jeton. Acceptable. **`backupRotationCore.ts` :** il ne supprime que des noms lus par `readdirSync` **dans** `<db>/backups` (pas de séparateur possible), qui correspondent à `^nexusmind-.+\.db(\.gz)?$`. Les fichiers `-keep` sont **exclus** (`.db` et `.db.gz`), et le plus récent de chaque type n'est jamais compressé. La copie manuelle de `D:\Nexusmind\backups-manuels` (décision du 20/11) est hors de portée. C'est conforme.
6. **`staffDashboardCore.ts` :** la sélection est limitée à `user_id`, `table_name` et à des champs `data->x` **constants** (`DASHBOARD_FIELD_NAMES`), au lieu de la colonne `data` entière. C'est une réduction de ce qui transite. La RLS est inchangée, et aucune migration n'est jointe à ce lot.

#### beta.15 (suite) — Realtime (`20261120140000_realtime_publication`), `realtimeCore`, hub desktop, correctifs demandés (20/11, lecture seule) : **OK, 2 remarques basses**
- **Publication :** les 6 tables (`notifications`, `team_sessions`, `calendar_events`, `calendar_event_responses`, `announcements`, `team_session_reviews`) sont ajoutées à `supabase_realtime` de façon idempotente. Vérifié en production : aucune n'est encore publiée, et toutes sont en `REPLICA IDENTITY DEFAULT`, donc l'ancien contenu d'une ligne n'est **pas** diffusé. **Rollback :** chaque table est retirée de la publication, de façon idempotente. OK.
- **Isolement entre utilisateurs et entre groupes :**
  - Les `postgres_changes` de Supabase appliquent **la RLS de SELECT de chaque table** avec le JWT de l'abonné. Un client ne reçoit donc que les lignes qu'il pourrait lire. Même un client modifié qui s'abonnerait à `group:<autre groupe>` ne recevrait rien de ce groupe.
  - Les filtres de canal (`user_id=eq.<uid>` pour les notifications, `group_id=eq.<gid>` pour les groupes) sont une économie de bande passante **en plus** de la RLS, pas la protection elle-même. Les identifiants sont vérifiés par `SAFE_ID`.
  - **Seuls INSERT et UPDATE sont écoutés.** Les DELETE, que la RLS ne filtre pas, sont exclus comme il le faut. Le hub n'écoute ni `broadcast` ni `presence`, donc un message injecté sur un canal public est ignoré.
- **Correctifs demandés :**
  - `account:regions` et `account:set-region-mode` passent maintenant par `validatedHandle` : options `strict()`, schémas d'identifiant de compte et de mode de région. **Levé.**
  - Le rattrapage passe tout entier par `withRiotPriority('background', …)`, et `riotTransport` envoie `x-nxm-priority: background`. **Levé.**
- **Remarques (basses) :**
  1. **Rollback de la carte de membre écrasé :** `supabase/rollback/20261120140000_rollback.sql` contient maintenant le rollback **Realtime**. Celui de `member_card_champion` (migration renommée `20261120080011`) **n'existe plus**. Il faut le recréer sous `supabase/rollback/20261120080011_rollback.sql` : retrait du droit, de la contrainte et des deux colonnes (Back-end).
  2. **Canaux publics :** dans les réglages Realtime du projet, activer « canaux privés seulement » (Realtime Authorization) **si** aucun écran n'utilise de broadcast. C'est une défense en profondeur, sans effet sur les `postgres_changes`. Une ligne de `team_session_reviews` peut contenir une longue transcription : surveiller la taille des messages (fonctionnel).

#### beta.15 — proxy (`region/by-game`), log du client LoL, région des comptes, rattrapage des parties (20/11, lecture seule) : **OK, 2 remarques basses**
*Registre `docs/DECISIONS.md` relu (lot de scalabilité). Rien de contraire.*
- **Proxy :** une seule route est ajoutée, `^/riot/account/v1/region/by-game/lol/by-puuid/{ID}$` : jeu fixé à `lol`, identifiant en regex stricte, GET seulement, avec un libellé fixe pour les métriques. Elle n'a **aucune règle de paramètres**, donc toute requête avec query est refusée (400). L'authentification, la limite par compte et le budget global restent inchangés. Le déploiement est sans risque, mais reste un déploiement en production, donc soumis à l'accord de l'utilisateur.
- **Log du client LoL (`gameLog`) :**
  - Il lit les dossiers déclarés dans `C:/ProgramData/Riot Games/RiotClientInstalls.json` (clés contenant « league of legends ») et `C:/Riot Games/League of Legends`, sous `Logs/GameLogs`.
  - Il ne retient que les dossiers nommés `AAAA-MM-JJTHH-MM-SS`, et ne lit que les **64 premiers Ko** d'un fichier `*_r3dlog.txt`, sans rien exécuter ni écrire.
  - **Pas d'injection possible :** la plateforme passe par une liste blanche (`normalizePlatform`) et l'identifiant de partie par `\d{5,15}`. Le `matchId` obtenu est revérifié par la regex du proxy.
- **`setAccountRegionMode` :** la région n'est acceptée que si elle vaut `auto` ou figure dans la liste blanche `PLATFORMS`, sinon `BAD_REGION`. Le compte doit être **l'un des siens** (`ownAccounts()`), sinon `NOT_FOUND`. ⚠️ Contrairement à ce qu'annonçait le Chief, **ce n'est pas du zod** : `account:regions` et `account:set-region-mode` sont des `ipcMain.handle` bruts. La validation faite dans le code est suffisante, mais il vaudrait mieux les passer en `validatedHandle`, par cohérence avec S19-11.
- **`gameCatchUp` :**
  - Il ne traite que l'utilisateur **actif** et **ses** comptes liés. Une partie n'est importée que si l'un de **ces** puuid y figure (`pickCatchUpMatches`, puis `extractPlayerStats(data, pick.puuid)`) : **pas de fuite d'un compte à l'autre**.
  - Les appels sont bornés : 20 identifiants par compte, 30 logs au plus, sur une fenêtre de `CATCH_UP_DAYS`. Les parties déjà connues ou en cache local sont ignorées, et un seul rattrapage tourne à la fois (`running`).
- **Remarques (basses) :**
  1. **Pointe d'appels Riot au rattrapage :** avec 3 comptes, on peut atteindre environ 90 lectures de matchs d'un coup. Le cache R2 du proxy et la limite de 20 par minute les bornent, mais elles passent en priorité **interactive**, donc dans la réserve de tout le monde. **Suggestion :** envoyer `x-nxm-priority: background` pour le rattrapage, ou espacer les appels (Back-end).
  2. **Passer `account:*` en `validatedHandle`** (voir plus haut).

#### beta.14 — relances de réponse, DM du bot, dossiers publiés, LFT solo, API Organisation (20/11, lecture seule) : **OK, 2 remarques basses**
*Registre `docs/DECISIONS.md` relu : dashboard « Organisation » du manager validé, objectif d'une app scalable, Supabase Pro conservé.*
- **`remind_event_responses` :**
  - definer avec `search_path` vide, rien pour `anon`. Elle exige `can_edit_calendar` sur le groupe **de l'événement**, et un événement à venir.
  - Les destinataires sont pris **uniquement parmi les membres de ce groupe**. La liste `p_user_ids` n'est qu'un filtre posé **en plus** de cette contrainte : passer l'uuid de quelqu'un d'un autre groupe ne lui envoie rien.
  - Elle exclut ceux qui ont déjà répondu et l'appelant lui-même, applique un délai de **6 h** par personne et par événement, et plafonne à **50 personnes**.
  - `event_response_reminders` est en RLS, lisible seulement par les éditeurs du calendrier du groupe, sans aucune écriture directe.
  - **Le rollback** supprime la fonction, la table et les notifications de ce type, puis remet la liste précédente. OK.
  - **Un membre ne peut ni relancer un autre groupe, ni lire ses données.**
- **DM `event_response_reminder` :** il est ajouté à `DIRECT_MESSAGE_TYPES`, dans le même circuit que les autres DM : chaque destinataire ne reçoit que sa notification, une seule fois. Le texte ne contient que le titre et l'heure de l'événement, sans donnée d'un tiers.
- **`listPublishedDossiers` :** filtrée sur `group_id` **et** `status = 'published'`, en plus de la RLS de `opponent_dossiers` (brouillon visible du staff seulement). Un joueur ne voit donc que les dossiers **publiés de son groupe**, et même le staff n'y reçoit pas les brouillons. Les lectures annexes (scouting, auteurs, parties) sont toutes filtrées sur ce même `group_id`. L'IPC est validé par zod (uuid).
- **`lft:my-solo` :** il ne lit que l'utilisateur local **actif** et son propre puuid. Le rang est demandé via le proxy, sur un endpoint de la liste blanche, avec la limite par compte. `force` passe outre le cache local, mais reste borné par cette limite (20 par minute). L'IPC est validé par zod.
- **`organisationWeb.ts` et `myTeam` :** ils utilisent le même cœur que le desktop, sous la RLS, sans clé service.
- **Remarques (basses) :**
  1. **Titre d'événement relayé tel quel par le bot en DM.** Un éditeur du calendrier (capitaine compris) peut y mettre un lien, que le bot d'Ascend enverra en message privé à toute l'équipe. Cela peut servir à du hameçonnage, avec la confiance qu'on accorde au bot. **Correctif :** neutraliser les liens et la mise en forme du titre dans `directMessageText` (balises de code ou échappement), et envoyer avec `allowed_mentions: { parse: [] }`.
  2. **Plafond de 50 appliqué avant le délai :** s'il y a plus de 50 non-répondants et que les 50 premiers ont déjà été relancés, les suivants ne le sont jamais. C'est fonctionnel, sans enjeu de sécurité (trier par `sent_at nulls first`).

#### beta.13 — `170000_team_session_prep`, `180000_team_sessions_hardening`, API de préparation et « Mon équipe », médias, dispos (20/11, lecture seule) : **OK, 4 remarques basses**
*Registre `docs/DECISIONS.md` relu : « l'analyste peut fixer les objectifs de session » et « préparer les sessions à l'avance » sont bien respectés.*
- **170000 :**
  - `can_prepare_session` exige une session **`scheduled`** et que l'appelant soit gestionnaire **ou** staff, analyste compris, comme décidé. Elle est en definer avec `search_path` vide, et rien n'est accordé à `anon`.
  - Les 3 nouvelles tables ont la RLS : lecture pour les membres du groupe de la session, écriture par `can_prepare_session`. Pour les objectifs individuels, le `player_id` doit **être membre de ce groupe** : un seul cible ne peut pas venir d'un autre groupe.
  - Les longueurs et cardinalités sont bornées : 2 objectifs, une note de 140 caractères, un message de 280, 5 picks ou bans, des notes de 4 000.
  - **Le rollback** remet la politique d'origine et supprime les 3 tables. Les préparations sont alors perdues, ce qui est attendu.
- **180000 :**
  - L'UPDATE de `team_sessions` est limité à `status`, `responsible_user_ids`, `queue_filter`, `started_at` et `ended_at`. Ma remarque 2 de la revue précédente est **levée**.
  - Le trigger `recording_file_name_only` ne garde que le nom de fichier, à l'insertion comme à la mise à jour, et les lignes existantes sont nettoyées. Ma remarque 3 est **levée**.
- **API :**
  - Les IPC `session-prep:*` et `my-team:*` sont tous validés par zod (uuid, tailles maximales, `max(200)` et `max(100)` sur les listes).
  - Les fonctions `myTeam*` sont filtrées par `uid` et les groupes de l'utilisateur, sous la RLS. `sessionPrep*` passe par la RLS et la RPC `can_prepare_team_session`.
  - Le web reprend le même cœur.
- **`resolveMediaFile` :** un nom contenant un séparateur n'est rendu complet que si `isMediaPathAllowed` l'accepte, sinon seul le nom du fichier est gardé. Un nom simple n'est cherché **que dans les dossiers autorisés** (`join(root, name)`), et `.` et `..` ne sont pas joints. Le lecteur `nxm:` revérifie l'extension et le dossier. Il n'y a pas de traversée de dossiers à partir d'un nom venu du cloud.
- **`availability:set-rule` :** validé par zod (jour 0 à 6, heures). `user_id` prend `auth.uid()` par défaut, vérifié en production. Pas d'écriture pour le compte d'un autre via cette API.
- **Remarques (basses, sans bloquer) :**
  1. **`attachSharedDraft`** copie un `team_drafts` lisible par l'appelant sans vérifier qu'il appartient **au même groupe** que la session. Un staff membre de deux groupes peut ainsi copier une draft du groupe B dans une session du groupe A, et la rendre visible des membres de A. **Correctif :** comparer `team_drafts.group_id` au groupe de la session, ou faire vérifier ce point par la base.
  2. **Politiques `availability_rules_write` et `availability_exceptions_write`** (antérieures à cette version) : `user_id = auth.uid() OR can_edit_calendar(group_id)` **ne vérifie pas que l'auteur est membre du groupe**. Un utilisateur connecté peut donc créer ses propres dispos dans un groupe dont il ne fait pas partie, ce qui pollue le planning. Cela ne donne aucun accès en lecture. **Correctif :** ajouter `private.group_role(group_id) is not null` au `with check` (migration de production, sur accord).
  3. Les éléments de `kpi_ids` et le contenu de chaque pick ou ban (JSON) ne sont pas bornés en taille. Seul le staff peut écrire, donc le risque est un simple abus de stockage. Suggestion : un `check` sur la longueur des éléments.
  4. **Rollback de la 180000 :** `grant update on team_sessions to anon, authenticated` rouvre aussi l'UPDATE au niveau de la table pour **`anon`**. La RLS le bloque, mais il vaut mieux limiter ce rollback à `authenticated`.

#### `20261120150000_team_session_objective_results` et `20261120160000_team_session_auto_lifecycle`, rollbacks et API de l'historique (20/11, lecture seule) : **OK, 3 remarques basses**
- **Verdicts des objectifs :**
  - Table en RLS, lecture réservée aux membres du groupe de la session. **Aucune écriture directe** (`revoke all`, puis seulement `grant select`).
  - L'écriture passe par la RPC `set_team_session_objective_result` : definer, `search_path` vide, `can_manage_session` sur le groupe **de la session**, et la partie doit appartenir **à cette session**. Rien pour `anon`.
  - `unique nulls not distinct` est pris en charge par la production, en PostgreSQL 17.6.
- **Cycle de vie automatique :**
  - Toutes les nouvelles fonctions (`run_team_session_lifecycle`, triggers, `team_session_is_empty`) sont en definer avec `search_path` vide, et leur exécution est **retirée à `public`, `anon` et `authenticated`**. Le job `pg_cron` s'exécute en `postgres` et n'est pas appelable par l'API.
  - Chaque mise à jour est **jointe sur `calendar_event_id`**. Le responsable est choisi parmi les membres **du groupe de la session** : soit le créateur de l'événement s'il est encore membre, soit les owners. Il n'y a **pas de fuite entre groupes**.
  - Une session détachée garde son `group_id`, et `team_session_group()` lit `team_sessions.group_id`. La RLS de toutes les tables de session continue donc de s'appliquer.
- **API de l'historique :** les IPC sont validés par zod (uuid, filtres, `objectiveId`, booléen nullable). Les lectures sont toutes filtrées par `group_id`, `session_id` ou `event_id` et passent par la RLS. Le web utilise le même cœur, et aucune clé service n'est utilisée.
- **Remarques (basses) :**
  1. **Rollback destructif :** `delete from team_sessions where calendar_event_id is null` supprime **les sessions détachées et, en cascade, leurs parties, reviews, feedbacks et présences**. Avant de l'exécuter, faire une sauvegarde de ces tables, ou rattacher ces sessions plutôt que de les supprimer.
  2. **`team_sessions` est modifiable sur toutes ses colonnes par un gestionnaire** (politique `team_sessions_write`, UPDATE au niveau de la table). Un manager de deux groupes peut déplacer une session de l'un à l'autre en changeant `group_id`, ou réécrire les copies `event_*` d'une session détachée. C'est un problème d'intégrité, pas une fuite, et il est antérieur à cette migration. **Correctif :** un `grant update` par colonnes qui exclut `group_id`, `calendar_event_id` et `event_*` (Back-end, migration de production sur accord).
  3. **`recording_local_path`** (dans `team_session_reviews`, lu par l'historique) contient le chemin local du PC qui a enregistré, par exemple `C:\Users\<nom>\…`. Il est visible des membres du groupe. Conseil : ne garder côté cloud que le nom du fichier, ou ne pas le lire dans l'historique (Back-end, basse).
- `objective_id` n'est pas vérifié par rapport à `team_session_objectives` : c'est fonctionnel, sans enjeu de sécurité.

#### `20261120140000_member_card_champion.sql`, son rollback et l'API des cartes (20/11, lecture seule) : **OK**
- **Écriture limitée à soi :** `grant update (card_champion, card_skin_num)` donne l'accès **par colonnes**, à `authenticated` seulement. La politique existante `members_update_self_profile` limite déjà l'UPDATE à `user_id = auth.uid()` et interdit de changer de rôle. Un membre ne modifie donc que **ses** lignes, sans toucher à son rôle ni à ses droits.
- **Valeurs bornées côté serveur :** le `check` exige les deux colonnes nulles ensemble, ou un `card_champion` de 1 à 40 caractères `[A-Za-z0-9]` avec `card_skin_num` entre 0 et 999. Il n'y a donc aucun moyen d'injecter un chemin ou une URL dans `cutoutUrl()` (hôte fixe, puis `${id}_${num}.webp`).
- **Côté client :**
  - le desktop valide par zod (`championId` et une locale en `enum`) ;
  - `listCardSkins` revérifie l'identifiant, valide la version DDragon par regex et n'appelle que deux hôtes fixes (ascend-cutouts et ddragon) ;
  - `setMyCardChampion` filtre sur `user_id = uid`, en plus de la RLS ;
  - le web passe par le même cœur, avec la CSP déjà à jour.
- **Visibilité :** le champion et le skin choisis sont lisibles par les membres des groupes de l'utilisateur. C'est une donnée de présentation, sans enjeu de confidentialité.
- **Rollback :** il retire le droit, la contrainte et les deux colonnes, dans le bon ordre. Les choix de cartes sont perdus, ce qui est attendu. Les anciennes versions de l'app tolèrent l'absence des colonnes (lecture en mode dégradé).
- **Mineur :** le serveur ne vérifie pas que le skin choisi est bien hébergé. Au pire, l'image de la carte ne s'affiche pas, sans risque de sécurité.

#### Avant la prochaine mise en production (20/11) — migrations 290000, 20261120120000, 20261120130000, pool publié, détourages : **OK, 2 correctifs avant la production**
**RPC (droits et `search_path`) :**
- `set_opponent_dossier_status`, `save_match_event`, `update_match_detail` et `link_roster_member` sont toutes en `SECURITY DEFINER`, avec `search_path` vide, `auth.uid()` contrôlé et l'exécution retirée à `public` et `anon`.
- Les fonctions de trigger et les fonctions privées ont leur exécution retirée aux clients.
- Les fonctions `immutable` de validation (`is_champion_list`, `is_pick_list`, `opponent_key_of`, `match_kind_of`) ne lisent aucune table.

**Tables :**
- **`draft_log` :** lecture par les membres. Insertion par le staff avec `created_by = auth.uid()`. UPDATE limité **par colonnes**, sans `group_id` ni `match_id`. Tout est retiré à `anon`. Les contraintes bornent chaque champ JSON (5 picks, 40 caractères…).
- **`opponent_dossiers` :** le **brouillon n'est visible que du staff**, et seul un dossier `published` est lisible par les joueurs. L'insertion est forcée en `draft`. Le statut ne change **que** par la RPC (`status` et `published_at` sont hors du `grant update`). L'instantané est limité à 64 Ko.
- **`team_scouting.opgg_url` :** liste blanche d'hôtes ancrée, ce qui refuse `op.gg.evil.com`, `evil-op.gg` et `op.gg@evil.com`. La règle est vérifiée dans le `check` **et** dans la RPC.
- **`save_match_event` :**
  - Elle exige `can_edit_calendar`, donc staff, manager ou capitaine. Les participants sont filtrés sur les membres du groupe, l'événement modifié doit appartenir à `p_group`, et les adversaires sont validés (5 au maximum, rôles uniques).
  - **Élargissement de droit, à acter :** un **capitaine ou un manager peut maintenant créer et modifier des scrims**, alors que la politique `scrims_insert_staff` le réservait au staff. C'est cohérent avec « les scrims passent par le Planning ». Mais un capitaine peut aussi créer des entrées `team_scouting` et des rosters adverses (sans écraser l'existant, `v_may_overwrite`).
- **`update_match_detail` :** liste blanche des clés. `opponentRoles` ne modifie que les rosters **du scouting de ce scrim**. `draftIds` n'est pas validé en uuid, mais une valeur invalide fait échouer l'UPDATE, sans fuite possible puisque la lecture passe par la RLS.
- **`link_roster_member` :** réservé au staff. La ligne doit être une ligne **de l'équipe** (`scouting_id is null`) du même groupe, et le membre doit appartenir au groupe. Ses autres liaisons sont retirées. Le **puuid n'est copié que s'il est `verified`**.
  - **Usurpation :** un joueur ne peut **pas** se lier lui-même. `team_rosters` ne peut être écrit que par le staff, et `publishMyPool` n'écrit que sur la ligne où `user_id = auth.uid()` (politique `team_pool_write`). Le risque se limite à une erreur du staff.
  - **Réserve (basse) :** l'`ign` et le `tag_line` de la ligne sont **écrasés par le Riot ID déclaré** du membre, même quand son `puuid_status` n'est pas `verified`. Un membre qui a déclaré le Riot ID d'un autre, puis qui est lié par le staff, fait calculer les stats de la ligne sur ce compte. **Correctif :** ne réécrire l'`ign` et le `tag` que si `puuid_status = 'verified'`, et sinon garder ceux de la ligne et l'indiquer à l'interface.
- **`publishMyPool` et `poolImport` :** l'écriture est limitée à sa propre ligne (RLS), avec effacement puis réinsertion. La lecture est ouverte aux membres du groupe. Les rôles et tiers sont filtrés côté client, et les contraintes de la table s'appliquent. OK.

**Correctifs avant la production :**
1. **`timeline_summary` modifiable par tout membre (S19-13 aggravé).** La politique `team_session_games_write` (ALL) n'exige que d'être membre du groupe. Un joueur peut donc réécrire le résumé de timeline de n'importe quelle partie de session (64 Ko de JSON), ainsi que les parties elles-mêmes. Or ces analyses sont lues par le staff et par le dossier adverse : leur **intégrité** compte. **Correctif (Back-end, dans la migration 290000) :**
   - remplacer la politique par une lecture pour les membres, une INSERT pour les membres avec `reported_by = auth.uid()`, et UPDATE et DELETE pour `can_manage_session` ou l'auteur de la ligne ;
   - plus un `grant update (…)` par colonnes qui **exclut** `timeline_summary` ;
   - celui-ci passe par une RPC réservée au staff, ou par l'auteur de la partie si c'est son app qui le calcule.
2. **`link_roster_member` :** ne pas écraser l'`ign` et le `tag` avec un Riot ID non vérifié (voir la réserve ci-dessus).
- **À acter (Chief, utilisateur) :** l'élargissement des scrims au capitaine et au manager via `save_match_event`.
- **Notifications :** `dossier_published` est ajouté à la liste, et cette liste contient toutes les valeurs précédentes, y compris celles de la 280000. **Ordre d'application :** si la 290000 passe **avant** la 280000, les deux types `staff_roles_changed` et `member_staff_roles_changed` existent déjà dans la liste, ce qui est sans effet. C'est OK.

**Contre-vérification des 2 correctifs (20/11) : OK.**
1. **`team_session_games` :**
   - L'ancienne politique ALL est supprimée, et la lecture reste réservée aux membres.
   - INSERT exige `reported_by = auth.uid()` (valeur par défaut). UPDATE et DELETE sont permis à l'auteur ou à `can_manage_session`.
   - UPDATE est limité par colonnes (`status`, `match_json`, `our_team_id`, `enemy_team_name`), **sans** `timeline_summary`, `reported_by` ni `session_id`.
   - `set_team_game_timeline_summary` : definer, `search_path` vide, autorisée à l'auteur, au staff ou à `can_manage_session`, rien pour `anon`. La taille reste plafonnée à 64 Ko. **S19-13 est levé.**
2. **`link_roster_member` :** l'`ign`, le `tag` et le puuid ne sont réécrits que si `puuid_status = 'verified'`. Sinon, l'`ign` et le `tag` de la ligne sont gardés et le puuid est vidé. La fonction renvoie l'état de vérification. OK.

**Détourages (`ascend-cutouts`, `cutout-pack-hosted`) : OK.**
- Le Worker est **statique** (assets seulement, aucun code), avec 1 608 images `.webp` et un `manifest.json` qui ne contient ni chemin local ni donnée personnelle (vérifié).
- `Access-Control-Allow-Origin: *` est sans risque pour des images publiques sans authentification. `nosniff` est présent, et `not_found_handling = none` renvoie une 404 franche.
- **Fonctionnel :** penser à ajouter cet hôte à `img-src` (et `connect-src` pour le manifest) dans la CSP du rendu (`electron.vite.config.ts`) et dans `web/public/_headers`.


#### #2 — Déconnexion et reconnexion (19/11, modifs non commitées) : **OK avec réserves non bloquantes**
**Périmètre :** `src/lib/accessCore.ts` (`authTimeoutFetch`, `signOutThisDevice`, `authStorageKey`), `electron/main/cloud/supabase.ts` (`keychainStorage`, `forgetLocalSession`), `electron/main/ipc/cloud.ipc.ts`, `web/src/api.ts`, `web/src/supabase.ts`. Comportement d'auth-js 2.100.1 vérifié dans `GoTrueClient._signOut`.

**Ce qui va :**
- Avant le correctif, un logout serveur en échec (réseau coupé, 5xx, 429) laissait la session intacte, sur le disque comme dans l'interface. Maintenant elle est oubliée localement : c'est **mieux** pour la sécurité, notamment sur un PC partagé.
- La clé effacée est la bonne : celle d'auth-js, plus le `-code-verifier`. Côté web, c'est `nexusmind-web-auth` dans le `localStorage`.
- Le délai de 10 s ne s'applique qu'à `/auth/v1/`. Un refresh coupé est une erreur réessayable pour auth-js, donc pas de déconnexion intempestive.
- Le `cloud:sign-out` reste validé par zod, sans argument.
- Après `delete-account`, le serveur répond 401 ou 404, et auth-js efface donc lui-même.

**Réserves, à corriger dans une prochaine passe et sans bloquer la release :**
- **R1 — La déconnexion n'est pas durable si le fichier est verrouillé (desktop, basse-moyenne).** Si `deleteSecret` échoue (fichier verrouillé par un antivirus, droits), la suppression n'est retenue qu'en mémoire (`memory.set(key, null)`). Le fichier chiffré garde la session, refresh token compris. **Au prochain lancement, l'utilisateur est reconnecté.** **Correctif :** persister la déconnexion ailleurs (petit fichier marqueur, non secret, dans `userData`) et, au démarrage, si le marqueur existe, ignorer la session stockée, retenter `deleteSecret` puis effacer le marqueur ; retenter aussi au `before-quit`.
- **R2 — La session peut réapparaître pendant un refresh (basse).** `forgetLocally` s'exécute **après** que `signOut` a relâché le verrou d'auth-js. Si le logout a échoué alors que le serveur répond aux refresh (un 5xx ou 429 ponctuel), un refresh automatique lancé entre les deux peut réécrire une session neuve juste après l'effacement. **Correctif :** `sb.auth.stopAutoRefresh()` avant `signOut`, et `startAutoRefresh()` à la prochaine connexion (dans le processus principal, qui n'a pas d'événement de visibilité) ; puis vérifier après `forgetLocally` que `getSession()` renvoie bien `null`.
- **R3 — Un jeton reste valide côté serveur (basse, à documenter).** Le commentaire de `signOutThisDevice` dit que le jeton « expire de lui-même dans l'heure ». C'est vrai de l'**access token** (JWT, 1 h), pas du **refresh token** : la session côté serveur reste révocable et utilisable sans limite de durée, sauf réglage de durée de session (fonction Pro de Supabase). Le risque est faible tant que la seule copie est effacée, mais réel si elle avait fuité. **Correctif :**
  1. Corriger le commentaire.
  2. Garder l'access token en mémoire et retenter `POST /auth/v1/logout` (scope `local`) quand le réseau revient, tant que ce jeton n'a pas expiré.
  3. Proposer dans le compte un bouton « Se déconnecter de tous les appareils » (`scope: 'global'`), le recours en cas de PC perdu.
- **Session :** Back-end (R1, R2, R3 points 1 et 2), Front-end (R3 point 3).

#### S19-16 (#29) — Migration `20261119200000_account_deletion_keeps_groups.sql` (19/11, rien en production) : **OK sur le principe, sous condition**
**Ce qui va :**
- Les 9 colonnes `NO ACTION` sont bien toutes couvertes (`drop not null` + `set null`). `team_session_feedback.user_id` passe en `CASCADE`, puisqu'il fait partie de la clé. `groups.created_by` passe en `SET NULL`.
- Les contraintes sont retrouvées dans `pg_constraint`, et l'exécution s'arrête si ce n'est pas exactement une. Le bloc est idempotent dans l'esprit et sans risque si le schéma de production diffère.
- `private.hand_over_groups_of` et le trigger sont en `SECURITY DEFINER`, avec `search_path = ''` et `EXECUTE` retiré à `public`, `anon` et `authenticated` : ils ne sont pas appelables par l'API (le schéma `private` n'est pas exposé).
- Le trigger `BEFORE DELETE` sur `auth.users` couvre toutes les manières de supprimer un compte : la fonction, le tableau de bord, l'API admin. Il s'exécute avant la cascade de `group_members`.
- Vérifié en production en lecture seule : **aucun trigger utilisateur** sur `group_members`, `groups` ou `auth.users`, donc rien ne bloquera la mise à jour de `role` faite sans `auth.uid()`. Les politiques qui lisent `created_by` (`scrims` insert, `vod_review_*`) ne servent qu'à l'écriture par l'auteur et tolèrent NULL.

**Conditions avant la production :**
1. **Le test n'a pas tourné** : `scripts/test-account-deletion.mjs` attend que l'utilisateur accepte le téléchargement de PGlite. Il faut un résultat vert **avant** de l'appliquer. Mieux encore, en plus : appliquer la migration sur une branche Supabase de test (payante, à la décision de l'utilisateur), puis y supprimer un compte de test qui a écrit dans chacune des 9 tables et qui est owner d'un groupe.
2. **Successeur, à corriger (mineur) :** si le groupe a **déjà un autre owner**, la fonction promeut quand même un coach ou un joueur. Ajouter une condition : ne rien faire s'il existe un autre membre avec `role = 'owner'`. Et classer le **capitaine** (`is_captain`) avant les autres joueurs dans l'ordre de succession.
3. **Interface :** avant la suppression de son compte, prévenir l'owner que la propriété de ses groupes sera transmise (à qui), ou que le groupe sera supprimé s'il en est le seul membre. Session : Front-end.

**Avis demandé : les `created_by … ON DELETE CASCADE` sur les contenus de groupe.** Oui, c'est le même défaut que `groups.created_by` à plus petite échelle : quand un coach supprime son compte, **ses scrims, événements, rosters, drafts, annonces, tâches et reviews disparaissent pour toute l'équipe**. La règle que je recommande pour la migration suivante :
- **Ce qui concerne la personne supprimée → `CASCADE` (effacement, art. 17).** À garder tel quel : `group_members.user_id`, `group_sharing`, `scrim_availability`, `availability_rules` et `availability_exceptions`, `wellbeing_checkins`, `notifications`, `notification_prefs`, `dev_plans.player_id`, `assigned_objectives.player_id`, `vod_review_assignments.player_id`, `staff_notes.player_id`, `review_comments.player_id`, `micro_review_answers.player_id`, `calendar_event_attendees` et `calendar_event_responses`, `team_session_attendance.user_id`, `discord_user_links`, `discord_user_link_codes`, `announcement_dismissals`, `cloud_backups`, `sync_records`, `feedback_reports`, `app_admins`.
- **Ce que la personne a créé pour le groupe → `SET NULL` (+ `drop not null`), affiché « ancien membre ».** À passer : `scrims.created_by`, `calendar_events.created_by`, `team_rosters.created_by`, `team_scouting.created_by`, `team_drafts.created_by`, `announcements.created_by`, `tasks.created_by`, `team_codex_rules.created_by`, `vod_review_sessions.created_by`, `vod_review_comments.author_id`, `vod_review_action_items.created_by`, `review_comments.author_id`, `assigned_objectives.assigned_by`, `dev_plans.created_by`, `dev_plan_checkins.created_by`, `micro_review_verdicts.coach_id`, `trial_candidates.created_by`, `trial_evaluations.created_by`, `staff_notes.created_by`. Et surtout **`discord_guild_links.linked_by`** : en cascade, le serveur Discord de l'équipe est délié quand celui qui l'a lié s'en va.
- **Éphémère → `CASCADE` acceptable :** `group_invites.created_by`, `access_invites.created_by`, `discord_guild_link_codes.created_by`.
- **Réserve RGPD :** `SET NULL` anonymise l'**auteur**, pas le **texte**. Un commentaire peut nommer la personne. C'est acceptable si la politique le dit (§ 7 du brouillon v0.3 : « supprimées ou rendues anonymes », sur demande à exciid501@gmail.com). Le choix final entre anonymiser et supprimer revient à l'utilisateur.
- Même méthode que #29 : contraintes lues dans `pg_constraint`, et un test PGlite étendu à ces tables.

#### #38 — `group_members.puuid` (`20261119240000_member_puuid.sql`, non appliquée) : **OK pour l'écriture, réserve sur l'usurpation**
- **Écrire le puuid d'un autre : impossible.** Vérifié en production : `authenticated` n'a l'UPDATE que sur des **colonnes** (`display_name`, `profile_banner`, `profile_icon`, `riot_id`, plus `puuid` avec la migration). Il n'y a pas d'UPDATE au niveau de la table. Et la politique `members_update_self_profile` impose `user_id = auth.uid()` en `using` comme en `with check`, plus `role = private.group_role(group_id)`. Un membre ne modifie donc que **sa** ligne, sans pouvoir toucher à son rôle ni au capitanat. La regex du `check` borne la valeur.
- **Usurper un puuid : possible, comme déjà avec `riot_id`.** La valeur est déclarée par le client, et Ascend n'a aucun moyen de prouver qu'un membre possède le compte Riot (pas de RSO). Un membre peut donc publier le puuid d'un coéquipier ou d'un joueur connu. Le puuid aggrave même le cas : l'app du coach **remplace le nom affiché par le vrai Riot ID** venu de Riot (`by-puuid`), donc l'usurpateur apparaît sous le nom exact de sa victime. Il peut aussi récupérer la place, les champions et les stats d'un joueur dans l'équipe construite à partir du puuid.
- **Correctifs proposés (Back-end, dans la même migration) :**
  1. `create unique index … on group_members (group_id, puuid) where puuid is not null` : un puuid ne peut être porté que par un seul membre d'un groupe. Le premier arrivé le garde, et un conflit renvoie une erreur claire.
  2. Ne pas faire confiance au puuid fourni par le client. Le **dériver côté serveur** du `riot_id` déclaré (account-v1 `by-riot-id` via le proxy, ou une RPC ou une edge function qui l'écrit). Le puuid est alors au moins cohérent avec le Riot ID que le membre affiche, au lieu d'être une valeur libre.
  3. Côté interface : si le Riot ID renvoyé par Riot pour ce puuid diffère du `riot_id` déclaré, l'afficher avec une mention (« Riot ID mis à jour depuis Riot ») plutôt que de le remplacer en silence.
- Vrai remède, plus tard : la connexion Riot (RSO), qui prouve que le joueur possède son compte. Elle dépend de la clé de production Riot.

#### #38 (suite) — Protections contre l'usurpation (19/11, non commité, rien en production) : **OK**
**Edge Function `verify-member-puuid` :**
- **Un appelant ne peut vérifier que ses propres adhésions.** La fonction ne lit **aucun paramètre** : pas de corps, pas d'identifiant de groupe ni d'utilisateur. L'identité vient de `admin.auth.getUser(token)`. La lecture se fait sur `user_id = uid`, et l'écriture sur `group_id`, `user_id = uid` **et** `riot_id` tel qu'il a été lu. Si le Riot ID change entre-temps, l'écriture ne s'applique pas. `verify_jwt = false` est compensé par cette vérification, comme pour `delete-account`.
- La résolution passe par le proxy avec le jeton de l'appelant. La fonction ne détient aucune clé Riot, et la limite de débit par compte du proxy s'applique. Le puuid renvoyé est validé par regex avant écriture. Un 404 efface le puuid. Un conflit avec l'index unique est signalé (`conflicts`) sans être écrit. Les erreurs ne renvoient pas de détail interne.
- **Migration :** l'index unique `(group_id, puuid)` est créé, et `revoke update (puuid)` retire aux clients toute écriture de cette colonne. Le trigger `before update of riot_id` efface le puuid quand le Riot ID déclaré change, ce qui évite qu'un ancien puuid vérifié reste attaché à un nouveau nom. La mise à jour faite par la fonction, qui ne touche que `puuid`, ne déclenche pas ce trigger. `team:update-member` est maintenant validé par zod.

**Risque résiduel, accepté jusqu'à la connexion Riot (RSO) :** le puuid est désormais **cohérent** avec le Riot ID déclaré, sans valeur libre et sans faux nom affiché. Mais la **déclaration** du Riot ID reste libre : un membre peut toujours déclarer le Riot ID de quelqu'un d'autre. Avec l'index unique, il peut même **occuper la place en premier**, et le vrai joueur se retrouve alors en conflit. **Atténuation à prévoir dans l'interface (Front-end) :** montrer les conflits au staff, avec les deux membres concernés, pour que l'owner retire l'imposteur. Ce n'est pas bloquant.

**Fonctionnel (non sécurité) :** `collabCore` appelle la fonction avec `sb.functions.invoke`, et ce code est partagé avec le web. Dans un navigateur, l'appel envoie d'abord une requête OPTIONS de préflight, à laquelle la fonction répond 405, sans en-têtes CORS. Sur le web, la vérification échouera donc en silence (elle est « best effort »). Si elle doit marcher sur le web, ajouter la réponse OPTIONS et des en-têtes CORS limités à l'origine de la web app (Back-end).

#### #38 (suite 2) — CORS de `verify-member-puuid` et `puuid_status` (19/11, non commité) : **OK**
- **CORS :**
  - Origines autorisées : `WEB_APP_ORIGINS` est découpé en **tableau**, et la comparaison se fait à l'égalité exacte (pas une sous-chaîne). Une autre origine reçoit 403. Sans en-tête `Origin` (le desktop, appelé depuis le processus principal), pas de CORS, ce qui est normal.
  - Préflight : OPTIONS répond 204, avec `Vary: Origin`.
  - La sécurité ne repose pas sur le CORS : l'authentification reste le jeton vérifié par `getUser`.
- **Détail (basse) :** `let cors` est une variable **de module**, réécrite à chaque requête. Deux requêtes simultanées depuis deux origines autorisées différentes pourraient recevoir l'en-tête de l'autre. L'effet est seulement fonctionnel (le navigateur refuse la réponse), mais le calculer dans le handler et le passer à `json()` est plus propre.
- **`puuid_status` :** valeurs bornées par un `check` (`verified`, `not_found`, `conflict`), `revoke update` sur `puuid` et `puuid_status`, écrit uniquement par la fonction en service role, et remis à NULL avec le puuid par le trigger quand le Riot ID change. Le conflit est maintenant **visible** dans la ligne, ce qui permet à l'interface de l'afficher au staff, comme demandé dans la suite 1.

**Avis sur le CORS des autres fonctions :**
- **`redeem-invite` (`*`) : oui, à corriger, en basse priorité.** C'est la seule fonction **non authentifiée** qui crée un compte. Avec `*`, n'importe quel site peut faire envoyer des essais de codes par les navigateurs de ses visiteurs, chacun avec **son** IP. La limite de 10 échecs par IP et par heure ne freine alors plus un brute force réparti.
  - **Correctif (Back-end) :**
    1. Limiter l'origine au site vitrine et à la web app.
    2. Exiger `content-type: application/json`. Sinon, une requête « simple » en `text/plain` part sans préflight, et `req.json()` la lit quand même, donc le CORS seul ne suffit pas.
    3. Ajouter un **plafond global** d'échecs par heure, toutes IP confondues, comme garde-fou.
    4. Vérifier que `cf-connecting-ip` est bien fourni par l'infrastructure Supabase. Si l'en-tête manque, l'IP est lue dans `x-forwarded-for`, que le client contrôle, et la limite par IP se contourne en changeant cet en-tête.
- **`delete-account`, `web-handoff` :** pas de CORS, donc **plus** restrictif, et ces fonctions exigent un jeton. Il n'y a rien à corriger côté sécurité. Si la web app doit appeler `delete-account`, il faudra la même liste d'origines que `verify-member-puuid` (fonctionnel).
- **`team-report`, `team-calendar-ics` :** pages ouvertes en GET par lien ou par un client calendrier, pas appelées par `fetch` depuis un autre site. Le CORS est sans objet. Durcissement suggéré pour `team-report`, qui sert du HTML : ajouter `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`, `x-content-type-options: nosniff` et `referrer-policy: no-referrer`, pour que le jeton ne parte pas dans le Referer.

#### Proxy Riot, phase 1 (`cloudflare/riot-proxy/src`, 19/11, non déployé) : **OK, avec 3 réglages**
**Ce qui va :**
- L'ordre des étapes est sain : route en liste blanche, puis JWT vérifié (comptes anonymes refusés), limite par utilisateur, cache, budget global, et enfin Riot. Le cache est servi **après** l'authentification et la limite par utilisateur : un appelant non connecté n'en obtient rien.
- **Cache partagé (R2) :** il ne contient que le corps d'un match et sa timeline match-v5 (regex stricte), **sans query** (`!url.search`). La clé est faite de l'hôte, choisi dans une liste blanche, et du chemin validé. Il n'y a pas de variation par utilisateur, et Riot renvoie la même réponse à tout détenteur de clé. Seul un 200 JSON complet de Riot est stocké, avec une taille plafonnée à 8 Mo. Il n'y a **pas de donnée non publique**, et pas d'empoisonnement possible : seul Riot écrit dans le cache.
- **Durable Object :** il n'est joignable que par le binding, sans URL publique. Le `penalize` est borné à 3600 s. Les fenêtres reprennent celles de la clé.
- **Métriques :** le libellé est **celui de la route** (`allowed.label`), fixe, accompagné de l'hôte, du résultat et de la priorité. Ni puuid, ni Riot ID, ni identifiant de match ou d'utilisateur, dans Analytics Engine comme dans les logs. La phrase d'erreur « clé rejetée » utilise aussi ce libellé.

**Réglages demandés :**
1. **La priorité déclarée par le client ne crée pas de faille, mais la réserve ne protège rien contre un client qui triche.** Se déclarer `background`, c'est seulement **baisser** sa propre priorité, ce qui ne donne aucun avantage. En revanche, un client (modifié, ou un vieux client sans l'en-tête) qui lance du scouting sans cet en-tête passe en `interactive` et mange la réserve. Surtout : **`USER_LIMITER` à 60 par minute dépasse à lui seul le budget global de la clé de développement** (95 appels par 120 s, soit environ 47 par minute). **Un seul compte peut donc vider le budget de tout le monde.** **Correctif (Back-end) :**
   - une limite par utilisateur **nettement sous** le budget global (par exemple 20 par minute avec la clé de développement, à remonter avec la clé de production) ;
   - ou mieux, une part maximale par utilisateur dans le Durable Object (par exemple 25 % d'une fenêtre) ;
   - et, quand c'est possible, déduire la priorité de l'endpoint côté serveur, par exemple traiter `matches/by-puuid/…/ids` avec un grand `count` comme du `background`.
2. **Durable Object injoignable : le comportement est acceptable, mais à resserrer.** Laisser passer en cas de panne (fail-open) est un choix de disponibilité, et les 429 de Riot restent le dernier rempart. Mais une panne longue pendant un pic de scouting expose la clé à des 429 répétés, donc à un risque de blocage par Riot. **Suggestion :** laisser passer seulement les appels `interactive`, et refuser les `background` (`503`, `retry-after: 30`) tant que le Durable Object ne répond pas.
3. **Données de tiers conservées sans limite de durée (confidentialité).** Les matchs et timelines contiennent les puuid et les Riot ID des **10 joueurs** de chaque partie, dont des personnes qui n'ont pas de compte Ascend. Ils sont gardés **sans expiration** dans R2. **Correctif :**
   - une règle de cycle de vie R2 (par exemple 90 jours) ;
   - vérifier au déploiement que le bucket `nexusmind-riot-matches` est **privé** (pas d'accès public ni d'URL `r2.dev`) ;
   - ajouter une ligne dans la politique de confidentialité (§ 6 de la v0.3) : « Cloudflare (R2) : copie temporaire des données de match publiques de Riot, partagée entre utilisateurs pour limiter les appels ».
- **Reste de S19-10 :** `url.search` est toujours relayé sans filtre. C'est sans risque sur les chemins autorisés, mais une liste blanche des paramètres (`start`, `count`, `queue`, `type`, `startTime`, `endTime`) reste conseillée.

#### Réglages du proxy et des `run_*` (19/11, non déployé) : **OK**
- **Proxy :**
  - Part par utilisateur de 25 % de chaque fenêtre dans le Durable Object, vérifiée **avant** le budget global. L'identifiant passé est le `sub` du JWT vérifié, gardé en mémoire seulement et absent des métriques. `USER_LIMITER` est à 20 par minute. Un seul compte ne peut plus vider le budget.
  - La priorité est déduite de l'endpoint : maîtrises et listes d'identifiants sans date de fin sont toujours en `background`.
  - Si le Durable Object est injoignable, les appels `background` reçoivent un 503 avec `retry-after: 30`, et les interactifs passent.
  - **Liste blanche des paramètres :** la requête envoyée à Riot est **reconstruite** à partir des seuls paramètres autorisés, sans doublon et validés par regex, avec un 400 sinon. Le cache n'est utilisé que sans paramètre. Le reste de S19-10 est donc levé.
- **R2 :** la règle de cycle de vie à 90 jours et la consigne de bucket privé sont **documentées** dans `wrangler.toml`, mais **ne s'appliquent pas seules**. Les commandes `r2 bucket lifecycle add` et `r2 bucket dev-url get` sont à exécuter au déploiement, et je les vérifierai dans ma revue d'après déploiement.
- **`run_*` (section 8) :** `run_dev_plan_period_check` et `run_scrim_availability_check` incluent maintenant les rôles staff additionnels. `run_weekly_load_check`, qui lit l'humeur, exige `role <> 'player'`, comme demandé. L'exécution est **retirée** à `public`, `anon` et `authenticated` sur les 5 `run_*`. Cela lève en grande partie S19-07.
- **S19-07, reste à faire :** `run_review_pending_check` (toujours exécutable par `anon` et `authenticated` en production), les deux fonctions de trigger (`auto_create_team_session`, `notify_calendar_event_request`), ainsi que `set_captain` et `set_weekly_load_threshold` pour `anon`. Aucune migration ne retire encore ces droits. Il suffit d'une ligne `revoke` par fonction dans la même migration (Back-end).

#### #39 — `20261119280000_member_staff_roles.sql` (19/11, locale, rien en production) : **OK, une décision reste à prendre**
**Mes conditions sont respectées :**
1. **`staff_roles` n'est pas modifiable par le membre.** Vérifié en production : il n'y a pas d'UPDATE au niveau de la table pour `authenticated`, seulement 4 colonnes, sans `staff_roles`, et le `revoke update (staff_roles)` est ajouté par prudence. La colonne n'est pas non plus dans les colonnes d'INSERT. Le `check` impose un sous-ensemble de {coach, manager, analyst}, sans doublon, sans répéter le rôle principal, et vide pour l'owner.
2. **`set_member_staff_roles`** : réservée à l'owner (`group_role(p_group, auth.uid()) = 'owner'`), verrou `for update` sur le membre **de ce groupe** (sinon `NOT_FOUND`), au plus 3 valeurs validées, refus pour l'owner (`OWNER_HAS_ALL_ROLES`). `SECURITY DEFINER`, `search_path` vide, exécution retirée à `anon`. `set_member_role` retire le nouveau rôle principal de `staff_roles`, pour rester cohérent avec le `check`.
3. **Transparence :** le membre est notifié à chaque changement, et **toute l'équipe** l'est à chaque ajout de rôle staff. Les deux nouveaux types de notification sont ajoutés à `notifications_type_check`. Vérifié en production : la nouvelle liste **contient toutes** les valeurs actuelles et tous les types émis par les fonctions, donc la migration ne cassera aucun trigger.
4. **Bien-être :** `can_read_wellbeing` exige un rôle staff **et** `role <> 'player'`, et `run_wellbeing_alert_check` suit la même règle. `run_weekly_load_check`, qui lit aussi l'humeur, ne vise que le rôle principal staff, donc pas de joueur. **Attention à l'avenir :** si cette fonction passe un jour à `has_group_role`, il faudra y ajouter `role <> 'player'`.
5. **Passation d'owner :** les staff qui ne jouent pas passent avant les joueurs-staff, et `staff_roles` est vidé lors de la promotion, comme l'exige le `check`.
- **Rôles alignés :** `is_discord_manager`, le bot (`getGroupMemberRoles` et `DISCORD_MANAGER_ROLES`) et `can_edit_calendar` utilisent maintenant owner, coach, manager. Ma remarque de #34 est donc levée.

**S19-17, partiellement corrigé :** la branche « équipe » de `can_read_player_table` exige maintenant un rôle staff (principal ou additionnel) **et** `share_team is true` (partage explicite). C'est bien. Il reste une limite : la lecture n'est toujours pas restreinte **au groupe auquel la donnée appartient**. Un coach qui active `share_team` dans le groupe A expose au staff de A les données d'équipe de son groupe B. Le risque est faible, puisqu'il faut un staff et un accord explicite. Le correctif de fond reste celui du plan #41 : des tables rattachées au groupe. **À vérifier (Back-end) :** passer de `coalesce(share_team, true)` à `is true` coupe l'accès pour les membres qui n'ont jamais réglé ce partage. Si une fonction en dépendait, elle ne verra plus rien.

**Décision encore ouverte, pour l'utilisateur :** les reviews et les stats restent partagées **par défaut** (`coalesce(s.share_reviews, true)` et `coalesce(s.share_stats, true)`). Un joueur qui devient coach lira donc, dès l'attribution du rôle, les reviews et les stats de ses coéquipiers qui n'ont rien réglé. La notification d'équipe les prévient. Mais je recommande toujours un partage **explicite** (`is true`), au moins quand le lecteur est un joueur-staff.

**Fonctionnel, pas de risque :** `create_group_invite`, `run_dev_plan_period_check`, `run_scrim_availability_check` et `run_weekly_load_check` testent encore le seul rôle principal. Un joueur-staff n'y a donc pas encore les droits ni les notifications de staff. C'est le sens prudent, à compléter si c'est voulu (avec la réserve du point 4 pour `run_weekly_load_check`). Le correctif de `run_inactive_player_check` (« record gm is not assigned yet ») est correct.

#### #44 — Durcissement des Edge Functions (19/11, non commité, rien de déployé, relu sans runtime Deno) : **OK, avec un réglage à revoir**
- **`verify-member-puuid` :** `cors` et `json` sont maintenant calculés **pour chaque requête**. Le partage entre requêtes simultanées a disparu.
- **`redeem-invite` :**
  - Origines limitées à la web app et au site, comparées en égalité exacte sur un tableau, avec un 403 sinon. Pas de CORS sans `Origin`, comme pour le desktop.
  - 415 sans `application/json`, ce qui ferme la requête « simple » en `text/plain` sans préflight.
  - L'IP vient **seulement** de `cf-connecting-ip` : `x-forwarded-for` n'est plus utilisé. Si l'en-tête manque, un compteur commun est utilisé et un avertissement est journalisé.
  - Le plafond global est compté sur `ok = false` de la dernière heure. Le reste est inchangé : réponses indistinctes, et code limité à un e-mail le cas échéant.
- **`team-report` :** CSP `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`, plus `nosniff` et `no-referrer`, sur la page **et** sur les réponses texte (404). Le HTML reste échappé. OK.

**À revoir, le plafond global de 200 échecs par heure : il protège peu et ouvre un déni de service.**
- Les codes générés font **12** caractères (`create_access_invite`) et **10** (`create_group_invite`), sur un alphabet de 31, soit au moins 31¹⁰ ≈ 8·10¹⁴ combinaisons. Même réparti sur des milliers d'IP, le brute force reste irréaliste. La limite par IP suffit.
- À l'inverse, **200 requêtes fausses, envoyées depuis une vingtaine d'IP** (ou sans navigateur, puisque le CORS ne gêne que les navigateurs), **bloquent toutes les inscriptions par invitation pendant une heure**.
- **Correctif proposé (Back-end) :**
  1. Monter le plafond (par exemple `INVITE_MAX_GLOBAL_FAILS_PER_HOUR = 5000`) pour qu'il ne serve qu'à détecter une attaque, et le surveiller dans les journaux.
  2. Resserrer la regex `CODE` à `{10,16}`, la longueur réelle des codes, pour rejeter sans rien compter les essais trop courts.
- **Au déploiement (Back-end) :** vérifier dans les journaux de la fonction que `cf-connecting-ip` est **bien présent**. Sinon, tous les appelants partagent le même compteur de 10 échecs par heure, ce qui crée là aussi un déni de service facile.
- **Point bas (prochaine migration) :** les codes d'invitation sont tirés avec `random()`, qui n'est pas cryptographique. Leur longueur rend toute prédiction peu réaliste, mais `gen_random_bytes` (pgcrypto) ou `gen_random_uuid()` serait préférable.

#### #39 — `docs/PROPOSITION_MULTI_ROLES.md` : avis CyberSecurity
**Modèle : B, recommandé.** Il garde un seul point de contrôle (`has_group_role`), ne réécrit que les corps des fonctions `private.*` (les politiques restent identiques, ce qui réduit le risque d'oubli), et reste compatible avec les anciennes versions. C'est un bon choix de sécurité. Conditions :
1. `staff_roles` ne doit **jamais** entrer dans un `grant update` à `authenticated`. Ajouter un test PGlite qui vérifie qu'un membre ne peut pas modifier sa propre colonne `staff_roles`.
2. `set_member_staff_roles` : vérifier que `p_user` est membre de `p_group`, que l'appelant en est l'owner, avec un `check` sur les valeurs (sous-ensemble de {coach, manager, analyst}, sans doublon), et un refus sur l'owner lui-même. `SECURITY DEFINER`, `search_path` vide, exécution retirée à `anon`.
3. **Transparence :** attribuer un rôle staff à un joueur lui ouvre des données de ses coéquipiers. Chaque changement doit envoyer une **notification au membre concerné et à l'équipe** (« X est maintenant coach du groupe »), et l'écran de partage doit **lister nommément** qui peut voir quoi.
4. Corriger S19-17 dans la même vague : la branche « équipe » de `can_read_player_table`, sans restriction de rôle ni de groupe, deviendrait encore plus large avec des rôles multiples.
5. Passation d'owner : d'accord avec « staff qui ne joue pas avant joueur-staff ».

**Question vie privée : un joueur-coach doit-il lire le bien-être partagé de ses coéquipiers ? Avis : non, pas par défaut.**
- Ce sont des données de **santé** (art. 9). Le consentement d'un joueur a été donné pour « le staff du groupe », c'est-à-dire, dans la compréhension de tous, un encadrement qui ne joue pas. L'étendre en silence à un **coéquipier**, qui est parfois en concurrence pour la même place, dépasse ce consentement.
- La relation n'est pas neutre : un joueur-coach influence la composition de l'équipe. Une baisse d'humeur ou de sommeil vue par un concurrent direct peut nuire au joueur qui l'a partagée. Le principe de **minimisation** va dans le même sens.
- **Proposition :** `can_read_wellbeing` exige un rôle staff **et** `role <> 'player'`, c'est-à-dire un staff qui ne joue pas. Si l'utilisateur veut quand même ouvrir ce cas, il faut un **second accord explicite, distinct** : une case « partager aussi avec les joueurs qui ont un rôle staff », décochée par défaut, avec les noms affichés. Le texte légal v0.3 (§ 3 bis, § 5) doit alors être mis à jour.
- **Reviews et stats partagées** (`share_reviews`, `share_stats`) : un joueur-coach peut y accéder, puisque c'est le but du coaching. Mais deux conditions : la notification du point 3, et l'idée de remplacer le partage par défaut (`coalesce(…, true)`) par un partage explicite, plus prudent maintenant que le « staff » peut être un pair.

#### #34 et E15-B (19/11, non commité, rien en production) : **OK**
**#34, `unlink_discord_guild(p_group)` (`20261119230000_discord_unlink_guild.sql`) :**
- `SECURITY DEFINER`, `search_path` vide ; `LOGIN_REQUIRED` sans `auth.uid()` ; `FORBIDDEN` si `private.is_group_staff(p_group)` est faux (vérifié en production : owner, coach, analyst de **ce** groupe, pour l'appelant).
- Le DELETE ne vise que `group_id = p_group` : impossible de délier le serveur d'un autre groupe. Exécution retirée à `public` et `anon`.
- L'IPC `discord:unlink-guild` est validé par zod (uuid) ; le preload expose seulement `discordUnlinkGuild(groupId)`.
- **Remarque (basse) : les rôles ne sont pas les mêmes des deux côtés.** Délier depuis l'app passe par `is_group_staff` (owner, coach, **analyst**), alors que `/set-channel` dans le bot accepte owner, coach, **manager** (`CHANNEL_STAFF_ROLES`). Un manager peut donc choisir le salon mais pas délier, et un analyste l'inverse. **Suggestion :** une seule liste pour les droits Discord, de préférence `can_manage_session` ou owner, coach, manager, à appliquer aux deux côtés.

**E15-B, canaux `clip:set-youtube` et `clip:set-temp-share` retirés :** aucun handler ni exposition dans le preload ne subsiste (recherche dans `electron/`, `src/` et `web/src/`). `recording:set-youtube` reste en place, il est utilisé et validé par zod (`youtubeUrlSchema`). Moins de surface IPC : c'est OK.

#### Compléments ffmpeg (19/11, non commité) : **OK**
- `EXE_SHA256` est épinglé et `.verified.json` est supprimé : la confiance ne repose plus sur un fichier local réécrivable. Le téléchargement compare le zip **puis** le binaire extrait aux deux constantes, et refuse en cas d'écart.
- Hors ligne : avertissement et sortie 0, sans rien installer. C'est acceptable, puisque la release vérifie de son côté.
- `psQuote` double les apostrophes : OK.
- `release.ps1` lit `EXE_SHA256` dans le script (source unique, regex stricte sur 64 caractères hexadécimaux), calcule l'empreinte de `resources/ffmpeg-bin/win-x64/ffmpeg.exe` et **refuse de builder** en cas d'écart. Seul `-PublishOnly` saute ce contrôle, et il ne build pas.
- `owner` et `repo` sont ajoutés dans `electron-builder.yml` : c'est neutre pour la sécurité. Bon point : la mise à jour automatique vise explicitement le bon dépôt.
- **Empreinte du binaire épinglée sur la copie locale, pas encore confirmée :** c'est acceptable **en attendant**. Le zip d'origine n'a pas changé depuis le 17/03 (GitHub, `updated_at`), et la copie locale en vient très probablement. Le premier vrai téléchargement fera office de contrôle automatique : il refusera si le binaire extrait diffère de la constante. **Condition :** faire ce téléchargement de contrôle **avant la prochaine release publique**. S'il échoue sur l'empreinte du binaire, ne pas publier et me prévenir.
- **Reste (basse) :** `npm run dist` et `dist:dir` appellent `electron-builder` sans passer par `release.ps1`, donc sans le contrôle de ffmpeg. Ils ne publient rien (`--publish never`), mais un installeur fait ainsi pourrait être partagé à la main. Suggestion : un `predist` qui lance la même vérification (Back-end).

#### Consentement au bien-être — `20261119220000_wellbeing_consent.sql` (19/11, rien en production) : **OK, 3 remarques non bloquantes**
**Ce qui va :**
- `wellbeing_consent_events` est en ajout seul. Seule la lecture de ses propres lignes est permise, sans politique d'écriture, et INSERT, UPDATE et DELETE sont retirés à `anon` et `authenticated`. La seule écriture passe par `set_wellbeing_consent`.
- L'horodatage est fait par le serveur, la version est contrôlée par regex, et l'historique est supprimé avec le compte (`cascade`). La preuve du consentement est donc solide.
- `set_wellbeing_consent` : `SECURITY DEFINER` et `search_path` vide, refus sans `auth.uid()`, n'agit que sur l'appelant. Le retrait supprime **dans la même transaction** les check-ins et coupe `share_wellbeing` partout. Exécution retirée à `anon`.
- Un INSERT de check-in exige le consentement en cours. La lecture, la modification et la suppression de ses propres check-ins restent ouvertes (supprimer doit marcher sans consentement).
- IPC : `wellbeing:consent-get` et `consent-set` sont validés par zod (`z.boolean()` et `z.literal('v0.3')`). Aucune copie locale des check-ins (rien dans Prisma ni `sync_records`) : la suppression côté serveur est complète.

**Remarques :**
1. **`private.has_wellbeing_consent(p_user)` accepte un utilisateur quelconque** et elle est accordée à `authenticated`. Elle n'est pas appelable par l'API (le schéma `private` n'est pas exposé), mais elle répondrait pour n'importe qui. **Suggestion :** retirer le paramètre et utiliser `auth.uid()` dans le corps, puisque la politique ne l'appelle qu'avec `auth.uid()`.
2. **`share_wellbeing` peut être activé sans consentement** (politique de `group_sharing`). C'est sans effet aujourd'hui, puisqu'il n'y a aucun check-in, mais c'est incohérent avec le § 3 bis (le partage est un **second** accord). **Suggestion :** l'interface refuse d'activer le partage tant que le consentement manque, et éventuellement un `check` côté serveur.
3. **La check-in déjà en production (1 ligne) n'a pas de consentement.** La migration ne la touche pas. Il faut appliquer la règle C.5 du brouillon v0.3 : demander l'accord à la prochaine ouverture, et supprimer la check-in en cas de refus. Ou, plus simple, la supprimer au moment de la mise en production, avec l'accord de l'utilisateur.

#### #13 point 2 — Empreinte de ffmpeg (S3 / SEC-4 / S19-04) (19/11, non commité) : **OK, avec 2 compléments avant la release**
**Périmètre :** `scripts/download-ffmpeg.mjs`, `tests/unit/downloadFfmpeg.test.ts` (relancé par CyberSecurity : 4/4 OK).

**La source du digest est fiable.** Vérifiée par CyberSecurity avec `gh api repos/GyanD/codexffmpeg/releases/tags/8.1` (lecture publique) :
- l'asset fait 108 771 139 octets, et son digest `sha256:8748283d…63c6` est identique à la constante ;
- il a été envoyé par `GyanD` le 2026-03-17 entre 05:26:56 et 05:28:06 (`created_at` et `updated_at`), avec une release publiée à 05:37:37 ;
- **il n'a pas été modifié depuis.** Le digest est calculé par GitHub à l'envoi, pas déclaré par l'éditeur. Il ne protège pas contre un fichier piégé **dès l'origine** (aucune autre source pour la 8.1, puisque gyan.dev ne liste que la version en cours), mais il bloque tout remplacement ultérieur, ce qui était le risque visé.

**Ce qui va :**
- Le zip est vérifié **avant** l'extraction et avant toute exécution. En cas d'écart : arrêt avec code 1 et nettoyage.
- Un `ffmpeg.exe` déjà présent n'est jamais lancé avant d'être comparé à son empreinte.
- Une redirection vers `http:` est refusée par `https.get`.
- Les tests couvrent le refus, l'absence d'enregistrement, l'écart d'empreinte et le binaire conservé.

**Compléments demandés :**
1. **Épingler aussi l'empreinte de `ffmpeg.exe` dans le script** (moyenne-basse). `ffmpeg.exe.verified.json` est rangé à côté du binaire, avec le même niveau de confiance : quiconque peut remplacer le binaire peut réécrire l'enregistrement (il suffit d'y recopier la constante du zip et le hash de son propre binaire). L'enregistrement détecte donc un accident, pas une falsification locale. **Correctif :** après le re-téléchargement de contrôle, ajouter une constante `EXE_SHA256` et faire comparer le binaire à **cette constante**. L'enregistrement devient inutile, ou sert seulement à éviter de recalculer. **Recoupement utile :** le binaire actuel, installé avant le 19/11, a l'empreinte `1a65d5b0…13f705`. Si le contrôle redonne la même, deux téléchargements faits à des dates différentes concordent.
2. **Machines hors ligne et build :** aujourd'hui, le `ffmpeg.exe` local n'a **pas** d'enregistrement. Le prochain `npm install` voudra donc tout re-télécharger, et **échouera hors ligne** (postinstall en code 1, donc `npm install` en échec). Pour la sécurité, ce refus est le bon comportement. Pour éviter de bloquer le travail sans affaiblir le build, il faut séparer deux choses :
   - **postinstall hors ligne :** se contenter d'un avertissement (« ffmpeg non vérifié, lancez `node scripts/download-ffmpeg.mjs` ou fournissez `NXM_FFMPEG_ZIP` ») au lieu d'un échec ;
   - **`scripts/release.ps1` :** **refuser de builder** si `resources/ffmpeg-bin/win-x64/ffmpeg.exe` n'a pas l'empreinte épinglée (point 1). C'est **cette** vérification qui protège les utilisateurs, puisqu'`electron-builder` embarque le fichier sans contrôle. Aujourd'hui, `release.ps1` ne vérifie rien sur ffmpeg.
3. **Détail (basse) :** `Expand-Archive -LiteralPath '${zipPath}'` est construit dans une commande PowerShell entre apostrophes. Un chemin `%TEMP%` qui contient une apostrophe (nom d'utilisateur comme « O'Brien ») ferait échouer l'extraction. Il n'y a pas de risque d'injection venant d'un tiers, mais il vaut mieux doubler les apostrophes (`replace(/'/g, "''")`).
- **Sessions :** Back-end (1, 2 et 3). Le re-téléchargement de contrôle (108 Mo) attend l'accord de l'utilisateur.

#### #32 — Bouton « Se déconnecter de tous les appareils » (19/11, non commité) : **OK**
**Périmètre :** `src/components/Cloud/SignOutEverywhereButton.tsx`, `CloudAccountCard.tsx` (desktop), `web/src/pages/AccountPage.tsx`, `electron/preload/index.ts:265`, `src/lib/ipc.ts:482`, i18n FR et EN.

**Ce qui va :**
- La chaîne est complète : preload, `cloud:sign-out-everywhere` (zod, `scope: 'global'`), et `webApi.cloudSignOutEverywhere` côté web (`window.api = webApi`). Le point 3 de R3 est fait.
- Le bouton passe par une confirmation. En cas d'erreur, il affiche honnêtement « aucun appareil n'a été déconnecté » au lieu de faire croire que l'opération a réussi. Il est masqué si l'API manque.
- En cas de succès, auth-js efface la session locale et l'écran de connexion prend le relais, sur le desktop par l'événement `SIGNED_OUT` (le marqueur R1 est aussi géré par `removeItem`).

**Note, basse :** `scope: 'global'` révoque les **refresh tokens** de toutes les sessions. Mais un **access token** déjà émis sur un autre appareil reste accepté par PostgREST jusqu'à son expiration, une heure au plus, car les JWT ne sont pas revérifiés à chaque requête. Le texte « devront se reconnecter » est donc juste, mais pas forcément immédiat. Suggestion pour le Front-end : ajouter « (au plus tard dans l'heure) » à la description. Je ne demande pas d'autre changement.

**Non vérifié :** le web n'a pas été essayé dans un navigateur. Le code est le même composant, mais à tester avant la release avec un compte de test.

#### #29 (suite) et #33 — Transfert de propriété et contenus de groupe (19/11, rien en production) : **OK, test PGlite toujours requis**
**#29, `hand_over_groups_of` : OK.**
- S'il existe déjà un autre owner, personne n'est promu et `groups.created_by` passe au plus ancien des owners restants.
- Sinon, l'ordre de succession est coach, manager, analyste, puis capitaine (`is_captain desc` parmi les autres), puis le joueur le plus ancien.
- Le groupe n'est supprimé que si personne d'autre n'y est membre. Mes conditions 2 et 3 (cette dernière côté interface) sont prises en compte.

**#33, `20261119210000_account_deletion_keeps_group_content.sql` : OK, avec un ajout demandé.**
- **Vérifié en production, en lecture seule :** chacune des 20 colonnes a exactement **une** FK vers `auth.users`, donc la migration ne s'arrêtera pas. Aucune ne fait partie d'une clé primaire, et aucune contrainte `CHECK` ne porte sur elles. Une seule est dans une contrainte unique : `micro_review_verdicts (answer_id, coach_id)`, ce qui ne pose pas de problème, puisque PostgreSQL considère les NULL comme distincts.
- **Restent en `CASCADE`, comme prévu :** les données personnelles, les invitations et les codes.
- **Ajout demandé, les lignes orphelines :** une fois l'auteur à NULL, certaines lignes ne peuvent plus être modifiées ni supprimées par personne.
  - `micro_review_verdicts` : le DELETE et l'UPDATE ne sont permis qu'à `coach_id = auth.uid()`. Le verdict d'un coach parti resterait **figé pour toujours**, et le joueur ne pourrait pas faire retirer un verdict faux.
  - **Correctif :** dans la même migration, une politique DELETE `coach_id is null and private.is_group_staff(group_id)`.
  - `review_comments` : seul l'owner du groupe peut supprimer un commentaire orphelin (le joueur peut encore le modifier). C'est acceptable.
  - `vod_review_comments` et `vod_review_action_items` : le staff peut les supprimer. C'est OK.
- **Interface :** les types côté client déclarent `createdBy`, `authorId` et `coachId` en `string` (`announcementsCore`, `calendarCore`, `teamOpsCore`, `trialsCore`, `devPlanCore`, `microReviewCloudCore`…). Il faut les passer en `string | null` et afficher « ancien membre », sinon un écran peut planter ou afficher « undefined ». Sessions : Back-end (types), Front-end (affichage).
- **Avant la production (inchangé) :** `scripts/test-account-deletion.mjs` doit tourner et passer. Il couvre les deux migrations, mais attend que l'utilisateur accepte le téléchargement de PGlite.

#### #2 (suite) — Réserves R1 à R3 et déconnexion de tous les appareils (19/11, non commité) : **OK, à un point près**
**Périmètre :** `electron/main/cloud/supabase.ts`, `electron/main/index.ts` (`before-quit`), `electron/main/ipc/cloud.ipc.ts`, `src/lib/accessCore.ts` (`signOutThisDevice`, `retryRevoke`, `scheduleRevokeRetry`), `web/src/api.ts`. Tests relancés par CyberSecurity : `accessCore`, `authSignOutFlow` et `desktopAuthStorage`, 36/36 OK.

- **R1, levée.** `signout-pending.json` ne contient que les **noms** des clés de stockage, aucun secret, et le JSON est lu de façon défensive. Il est relu dans `getSupabase()` **avant** que le client ne lise la session. Un effacement qui échoue encore garde la session ignorée (`memory = null`). Nouvel essai au `before-quit`. Le marqueur est retiré quand une nouvelle session est écrite avec succès : c'est juste, puisque l'écriture a écrasé l'ancien fichier.
- **R2, levée.** `stopAutoRefresh()` avant `signOut`, puis une relecture de `getSession()` qui efface à nouveau s'il reste une session. `startAutoRefresh()` est différé sur `SIGNED_IN`, hors du callback d'auth-js. Côté web, l'auto-refresh se relance aussi quand l'onglet redevient visible : c'est sans conséquence, puisque le stockage est déjà vide.
- **R3, levée, avec une limite.** L'access token à révoquer reste **en mémoire uniquement**, sans écriture sur le disque. `POST /auth/v1/logout?scope=local` est retenté toutes les 60 s tant que le jeton n'a pas expiré, et à l'événement `online` sur le web. Les réponses 401, 403 et 404 sont traitées comme terminées. Le délai de 10 s s'applique, et deux essais ne peuvent pas se chevaucher. **Limite acceptée :** si l'app se ferme ou si l'onglet web est fermé avant que le serveur ait été joint, la session reste ouverte côté serveur. Seule la copie locale a disparu, donc le risque est faible, et le recours est le bouton ci-dessous.
- **Déconnexion de tous les appareils : incomplète.** `cloud:sign-out-everywhere` est enregistré (validé par zod, `scope: 'global'`, erreur si le serveur n'est pas joint, ce qui est bien). Mais il **n'est pas exposé dans `electron/preload/index.ts`** ni dans `src/lib/ipc.ts`, et aucun écran n'appelle `cloudSignOutEverywhere`, ni sur le desktop ni sur le web. Le recours en cas de PC perdu n'est donc pas encore utilisable. **À faire :** le Back-end expose l'IPC dans le preload, puis le Front-end ajoute le bouton dans Compte (desktop et web), avec une confirmation et un message d'erreur clair hors ligne.

#### WSC-06 — Le bot ne lit plus toute la table `team_pool_entries` (19/11, modifs non commitées) : **OK**
**Périmètre :** `src/lib/teamCore.ts` (`getSharedTeam`, `fetchPoolRows`, `getGroupRosterUserIds`, `fetchPoolsByRosterIds`) et `cloudflare/discord-bot/src/index.ts`.

**Ce qui va :**
- `getSharedTeam` ne lit plus la table entière : seulement les lignes de pool des `roster_id` du groupe, avec `.in()` par lots de 100, sur l'index `team_pool_entries_roster_idx`. Le filtre `rosterIds.has()` reste en défense en profondeur.
- Le cron du bot ne lit plus que les `user_id` du roster du groupe (`scouting_id is null`, index `team_rosters_group_idx`) : ni pools, ni drafts, ni scouting. Avec le rôle service, le volume lu à chaque passage n'est plus proportionnel à toutes les équipes.
- Le comportement n'est pas réduit : les remplaçants y sont, les adversaires scoutés en sont exclus, ce qui est plus juste qu'avant.
- J'ai aussi relu les autres lectures du bot en service_role : toutes sont filtrées par `group_id`, `guild_id`, `event_id` ou `user_id`. Seule `listPendingDirectNotifications` lit les notifications de tous les utilisateurs, mais elle est limitée aux types envoyés en message privé et aux dernières 24 h, et chacun ne reçoit que les siennes. C'est voulu.

**Suggestion (minime, non bloquante) :** `handleCommonAvailability` et `handleScrims` appellent encore `getSharedTeam`, qui charge aussi pools et drafts alors qu'ils n'en ont pas besoin. Utiliser `getGroupRosterUserIds` pour le premier, et une lecture roster + scouting pour le second, réduirait encore ce que la clé service lit, par minimisation. À regrouper avec S19-03, qui touche le même fichier.

#### S19-03 — Autorisations du bot Discord (19/11, modifs non commitées, rien de déployé) : **OK**
**Périmètre :** `cloudflare/discord-bot/src/handlers.ts`, `cloudflare/discord-bot/scripts/register-commands.mjs`, `src/lib/discordBotCore.ts` (`getGroupMemberRole`, `canManageDiscordServer`, `isChannelStaffRole`), `src/lib/teamCore.ts` (options de `getSharedTeam`), `tests/unit/discordBotHandlers.test.ts` (8 cas, couvrant `away` et `back` refusés à un non-membre, et le masque de permissions).

**Ce qui va :**
- `/availability` : le contrôle d'appartenance au groupe (`group_members`) passe **avant** toute lecture d'option ou toute écriture, pour `away` comme pour `back`. La faille S19-03 est fermée.
- `/set-channel` : accepté avec Gérer le serveur ou Administrateur, lus dans `member.permissions`. Ce champ est fiable : il fait partie du corps signé Ed25519 et c'est Discord qui le calcule. Sinon, il faut être owner, coach ou manager du groupe, via le compte Discord lié. Le masque de bits est lu en `BigInt` avec une regex numérique, et toute valeur absente ou invalide est refusée.
- `default_member_permissions = Manage Server` sur `/link-team` et `/set-channel` : la commande est cachée par défaut, et le handler revérifie pour `/set-channel`.
- Minimisation : `/common-availability` passe par `getGroupRosterUserIds`, `/scrims` par `getSharedTeam` sans pools ni drafts.
- Codes de liaison : 6 caractères sur un alphabet de 31 (environ 8,9·10⁸ combinaisons), tirés par `crypto.getRandomValues` sans biais, valables 15 min (serveur) ou 10 min (utilisateur), à usage unique. Le brute force n'est pas réaliste vu les limites de débit de Discord.

**Réserve (basse, non bloquante) :** `handleLinkTeam` ne revérifie pas les permissions : il ne compte que sur `default_member_permissions`, que les admins d'un serveur peuvent élargir. Et `redeemGuildLinkCode` fait un `upsert` sur `guild_id` : quelqu'un qui détient un code valide **pour son propre groupe** et peut lancer la commande peut **re-lier un serveur déjà lié** à un autre groupe. Les rappels de l'équipe d'origine s'arrêtent alors, et `/availability` vise l'autre groupe. Avec les permissions par défaut, seuls les admins du serveur le peuvent, donc le risque est faible. **Correctif :** dans `handleLinkTeam`, exiger `canManageDiscordServer`, et refuser de remplacer un lien existant vers un **autre** groupe sans cette permission (ou demander de délier d'abord).

**Au déploiement :** relancer `scripts/register-commands.mjs`, sinon les `default_member_permissions` ne s'appliquent pas aux commandes déjà enregistrées. Puis redéployer le worker, avec l'accord de l'utilisateur.

### Revue avant release (règle permanente)
À chaque livraison, CyberSecurity vérifie : advisors Supabase (sécurité), RLS des nouvelles tables et fonctions, `npm audit` (aucune nouvelle haute en exécution), présence de secrets dans `out/` et `app.asar`, CSP inchangée ou justifiée, nouveaux IPC validés par zod, et rend son verdict au Chief.

---

## 26/11/2026 — Passe Security (décisions du 26/11)

**Verdict : Electron 45.4.1 prêt à fusionner, une migration prête mais non appliquée, le reste déjà corrigé en production.**

- **S19-01 Electron :** branche locale `sec/electron-45` (worktree `wt-electron45`, 2 commits, rien poussé) : Electron 45.4.1, electron-builder 26.18.1, fuses (`runAsNode` et `NODE_OPTIONS` coupés, inspect coupé, intégrité ASAR et `onlyLoadAppFromAsar` actifs), API presse-papiers asynchrone (`lft.ipc.ts`, `share.ipc.ts`). Vérifié : typecheck, 2197 tests, `electron-builder` (fuses appliquées, ffmpeg épinglé), l'exe packagé démarre. **À tester à la main avant release :** capture WGC/ddagrab, `nxm:` (Range 206), `safeStorage`, mise à jour automatique.
- **npm :** `npm audit fix` non cassant, 45 → 12 (dont 2 critiques de dev : `vitest`/`tinypool`, majeure v5 ; `zod` 3 haute, `react-router` 6 modérée : migrations dédiées). `riot-proxy` et `discord-bot` : 0.
- **Dispos hors groupe :** déjà bloqué en base (`availability_rules_write` et `availability_exceptions_write` exigent `group_role(group_id, user_id)`) et dans le bot Discord (`getGroupMemberRole` avant toute écriture). Aucune action.
- **Drafts et données d'équipe liés à un seul groupe :** migration `20261126090000_team_data_scoped_to_linked_group.sql` (**non appliquée, accord de mise en production requis**). Les lignes `Team`, `TeamMember`, `ChampionPoolEntry`, `CustomGame` et `DraftPrep` de `sync_records` ne sont lisibles que par le staff du groupe auquel l'équipe est liée (`Team.groupId`), plus le partage `share_team`. Une équipe sans groupe n'est plus partagée. Testée en transaction annulée sur la production : 3 équipes sur 4 liées, 140 des 173 entrées de pool, 7 des 9 membres ; le `CustomGame` non lié (1) cesserait d'être partagé.
- **`team_sessions` « modifiable sur toutes les colonnes » (S19-13) :** **déjà réduit en production.** `authenticated` ne peut mettre à jour que `status`, `responsible_user_ids`, `queue_filter`, `started_at`, `ended_at` (vérifié par `has_column_privilege`), et seulement s'il gère la session. Sur `team_session_games`, seuls `status`, `match_json`, `our_team_id`, `enemy_team_name` : `session_id` et `reported_by` ne bougent plus. Reste : l'auteur d'une partie peut réécrire `match_json` (sans limite de taille) ; dire si on veut le borner.
- **Advisors Supabase :** les `run_*` ne sont plus exposés ; il ne reste que les 21 fonctions `SECURITY DEFINER` appelables par `authenticated`, qui se contrôlent elles-mêmes, et 4 tables sans policy voulues.
- **Litterbox :** l'envoi se fait depuis le processus principal (`share.ipc.ts`), aucune origine à ajouter à la CSP ; reste la mention dans la politique de confidentialité (Front).
