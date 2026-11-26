> **ARCHIVÉ le 26/11/2026** : document livré ou remplacé, gardé pour l'historique. Ne pas suivre comme instruction.

# Mise en production groupée de la beta.10 (Back-end)

Back-end, 20/11/2026. Liste exacte, dans l'ordre. **Chaque étape demande l'accord direct de l'utilisateur.** On
s'arrête à la première erreur et on applique le retour arrière de l'étape. Rien de cette liste n'est encore fait.

Les déploiements partent d'un **export du commit de la beta.10** (`git archive` dans un dossier temporaire, plus
une jonction vers `node_modules`), jamais du dossier partagé, pour ne pas embarquer le travail non commité des autres
sessions. wrangler se lance avec `node cloudflare/discord-bot/node_modules/wrangler/bin/wrangler.js`.

## 0. Avant de commencer (local, sans accord)

```
node scripts/test-release-beta10.mjs    <dossier PGlite 0.3.16>   # répétition : les 3 migrations, retour arrière, schéma de prod retrouvé
node scripts/test-schema-baseline.mjs   <dossier PGlite 0.3.16>   # le dépôt reconstruit la prod
node scripts/test-analyst-tables.mjs    <dossier PGlite 0.3.16>
node scripts/test-scrims-in-planning.mjs <dossier PGlite 0.3.16>
node scripts/test-roster-member-link.mjs <dossier PGlite 0.3.16>
npx vitest run && npm run lint && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json
```

Contrôles en lecture seule sur la prod juste avant l'étape 1 :
- `select version, name from supabase_migrations.schema_migrations order by version desc limit 3;` : la dernière
  doit toujours être `20261119211601 member_staff_roles`. Sinon, quelqu'un a appliqué autre chose : on s'arrête et
  on rafraîchit la baseline d'abord.
- `select group_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) k, count(*) from public.team_scouting group by 1, 2 having count(*) > 1;`
  pour voir les doublons de clé d'adversaire que la 120000 renommera en « (2) ». Il y en avait 0 le 20/11.

## 1. Migrations Supabase (dans cet ordre)

Chacune s'applique avec `apply_migration` (le nom sans le numéro), après l'accord. **L'outil enregistre la
migration sous l'horodatage de l'application, pas sous le numéro du fichier** : l'étape 6 renomme les fichiers en
conséquence.

| # | Fichier | Retour arrière | Ce que l'utilisateur perd en cas de retour arrière |
|---|---|---|---|
| 1a | `20261119290000_analyst_draft_log_dossiers.sql` (#40) | `supabase/rollback/20261119290000_rollback.sql` | le journal des drafts, les dossiers adverses et les résumés de games écrits depuis |
| 1b | `20261120120000_scrims_in_planning.sql` (#49) | `supabase/rollback/20261120120000_rollback.sql` | les liens créneau ↔ scrim (les créneaux et les adversaires restent) |
| 1c | `20261120130000_roster_member_link.sql` (#46) | `supabase/rollback/20261120130000_rollback.sql` | rien (les rattachements faits restent) |

Contrôles après chaque migration :
- `get_advisors` (sécurité) : aucun nouvel avertissement « anon peut exécuter ».
- **1a** : les tables `draft_log` et `opponent_dossiers` existent, avec le RLS activé. `set_opponent_dossier_status` et
  `set_team_game_timeline_summary` sont exécutables par authenticated seulement. Pour `team_session_games`, contrôle
  CyberSecurity S19-13 :
  - les politiques `_insert` (`reported_by = auth.uid()`), `_update` et `_delete` (auteur ou `can_manage_session`)
    remplacent `team_session_games_write` ;
  - `reported_by` vaut `auth.uid()` par défaut ;
  - authenticated n'a `UPDATE` que sur `status, match_json, our_team_id, enemy_team_name` ;
  - test de fumée dans une transaction annulée : un joueur déclare une partie (insert sans `reported_by`).
- **1b** :
  - les colonnes `scrims.calendar_event_id`, `kind` et `opponent_key`, et `team_scouting.opponent_key`, `source` et
    `opgg_url` existent ;
  - `select count(*) from scrims where calendar_event_id is null` vaut 0 (le backfill a fonctionné) ;
  - `save_match_event` et `update_match_detail` sont réservées à authenticated ;
  - test de fumée en tant qu'owner, dans une transaction annulée ensuite : `save_match_event`, puis lecture du scrim
    et de l'adversaire créés.
- **1c** : `link_roster_member` est réservée à authenticated.
- **Pour finir** : `node scripts/test-schema-baseline.mjs` doit encore passer. Il exclut les migrations que la prod
  n'a pas, jusqu'à l'étape 6.

## 2. Bot Discord (à ajouter à la liste du Chief, juste après 1b)

Le bot a changé avec #49 : un créneau Scrim ou Officiel est annoncé une seule fois, `/calendar` le liste une fois,
et `/scrims` retrouve l'OP.GG de l'adversaire par sa clé. Le code lit `calendar_event_id` avec un repli : il marche
aussi avant 1b. Mais déployé avant 1b, il annoncerait encore deux fois.
- `cd cloudflare/discord-bot && wrangler deploy` (depuis l'export).
- Contrôle : `/calendar` et `/scrims` sur le serveur de test ; aucun nouveau secret n'est nécessaire.
- Retour arrière : `wrangler rollback` vers la version précédente.

## 3. Proxy Riot

Changements : la marge interactive de 20 % dans la part de chaque joueur (#46 point 2). Elle se compose de
`USER_INTERACTIVE_RESERVE = "0.2"` dans le budget, et d'un second limiteur par joueur, `USER_LIMITER_BACKGROUND`
(16/min, namespace 1002), pour les appels en arrière-plan.
- `cd cloudflare/riot-proxy && wrangler deploy` (depuis l'export). Le binding de limitation se crée tout seul, il
  n'y a ni secret ni bucket à créer.
- Contrôles :
  - un appel authentifié rend 200 ;
  - `x-rate-limit-type: proxy-user-background` n'apparaît que sur les appels en arrière-plan d'un joueur au-delà de
    16/min ;
  - les métriques Analytics Engine `riot_proxy` restent normales.
- Retour arrière : `wrangler rollback`.
- Coût : aucun changement (même nombre de requêtes Workers, R2 inchangé).

## 4. Hébergement des détourages (Worker statique `ascend-cutouts`)

- `cd cloudflare/cutouts && wrangler deploy`. Il envoie `D:\DEV\NexusMind\cutout-pack-hosted` : 1 608 détourages
  (98,1 Mo) et `manifest.json`, hors dépôt. La source `cutout-pack` n'est pas touchée.
- Contrôles :
  - `https://ascend-cutouts.nexusmind-riot-proxy.workers.dev/manifest.json` rend 200 et liste 1 608 skins ;
  - un `.webp` rend 200, en `image/webp`, avec `cache-control: public, max-age=604800, immutable` ;
  - un id refusé rend 404.
- Coût : **0 €** (fichiers statiques gratuits et illimités, pas de script, pas de R2).
- Retour arrière : `wrangler delete ascend-cutouts` (rien ne s'en sert encore). Le branchement de l'app
  (`championCutout.ts` qui lit d'abord le détourage hébergé) viendra après, dans une version suivante.

## 5. Web app (`nexusmind-web`, app.asc3nd.app)

- Prérequis : le commit de la beta.10 contient les lignes Front de `web/src/api.ts` du contrat #49
  (`calendarSaveMatchEvent`, `calendarGetMatchEvent`, `calendarUpdateMatchDetail`, `calendarListKnownOpponents`,
  `riotAccountExists`) et `teamLinkRosterMember`, plus les écrans. Le web ne doit pas partir avant 1b et 1c :
  sinon ses appels échouent.
- `cd web && npm run build && wrangler deploy` (depuis l'export ; le Worker de redirection et `_headers` sont
  inchangés).
- Contrôles :
  - `https://app.asc3nd.app/` rend 200, avec CSP et HSTS présents ;
  - l'ancienne adresse workers.dev renvoie un 301 ;
  - la page de connexion se charge ;
  - le Planning ouvre le pop-up Scrim ;
  - `/scrims` redirige vers le Planning.
- Retour arrière : `wrangler rollback`.

## 6. Rafraîchissement de la baseline (lecture seule en prod, dépôt seulement)

1. Lire les versions enregistrées :
   `select version, name from supabase_migrations.schema_migrations where version > '20261119211601' order by version;`
2. Renommer les 3 fichiers avec leur version de prod (`git mv`, contenu inchangé), puis mettre à jour les
   références dans `scripts/` et `tests/` (comme le 20/11). Faire de même pour les retours arrière.
3. Réexporter les deux fichiers de référence, en lecture seule :
   - `supabase/baseline/prod_migrations_<date>.txt`, avec la requête md5 du README ;
   - `supabase/baseline/prod_schema_<date>.txt`, avec `scripts/schema-snapshot.sql`.

   Mettre à jour leurs noms dans `test-schema-baseline.mjs` et `test-release-beta10.mjs`.
4. `node scripts/test-schema-baseline.mjs` : tout doit passer, avec « files production has not applied yet: none ».

## Ce que chaque étape débloque

| Étape | Effet visible |
|---|---|
| 1a | Analyste : journal des drafts, dossiers adverses, onglet Objectifs (#40) |
| 1b + 2 + 5 | Scrims dans le Planning (#49) ; bot sans double annonce |
| 1c + 5 | « Relier à un membre » (#46, « ore wa ayura ») ; les joueurs peuvent publier leur pool |
| 3 | Les cartes du Lobby ne restent plus bloquées derrière les lectures en arrière-plan (pire cas : de 57 s à 0 s) |
| 4 | Pack de détourages en ligne (l'app s'y branchera ensuite) |
| desktop beta.10 | Pools publiés repris sans appel Riot, `team:card-champions`, MVP en games d'équipe, identité republiée au démarrage, « Je joue aussi » |
