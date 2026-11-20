# Audit performance — 20/11/2026

Session Audit, lecture seule. Le lot 1 (Realtime, auth vérifiée une seule fois, store des groupes, requêtes filtrées) est en cours et n'est pas repris ici. Les chiffres Supabase couvrent la période **avant** ce lot : il faudra les remesurer une fois le lot déployé.

## 1. Mesures

### 1.1 Démarrage et pages (app compilée, Playwright, `NEXUSMIND_CLOUD_DISABLED=1`)

| Profil | Fenêtre | Tableau de bord affiché | Pages (plan, historique, stats, erreurs, revue, réglages, accueil) | RSS du processus principal |
|---|---|---|---|---|
| Profil vide, 1er lancement | 1 860 ms | 2 124 ms | — | — |
| Profil vide, à chaud (3 essais) | 694-799 ms | 1 007-1 232 ms | 17-192 ms | 142 Mo |
| **Copie de la vraie base** (494 Mo), 1er lancement | **2 945 ms** | 3 126 ms | 47-127 ms | 145 Mo |
| Copie de la vraie base, à chaud (2 essais) | 827-853 ms | 966-987 ms | 43-143 ms (réglages = la plus lente) | 143 Mo |

- **À chaud, le démarrage est correct** (< 1 s jusqu'au tableau de bord) et les pages s'ouvrent en moins de 150 ms. Le temps de rendu n'est pas le problème.
- **Le 1er lancement après une mise à jour coûte +2 s.** Une migration était en attente sur la copie : l'app a d'abord copié les 494 Mo de la base dans `backups/` (`database.ts:102-125`), ce qui explique l'écart de 2,1 s. L'utilisateur paie ce coût à chaque version qui contient une migration, c'est-à-dire presque toutes.
- Limite de la mesure : la base locale contient très peu de parties (`Game` < 4 lignes, presque tout est dans le cloud), et la mesure s'est faite cloud coupé. L'ouverture des pages d'équipe, qui passent par le réseau, n'est donc pas mesurée ; ce sera à refaire après le lot 1.

### 1.2 Bundles

| Build | JS initial | Gzip | Découpage |
|---|---|---|---|
| Desktop `out/renderer` | **3 123 Ko** (1 seul chunk) | — | `React.lazy` : 0 dans `src/App.tsx` |
| Desktop `out/main/index.js` | 1 028 Ko | — | — |
| Web `web/dist` | 2 658 Ko (1 seul chunk) | **807 Ko** | aucun |

**Régression PE-1.** Le renderer pesait 2 844 Ko après la tâche F (19/11) ; il pèse maintenant 3 123 Ko (+280 Ko en un jour), au-dessus du seuil de 3 Mo.

Ce qui pèse dans le web, en part du code source avant minification (≈ 4,9 Mo au total) :

| Poste | Part |
|---|---|
| Famille recharts (recharts, lodash, d3-*, react-smooth, decimal.js-light) | **≈ 17 %**, chargée au démarrage alors que seuls Stats / Équipe l'utilisent |
| Supabase (auth-js, postgrest, storage, realtime, phoenix) | ≈ 14 % |
| Code de l'app | `src/lib` 12 %, `pages/Team` 5,4 %, Coaching 3,4 % |
| Autres | @remix-run/router 3,9 %, react-dom 2,6 %, i18next 1,6 %, tailwind-merge 1,5 %, lucide-react 1,4 % |
| JSON chargés d'emblée (L23) | `en.json` 245 Ko + `fr.json` 268 Ko + `codex.json` 248 Ko ≈ **760 Ko**, alors qu'une seule langue sert |

### 1.3 Base locale (copie de la base réelle de l'utilisateur, 494 Mo)

| Poste | Taille |
|---|---|
| Fichier | 471 Mo, dont 47 Mo de pages libres (VACUUM jamais fait) |
| `MatchCache` | 1 633 lignes ; `matchJson` 121 Mo ; **431 timelines = 301 Mo** (≈ 700 Ko chacune, JSON brut non compressé) |
| Timelines liées à une partie locale (`Game`) | 0 : ce sont des timelines de scouting / d'autres joueurs |
| Autres tables | négligeables (`PlayerGameScore` 530 lignes, le reste < 100) |
| **`data/backups`** | **2,1 Go** : 5 sauvegardes de migration (`MAX_MIGRATION_BACKUPS = 5`, 228-494 Mo chacune) + des copies manuelles `before-delete-*` |

- Toutes les lignes de `MatchCache` datent de novembre 2026 : la purge à 90 jours (tâche M) ne libérera rien avant février.
- La croissance vient des timelines (≈ 700 Ko par partie scoutée). Un scout complet de 5 joueurs peut ajouter plusieurs dizaines de Mo.

### 1.4 Supabase (production, lecture seule)

Fenêtre mesurée : `pg_stat_statements` du 12/11 18:14 au 20/11 12:25 (≈ 11 900 min), tous utilisateurs confondus, avant le lot 1.

| Requête | Appels | Par minute | Part | Temps moyen |
|---|---|---|---|---|
| Requêtes PostgREST (1 `set_config` par requête) | 114 508 | **9,6** | 100 % | 2,5 ms |
| Auth (`sessions`, `users`, `identities`, `mfa_*`, ≈ 5 lectures par vérification) | ≈ 30 000 vérifications | 2,5 | — | 1,9 ms (users) |
| `notifications` (utilisateur) | 21 477 | 1,8 | 19 % | 2,7 ms |
| `team_sessions` | 16 903 | 1,4 | 15 % | 1,2 ms |
| `announcements` | 12 711 | 1,1 | 11 % | 1,5 ms |
| `announcement_dismissals` | 10 196 | 0,9 | 9 % | 1,2 ms |
| `sync_records` | 9 461 | 0,8 | 8 % | 0,7 ms |
| `BEGIN` / `SET client_encoding` (connexions directes, pooler) | ≈ 16 000 | 1,3 | — | **7,2-7,4 ms** |

- Aucune requête lente : tout reste sous 3 ms côté base, sur des tables minuscules (la plus grosse, `sync_records`, fait 1 375 lignes et 1,2 Mo).
- Le coût réel, c'est **le nombre d'appels**. Notifications + annonces + dismissals + sessions représentent 54 % des appels : c'est du polling, et le lot 1 (Realtime) le vise. 9,6 req/min pour une poignée d'utilisateurs donnerait ≈ 1 000 req/min à 100 utilisateurs actifs.
- Index : **70 clés étrangères sans index** (`created_by`, `user_id`, `group_id`…). Impact nul aujourd'hui, mais coût linéaire à la suppression d'un compte (cascades) et dans les politiques RLS filtrées sur `user_id`. Les plus utiles à indexer : `group_sharing.user_id`, `team_rosters.user_id`, `announcement_dismissals.user_id`, `calendar_event_attendees.user_id`, `availability_rules.user_id`, `availability_exceptions.user_id`, `scrim_availability.user_id`, `team_session_attendance.user_id`, `tasks.assignee_id`, `discord_guild_link_codes.group_id`, `calendar_event_requests.group_id`.
- `group_members` : 36 722 seq scans sur 3 lignes. C'est normal à cette taille (le planner choisit le scan), rien à faire.

### 1.5 Riot

- Après une partie : 3 à 5 appels (match, timeline, rang, éventuellement maîtrise).
- Scout complet de 5 joueurs : ≈ 1 500 appels. Avec la clé Personal (100 appels / 2 min partagés par tous via le proxy), un seul scout occupe le budget pendant ≈ 30 min.
- Le cache R2 partagé du proxy (phase 1) est livré mais **pas déployé**, faute d'accord de l'utilisateur.

### 1.6 Arrière-plan

- `backgroundThrottling: false` sur la fenêtre principale (`index.ts:299`), donc le polling continue fenêtre réduite.
- Il reste deux `setInterval` de 60 s, un de 5 s et un de 1 s dans `src/`.
- Aucune virtualisation de liste (aucune bibliothèque) ; les listes actuelles sont courtes.

## 2. Optimisations restantes, par gain / effort

Effort : **S** < ½ j, **M** ≈ 1 j, **L** > 2 j.

| # | Optimisation | Gain attendu | Effort | Réf. |
|---|---|---|---|---|
| **1** | **Routes en `React.lazy` + `manualChunks`** (recharts, Supabase, Team, Coaching, revue vidéo à part), desktop et web | Web : JS initial 807 → ≈ 350-400 Ko gzip (≈ −50 %). Desktop : parse initial −1 Mo. Corrige la régression PE-1. | M | UI-09, WSC-20, PE-1/2 |
| **2** | **Sauvegardes de migration** : garder 2 au lieu de 5, les compresser (gzip ≈ ×5 sur SQLite), appliquer la rotation aussi aux `before-delete-*`, faire `VACUUM INTO` plutôt qu'une copie brute | Disque : 2,1 Go → ≈ 200 Mo. Copie plus rapide au 1er lancement après une mise à jour (−1 à −2 s). | S | E06 |
| **3** | **Timelines compressées ou écrémées** : gzip de `timelineJson` (≈ ×8-10) ou ne garder que les champs lus ; purge à 14 j des timelines de scouting non liées à une partie de l'utilisateur ; `VACUUM` après la purge | Base : 494 → ≈ 150 Mo. Lecture plus rapide des stats. Croissance divisée par ≈ 8. | M | L07, M |
| **4** | **Polling vers Realtime, et regroupement des lectures au démarrage** : lot 1 + une RPC unique « boîte de réception » (notifications + annonces + dismissals) ; pause du polling restant quand la fenêtre est masquée (`visibilitychange`), même avec `backgroundThrottling: false` | ≈ −54 % des requêtes Supabase (lot 1), ≈ −10 % de plus avec la RPC, et ≈ 0 req/min fenêtre réduite. Remesurer après le lot 1. | S-M | PE-4, FE-5, UI-11 |
| **5** | **Déployer le cache R2 partagé du proxy Riot** (déjà codé) | Scouts répétés et match-v5 servis depuis le cache. Pour un adversaire déjà scouté par un autre utilisateur, ≈ −80 % des appels. Débloque le budget de la clé. **Demande l'accord de l'utilisateur** (déploiement, coût R2 dans le gratuit). | S | Proxy phase 1 |
| 6 | Langues à la demande : charger seulement la locale active, `codex.json` en import dynamique | −500 Ko de JSON parsés au démarrage | S | L23 |
| 7 | Index sur les 11 FK listées en 1.4 (migration + rollback) | Évite une dette quand la base grandira ; suppression de compte en O(log n) | S | — |
| 8 | Remise à zéro de `pg_stat_statements` juste après le lot 1, puis remesure à J+2 | Mesure fiable du gain du lot 1 (sinon les vieux chiffres masquent l'effet). **Écriture en prod : accord de l'utilisateur.** | S | — |
| 9 | Re-rendus du lecteur de revue vidéo (sélecteurs fins, `memo`) | Fluidité de la revue ; non mesuré | M | UI-13 |
| 10 | Travail du main au démarrage différé après l'affichage de la fenêtre (détecteur, sync, DDragon) | Démarrage à froid −100 à −300 ms (estimation) | M | E04 |
| 11 | Requêtes N+1 `getRecording` dans l'historique | Négligeable à < 50 parties, sensible à 500+ | S | — |
| 12 | Virtualisation de l'historique et des icônes de draft | Utile seulement au-delà de ≈ 300 éléments ; aujourd'hui inutile | M | — |

Déjà fait, à ne pas refaire : E02/E09 (tâche G), UI-08 minification (F), Data Dragon en promesse unique et icônes paresseuses (T), purge MatchCache à 90 j (M).

## 3. Critères chiffrés ajoutés à QUALITY_CRITERIA

PE-6 à PE-10 (§ 7). Les seuils viennent des mesures ci-dessus, avec une marge.

| Code | Seuil |
|---|---|
| PE-6 | Démarrage à chaud : fenêtre < 1,5 s, tableau de bord < 2 s. 1er lancement après mise à jour < 3 s. |
| PE-7 | Ouverture d'une page principale < 300 ms sur la vraie base |
| PE-8 | Au repos : ≤ 3 req/min Supabase par client fenêtre visible, ≈ 0 fenêtre masquée |
| PE-9 | Web : JS initial < 600 Ko gzip. Desktop : chunk initial < 2,5 Mo. |
| PE-10 | Base locale < 300 Mo et `backups` < 1 Go pour un utilisateur actif |
