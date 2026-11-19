# Clé Riot de production — état, fonctionnalités bridées, plan en deux phases (#42)

> Session **Audit**, 19/11/2026, en lecture seule. Fichiers relus :
> - `electron/main/riotClient.ts`, `riotTransport.ts`, `gameDetector.ts` ;
> - `src/lib/riotLimits.ts` ;
> - `cloudflare/riot-proxy/src/{index,routing}.ts`, `wrangler.toml` ;
> - `electron/main/ipc/team.ipc.ts`, `account.ipc.ts` ;
> - `web/src/riotWeb.ts`.
>
> Règles Riot relevées le 19/11/2026 sur les pages officielles :
> - <https://developer.riotgames.com/docs/portal> ;
> - <https://developer.riotgames.com/docs/lol>.

## En bref

1. **Ascend tourne sur une clé « Personal ».** Elle est permanente, mais
   limitée à **20 requêtes/s et 100 requêtes/2 min par région**, **pour toute
   l'app** : tous les utilisateurs passent par le même proxy et la même clé.
2. **Le point le plus urgent n'est pas technique, c'est la politique de
   Riot.** Elle réserve la clé Personal à un usage « personnel ou petit
   groupe privé » et l'interdit pour un usage **public, « même en alpha ou en
   bêta »**. Ascend est publié (pré-versions GitHub, web app, site
   vitrine) : la clé peut être révoquée. **La demande de clé de production
   devient donc un prérequis à l'ouverture publique**, pas une simple
   optimisation.
3. **La clé de production multiplie le débit par environ 250** (500/10 s et
   30 000/10 min par région). Elle ouvre aussi l'**API Tournaments**
   (codes de tournoi, donc scrims récupérés automatiquement au lieu du CSV)
   et **RSO**, la connexion Riot qui prouve qu'un compte appartient bien à
   l'utilisateur.
4. **Phase 1, sans la clé :** le plus gros gain est un **cache partagé des
   parties dans le proxy Cloudflare**. Une partie terminée ne change plus
   jamais : la récupérer une fois pour tous les utilisateurs divise les
   appels à Riot. Viennent ensuite une file d'attente avec priorités et des
   scouts incrémentaux.

## 1. État actuel

### La clé

| Élément | Valeur | Source |
|---|---|---|
| Type | **Personal** : permanente, sans renouvellement quotidien | mémoire projet (12/11) ; limites par défaut dans le code (`riotClient.ts:182-192`, « PERSONAL-TIER defaults ») |
| Où elle vit | secret `RIOT_API_KEY` du Worker `nexusmind-riot-proxy` ; en local, `RIOT_DEV_API_KEY` (mode direct, dev seulement, jamais embarqué) | `cloudflare/riot-proxy/src/index.ts:10-13`, `riotTransport.ts:12-52` |
| Limites Riot | **20 req/s et 100 req/2 min, par région** ; pas d'augmentation possible ; pas d'API Tournaments | page Portal de Riot |
| Usage autorisé | « personal or small private use… **not public use, even in alpha or beta** » | page Portal de Riot |
| Partage | **une seule clé pour tous les utilisateurs et tous les appareils** : le desktop (processus principal) et la web app passent par le proxy | `riotTransport.ts`, `web/src/riotWeb.ts` |

### Les protections en place

- **Côté app :** limiteur à plusieurs fenêtres (`MultiWindowLimiter`,
  `riotClient.ts:92`), réglé sur 20/1 s + 100/120 s, qui se recale sur les
  en-têtes `X-App-Rate-Limit` renvoyés par Riot. Il respecte `Retry-After`
  (`:269`). **Il est par appareil** : deux utilisateurs actifs pensent chacun
  disposer des 100 requêtes, alors que la clé est commune.
- **Côté proxy :** authentification Supabase obligatoire, liste blanche de
  9 endpoints en lecture, et limite **par utilisateur de 300 req/min**
  (`wrangler.toml`), soit 6 fois la limite de toute la clé. Aucune file
  globale, aucun cache.
- **Cache local :** `MatchCache` dans SQLite, par appareil. La même partie
  est retéléchargée par chaque coéquipier et par la web app.

### Endpoints utilisés (liste blanche du proxy, `routing.ts:17-27`)

| Endpoint | Usage dans Ascend |
|---|---|
| `account-v1` by-riot-id / by-puuid | lier un compte, résoudre un joueur scouté |
| `summoner-v4` by-puuid | icône, niveau |
| `champion-mastery-v4` top | auto-remplissage du champion pool (30 maîtrises) |
| `league-v4` entries by-summoner / by-puuid | rang (le second n'est jamais appelé : WSC-23) |
| `match-v5` ids by-puuid | historiques : SoloQ 420, Flex 440, Clash 700, toutes files |
| `match-v5` match | détail d'une partie |
| `match-v5` timeline | analyse fine : micro-review, détecteurs, radar |

Pas d'appel à `spectator-v5`, `clash-v1`, `tournament-v5` ni RSO. La
détection de partie en cours passe par la **Live Client Data API** locale
(port 2999, `gameDetector.ts`), qui ne dépend pas de la clé.

### Ce que coûte une action, avec la clé actuelle

Rythme soutenu : **100 requêtes par 2 min, soit ≈ 0,83 requête/s pour toute
l'app**.

| Action | Appels Riot (ordre de grandeur) | Durée seule sur la clé | Avec 10 utilisateurs actifs en même temps |
|---|---|---|---|
| Fin de partie (enrichissement : ids + match + timeline) | 3-5 | quelques secondes (rafale) | goulot dès plusieurs fins de partie simultanées |
| Historique : premier affichage d'un compte (≤ 50 parties) | 51 | ≈ 1 min | plusieurs minutes |
| Scout « rapide » d'un joueur (100 parties) | ≈ 101-103 | ≈ 2 min | ≈ 20 min |
| Scout « complet » d'un joueur (saison, ~300 parties) | ≈ 310 | ≈ 6 min | bloque l'app pour tous |
| Scout d'une équipe adverse de 5, complet | ≈ 1 500 | **≈ 30 min** | inutilisable |
| Synergie d'équipe (5 × 100 Flex, dédoublonnées) | 100-500 | 2-10 min | idem |

## 2. Fonctionnalités bridées

| # | Fonctionnalité | Aujourd'hui | Avec la clé de production |
|---|---|---|---|
| F1 | **Scrims et tournois** | Import **manuel d'un CSV** tiré d'un replay ROFL (Replaybook), un fichier par partie (`team.ipc.ts:1123-1290`). Le type est deviné d'après le nom du fichier (« scrim », « tournoi »). Les joueurs sont reconnus par leur pseudo, faute de puuid (`:1311`). | **API Tournaments** : Ascend crée un code de tournoi pour chaque scrim. À la fin de la partie, Riot appelle le serveur d'Ascend (callback), puis la partie est récupérée par `match-v5` avec puuids et timeline : **plus aucun CSV**, avec micro-review, détecteurs et stats comme en SoloQ. Riot conseille un code par partie. |
| F2 | **Historique des parties customs** (hors codes de tournoi) | Inaccessible ; rien n'est tenté. | Riot : visible **par le joueur lui-même via RSO** ; affichage public seulement avec l'accord du joueur. Possible pour son propre historique custom, pas pour scouter les customs d'un autre. |
| F3 | **Scouting d'une équipe adverse** | Lent (environ 30 min pour 5 joueurs en complet). Choix « rapide » ou « complet » (`riotLimits.ts`). Pendant ce temps, la clé est saturée pour tout le monde. | ≈ 50 req/s : une équipe complète en **moins d'une minute**. Monter `QUICK_SCOUT_MATCH_COUNT`, `SEASON_LIST_MAX_PAGES_*`, `MATCH_FETCH_CONCURRENCY` (déjà prévu dans `riotLimits.ts`). |
| F4 | **Synergie et stats combinées d'équipe** | 100 parties Flex par membre maximum ; plusieurs minutes. | Saison entière, en quelques secondes. |
| F5 | **Ajout d'adversaires** | Saisie du Riot ID, ou collage d'une URL multi-search op.gg / blitz (`multiGgParser.ts`), ce qui est déjà une saisie assistée. | Inchangé (pas d'API de recherche d'équipe), mais la résolution des 5 comptes devient instantanée. |
| F6 | **Lien compte Riot ↔ utilisateur** | Le joueur **tape** son Riot ID ; **aucune preuve qu'il en est le propriétaire** (`account.ipc.ts`). Rejoindre un groupe exige un compte Riot, mais n'importe qui peut déclarer celui d'un autre. | **RSO** (connexion Riot) : le compte est prouvé. Réservé aux produits approuvés. |
| F7 | **Historique, stats et radar à la première ouverture** | Jusqu'à 50 parties par compte, lentes au premier chargement, puis en cache local. | Instantané ; profondeur réglable. |
| F8 | **Fin de partie / micro-review** | Fonctionne, mais une rafale de fins de partie (soirée de scrims, 10 joueurs) se partage les 100 req/2 min. Un retard de publication par Riot cause E10 (corrigé côté logique). | Plus de goulot. |
| F9 | **Web app** | Mêmes limites, même clé, depuis le navigateur. | Idem desktop. |
| F10 | **Croissance** | Au-delà d'une dizaine d'utilisateurs actifs en même temps, les 429 et les attentes deviennent la norme. Des 429 répétés peuvent valoir à la clé une **mise sur liste noire** temporaire par Riot. | Plafond 250 fois plus haut, et augmentable sur dossier. |
| F11 | **Messages d'erreur** | Sur un 401/403 en mode direct, l'app dit « Development keys expire every 24 hours… » (`riotClient.ts:285`, `:322`), ce qui est faux pour une clé Personal. | — (à corriger dès maintenant, P3) |

Non bridé par la clé, donc faisable dès maintenant si utile :
- `spectator-v5` (partie en cours d'un adversaire scouté) ;
- `clash-v1` (équipes Clash) ;
- la Live Client Data API (déjà utilisée).

Attention : la règle Riot interdit de donner des informations « inconnues du
joueur » pendant une partie. Un affichage de spectator **pendant ses propres
parties** est donc à éviter.

## 3. Phase 1 — maintenant, sans la clé de production

Classées par gain sur le quota partagé.

| # | Optimisation | Détail | Session | Effort |
|---|---|---|---|---|
| P1-1 | **Cache partagé des parties dans le proxy** | `match-v5` match et timeline sont **immuables** une fois la partie finie. Les mettre en cache dans le Worker (Cache API Cloudflare, ou KV / R2 pour la durée) avec l'URL comme clé : la 2ᵉ demande de la même partie, par n'importe quel utilisateur ou appareil, ne coûte **plus rien** sur la clé. Gain énorme entre coéquipiers (mêmes parties Flex, scrims, synergie) et pour la web app. Ne jamais mettre en cache les `ids` ni `league` (ils changent). | backend-dev (déploiement du Worker : **accord de l'utilisateur**) | M |
| P1-2 | **Limiteur global au proxy** | Aujourd'hui chaque appareil croit avoir 100/2 min. Un compteur global dans le Worker (Durable Object, ou limiteur Cloudflare par région) avec un **budget réservé** aux appels interactifs (fin de partie, historique) et le reste aux tâches de fond (scout, synergie). Le Worker renvoie 429 + `Retry-After` **avant** Riot, ce qui protège la clé d'une liste noire. Baisser aussi `USER_LIMITER` (300/min, irréaliste) à environ 60/min. | backend-dev | M |
| P1-3 | **File d'attente avec priorités côté app** | Dans `MultiWindowLimiter` : 3 niveaux (fin de partie > écran ouvert > scout ou synergie en fond). Un scout ne doit jamais retarder la récupération d'une partie qui vient de finir. Afficher la file (« 3 joueurs en attente, ~4 min ») au lieu d'un spinner. | backend-dev (limiteur) + frontend-dev (affichage) | M |
| P1-4 | **Scouts incrémentaux** | Garder `seasonMatchIdsJson` (déjà stocké) et, au scout suivant, ne demander que les ids **postérieurs** au dernier vu (`startTime`), puis seulement les parties absentes du cache. Un rescout passe d'environ 300 appels à quelques-uns. | backend-dev | S-M |
| P1-5 | **Scouting de fond et reprise** | Les scouts complets tournent en tâche de fond qui survit à la navigation et reprend après un redémarrage (file persistée en SQLite). Notification à la fin. | backend-dev + frontend-dev | M |
| P1-6 | **Ne pas retélécharger la timeline** | Timeline seulement quand un écran en a besoin (micro-review, détecteurs) : pas pour le scout ni la synergie (déjà largement le cas, à vérifier endpoint par endpoint). E09 : une seule récupération par partie dans le flux post-partie. | backend-dev | S |
| P1-7 | **Import CSV assisté** (scrims) | Glisser-déposer de plusieurs CSV d'un coup ; détection du type (scrim ou tournoi) par l'événement du Planning plutôt que par le nom du fichier ; rapprochement pseudo → puuid via les comptes connus du groupe (pour retrouver les stats SoloQ du même joueur) ; rattachement automatique au scrim du Planning le plus proche dans le temps. | frontend-dev + backend-dev | M |
| P1-8 | **Preuve de propriété du compte Riot** | Sans RSO : demander au joueur de mettre **une icône d'invocateur donnée**, puis vérifier par `summoner-v4` (endpoint déjà autorisé). C'est la méthode classique des outils sans RSO. Ferme la faille « je déclare le compte d'un autre » dans les groupes. | backend-dev + frontend-dev, revue cybersecurity | S-M |
| P1-9 | **Nettoyage** | Retirer `league-v4 by-puuid` et `account-v1 by-puuid` de la liste blanche s'ils restent inutilisés (WSC-23). Corriger le message « Development keys expire every 24 hours » (F11). | backend-dev | S |
| P1-10 | **Mesurer** | Journaliser dans le Worker, par endpoint, le nombre d'appels, les 429 et le taux de réussite du cache. Ces chiffres serviront aussi au **dossier de demande** de la clé de production. | backend-dev | S |

**Ordre conseillé :** P1-10 (mesurer), puis P1-1 et P1-2 (le proxy, un seul
déploiement), puis P1-4, P1-3, P1-8, et le reste. P1-1 et P1-2 sont aussi
utiles après la clé de production : rien n'est jeté.

## 4. Phase 2 — avec la clé de production

### Ce qu'on active

| Étape | Contenu | Session |
|---|---|---|
| 2-1 | Remplacer le secret `RIOT_API_KEY` du Worker (aucune modification de l'app). Relever les constantes « ours to raise » de `riotLimits.ts` et les fenêtres par défaut du limiteur (20/1 s, 100/120 s → 500/10 s, 30 000/600 s ; le limiteur se recale de toute façon sur les en-têtes). | backend-dev |
| 2-2 | **Scrims par code de tournoi** : enregistrer un *provider* et un *tournament*, générer un code par partie de scrim depuis le Planning, ajouter un **endpoint de callback** (Worker ou edge function) qui reçoit la fin de partie, puis récupérer la partie via `match-v5`. Ajouter les endpoints `tournament-v5` au proxy (en POST, donc à séparer de la règle « GET seulement »). Garder l'import CSV en secours (scrims joués sans code). | backend-dev (callback, proxy) + frontend-dev (bouton « Code de tournoi » sur un scrim) |
| 2-3 | **RSO** : connexion Riot pour lier le compte, ce qui remplace P1-8. Donne aussi au joueur son propre historique custom. | backend-dev + frontend-dev, revue cybersecurity |
| 2-4 | Scouting « complet » par défaut, synergie sur la saison, historique plus profond. | backend-dev |
| 2-5 | Demander une hausse des limites si la mesure P1-10 le justifie. | Chief / utilisateur |

### Prérequis de la demande chez Riot

D'après le portail développeur :
- produit enregistré ;
- **vérifié** ;
- **prototype fonctionnel** ;
- **site complet** (« if it isn't complete, approval is unlikely ») ;
- revue par Developer Relations (conformité légale, utilité pour les joueurs,
  qualité) ;
- **clé sécurisée** ;
- un enregistrement par projet. Le délai d'approbation « varie ».

| Prérequis | État Ascend | Action |
|---|---|---|
| Produit enregistré sur developer.riotgames.com | à vérifier (la clé Personal en suppose un) | l'utilisateur relit la fiche et la passe en « large-scale product » |
| Prototype fonctionnel | ✅ app desktop + web app en bêta | — |
| Site complet et public | ⚠️ en ligne, mais **aperçu non indexé** (`noindex`) | rendre le site public avant de déposer la demande |
| Textes légaux | ⚠️ app en v0.1, site en v0.2, **v0.3 en brouillon** (#30) | publier la v0.3 avant la demande |
| Mention légale Riot (« isn't endorsed by Riot Games… ») | ✅ dans les CGU et la politique de l'app, et dans le texte du site | vérifier qu'elle est visible sur le site public et dans l'app |
| Clé sécurisée | ✅ jamais dans le client : proxy authentifié, liste blanche, secret Cloudflare | joindre la description au dossier |
| Respect des règles de jeu (pas d'avantage compétitif, pas d'info cachée en partie) | ✅ a priori : coaching après la partie ; la Live Client API sert à détecter la partie | le dire explicitement dans le dossier |
| Consentement et vie privée (scouting d'adversaires, données de santé) | ⚠️ consentement bien-être en cours ; le scouting n'utilise que des données publiques de Riot | décrire dans le dossier ce qui est stocké et pourquoi |
| Chiffres d'usage | ✗ | P1-10 |

## 5. Top des gains

| Rang | Gain | Phase | Pourquoi |
|---|---|---|---|
| 1 | **Demande de clé de production** (avec site public et textes v0.3) | 2, à **lancer maintenant** | Conformité : la clé Personal n'est pas autorisée pour un produit public, donc risque de révocation, qui couperait toute l'app. Et × 250 de débit. |
| 2 | **Cache partagé des parties dans le proxy** (P1-1) | 1 | Le gain le plus fort sans la clé ; reste utile après. |
| 3 | **Scrims par codes de tournoi** (2-2) | 2 | Supprime le CSV, la plus grosse corvée manuelle, et donne aux scrims toute l'analyse. |
| 4 | **Limiteur global + file à priorités** (P1-2, P1-3) | 1 | Protège la clé (liste noire) ; la fin de partie passe toujours en premier. |
| 5 | **Scouts incrémentaux et en fond** (P1-4, P1-5) | 1 | Un rescout passe d'environ 300 appels à une poignée ; plus d'attente bloquante. |
| 6 | **Preuve du compte** : icône (P1-8), puis RSO (2-3) | 1 puis 2 | Ferme l'usurpation de compte dans les groupes. |
| 7 | **Import CSV assisté** (P1-7) | 1 | Moins pénible en attendant les codes de tournoi. |

## Décisions pour l'utilisateur

1. Lancer la **demande de clé de production** maintenant, ce qui implique de
   rendre le site public et de publier les textes v0.3.
2. Autoriser le **déploiement du proxy** pour P1-1, P1-2 et P1-10.
