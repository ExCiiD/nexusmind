# Demande de clé de production Riot — dossier préparatoire

> Rédigé par la session **Audit** le 19/11/2026, en lecture seule, pour que l'utilisateur dépose lui-même la demande
> sur <https://developer.riotgames.com>. **Rien n'a été envoyé à Riot.**
> Complète `docs/PLAN_CLE_PROD.md` (pourquoi et quoi activer) et `docs/RAPPORT_SUPABASE_WEB.md` (volumes).
>
> Sources officielles relues le 19/11/2026 :
> - <https://developer.riotgames.com/docs/portal> (types de clés, prérequis) ;
> - <https://developer.riotgames.com/application-process.html> (processus de demande) ;
> - <https://developer.riotgames.com/policies/general> (règles générales) ;
> - <https://developer.riotgames.com/docs/lol> (règles propres à LoL : customs, tournois, Live Client).

## 1. Ce que Riot demande

Riot **ne publie pas la liste exacte des champs du formulaire** : la page du processus dit seulement qu'il « recueille
quelques informations clés sur votre produit ». La liste ci-dessous réunit les **exigences écrites** de Riot et les
**champs habituels du formulaire** (marqués « à confirmer »). Ces derniers sont à vérifier en ouvrant le vrai
formulaire (bouton *Register Product* du tableau de bord).

| # | Élément | Exigence de Riot | Source |
|---|---|---|---|
| R1 | **Produit enregistré** sur le portail, de type produit public (pas *personal*), un enregistrement par projet | « Register Product », « each project… individually approved » | Portal, Application process |
| R2 | **Formulaire** : nom, description détaillée, cas d'usage, URL, jeu (LoL), APIs utilisées, besoin en débit (à confirmer) | « gathers some key details about your product » | Application process |
| R3 | **Prototype fonctionnel** | « Typically requires a working prototype » | Portal |
| R4 | **Site complet et public** | « If your website isn't complete, we're unlikely to approve your product » | Application process |
| R5 | **Vérification du produit** (prouver qu'on en est le développeur ; méthode non décrite) | « verify your product » | Application process |
| R6 | **Utilité mesurable pour les joueurs**, sans « résoudre le jeu » | « helps players in a measurable way », « solve our games » interdit | Application process |
| R7 | **Mention légale Riot** visible par les joueurs | texte imposé (voir § 4), « readily visible to players » | General policies |
| R8 | **Clé sécurisée** : jamais dans le code ni dans un binaire distribué, HTTPS | « Don't include your API key in your code… distributed binaries » | General policies |
| R9 | **Intégrité du jeu** : pas d'avantage déloyal, pas de calculateur de MMR/ELO, pas de désanonymisation, rien de « inconnu du joueur » pendant une partie | General policies, docs LoL |
| R10 | **Monétisation** (si prévue) : palier gratuit obligatoire, pas de jeu d'argent, statut « Approved » ou « Acknowledged » avant de monétiser | General policies |
| R11 | **Une clé = un produit**, partage au sein d'un « group » du portail | General policies |
| R12 | **Textes légaux** (CGU, politique de confidentialité) : pas exigés en toutes lettres par la page Portal, mais la revue porte sur la « conformité légale ». Indispensables en pratique, surtout avec des données personnelles | Application process (« legal ») |
| R13 | **Mode d'authentification** : rien d'imposé. RSO (Riot Sign On) est réservé aux produits approuvés ; l'historique custom d'un joueur n'est accessible que par RSO | docs LoL |
| R14 | **Captures d'écran** : non citées par Riot. Utiles pour prouver le prototype et le « complete website » | — |
| R15 | **API Tournaments** (codes de tournoi pour les scrims) : production seulement ; à demander explicitement dans le dossier | Portal |

## 2. Prêt / à faire

| # | État | Constat | Action | Qui |
|---|---|---|---|---|
| R1 | ⏳ | Une fiche existe forcément (la clé Personal en dépend), mais son type et son contenu ne sont pas lisibles depuis le dépôt | relire la fiche du portail ; créer ou convertir en produit public | **utilisateur** |
| R2 | ✅ textes prêts | brouillons en anglais au § 4 | copier, puis ajuster au vrai formulaire | utilisateur |
| R3 | ✅ | app desktop en bêta publique (1.0.0-beta.8), web app, CI verte, 1 656 tests | — | — |
| R4 | ❌ **bloquant** | le site est en ligne mais en **aperçu non indexé** : pas d'URL publique configurée (`site/build.mjs:46-47`, `preview = !siteUrl`), `X-Robots-Tag: noindex` (`site/public/_headers:8`), adresse en `workers.dev` | choisir le domaine, définir `SITE_URL`, retirer le `noindex`, redéployer | utilisateur (domaine) puis graphic-design / backend-dev |
| R5 | ⏳ | méthode inconnue avant le dépôt (souvent un fichier ou une balise sur le site) | suivre l'instruction du portail le moment venu ; prévoir 1 déploiement du site | utilisateur + graphic-design |
| R6 | ✅ | coaching après la partie, micro-review, plan de progression, gestion d'équipe ; rien n'est automatisé en partie | argumenter (§ 4.3) | — |
| R7 | ✅ | **Site** : pied de page de toutes les pages, CGU et politique. **App** (19/11, `src/components/legal/RiotLegalNotice.tsx`) : écran de connexion desktop et web (`CloudGate.tsx:366`), onboarding (`OnboardingPage.tsx:124`), Aide desktop (`HelpPage.tsx:192`), page Compte web (`web/src/pages/AccountPage.tsx:68`). Texte **identique au caractère près** à celui du site (271 caractères, comparaison par script) et conforme au texte officiel de Riot ; balisé `lang="en"`. Vu dans le harnais : affiché sur l'écran de connexion et dans l'Aide (680 × 36 px), contraste 5,63:1. Onboarding et page Compte web vérifiés dans le code seulement. | — | — |
| R8 | ✅ | clé seulement en secret Cloudflare (`RIOT_API_KEY`), proxy authentifié par le JWT Supabase, liste blanche de 9 endpoints GET, HTTPS ; jamais dans le binaire (mode direct réservé au dev, `.env` jamais embarqué) | décrire au § 4.6 | — |
| R9 | ✅ | la Live Client Data API sert seulement à détecter début et fin de partie ; aucun affichage pendant la partie ; pas de MMR (le « niveau » d'Ascend mesure le travail fait dans l'app, `src/lib/profile.ts`) ; le scouting n'utilise que des données publiques par Riot ID | le dire explicitement au § 4.5 | — |
| R10 | ⏳ **décision** | « Free during the beta » sur le site ; modèle futur non décidé | décider : gratuit, ou gratuit + abonnement plus tard (palier gratuit obligatoire) | **utilisateur** |
| R11 | ✅ | un seul produit, Ascend (desktop + web = un produit) | — | — |
| R12 | ✅ | **v0.3** dans l'app (`src/legal/privacy.*.md:3`, `terms.*.md:3`) et sur le site (`site/src/legal/*.html`), 19/11/2026 ; suppression de compte (edge function `delete-account`), consentement bien-être | vérifier que la v0.3 est bien celle validée par l'utilisateur (le brouillon `LEGAL_V0.3_DRAFT.md` dit encore « pas en vigueur ») | utilisateur + cybersecurity |
| R13 | ⚠️ | connexion Ascend par e-mail (code ou mot de passe, Supabase). Compte Riot lié par **saisie du Riot ID, sans preuve de propriété** | annoncer RSO comme prévu après approbation ; en attendant, preuve par icône (P1-8 de `PLAN_CLE_PROD.md`) | backend-dev + frontend-dev |
| R14 | ⏳ | captures automatiques du site (`site/shots.cjs`, à remettre d'aplomb : WSC-12) | 5 ou 6 captures : micro-review, Mistake Lab, plan, Stats collectives, Planning, Scouting | graphic-design |
| R15 | ✅ textes prêts | cas d'usage clair (scrims entre équipes, aujourd'hui importés en CSV) | inclure le § 4.4 | — |

**Bloquants avant dépôt :** R4 (site public), R10 (décision de monétisation). R7 est réglé depuis le 19/11.
**Fortement conseillés :** R13 (preuve du compte Riot), R14 (captures), R12 (confirmer la v0.3).

## 3. Volumétrie estimée

Hypothèses (voir `PLAN_CLE_PROD.md` § 1 et `RAPPORT_SUPABASE_WEB.md` § 3) :
- un joueur actif joue environ 5 parties par jour, à 3-5 appels par partie (ids, match, timeline) ;
- ouverture de l'historique : environ 50 appels, une seule fois grâce au cache local ;
- un staff lance 1 à 2 scouts complets d'équipe par semaine, soit environ 1 500 appels chacun avant cache ;
- pic du soir à environ 5 fois la moyenne.

| Utilisateurs actifs | Appels/jour (moyenne) | Moyenne req/s | Pic req/s estimé | Limite production (par région) |
|---|---|---|---|---|
| 50 | ≈ 6 000-10 000 | ≈ 0,1 | ≈ 0,6 | 50 req/s (500/10 s) |
| 300 | ≈ 40 000-60 000 | ≈ 0,6 | ≈ 3 | idem |
| 1 000 | ≈ 150 000-250 000 | ≈ 2-3 | ≈ 15 | idem, et 30 000 / 10 min ≈ 50/s |

Le cache partagé du proxy (P1-1), une fois fait, réduira encore les appels de match et timeline, qui sont les plus
nombreux. **La limite de production par défaut suffit jusqu'à environ 1 000 utilisateurs actifs.** Aucune hausse n'est
à demander au dépôt.

Régions : surtout **EUW1 / EUN1** (routage `europe`), puis les autres plateformes par l'utilisateur (16 plateformes
autorisées par le proxy).

## 4. Brouillons des textes du dossier (en anglais)

> À coller dans le formulaire et à adapter à ses champs réels. Les passages entre `[crochets]` sont à compléter par
> l'utilisateur.

### 4.1 Product name / short description

**Ascend** — League of Legends coaching and team management for players, captains and coaches.

> Ascend helps League of Legends players improve after every game: it finds the moments that cost them the most,
> turns them into a short guided review, and tracks progress over time. Teams use it to plan practice, review VODs
> together and prepare scrims.

### 4.2 Detailed description

> Ascend is a free [during the beta] desktop app for Windows, with a companion web app, built for players who want to
> improve and for amateur and semi-pro teams.
>
> For players: after each game, Ascend downloads the match and its timeline, detects the key moments (deaths before
> objectives, lost lane leads, missed recalls…), and offers a 45-second guided micro-review. It keeps a mistake
> library, a fundamentals profile and a weekly plan with measurable goals, and can record the game locally for VOD
> review. Everything happens after the game: Ascend shows nothing while a game is in progress.
>
> For teams: a shared space where captains and coaches plan practice (availability, scrims, meetings), review VODs
> with timestamped comments, track team statistics on Flex and scrim games, keep a champion pool per player, run
> draft simulations, and scout opposing teams from public match history.
>
> Ascend is used today by [N] players in [N] groups (public beta since [date]). The website is [URL] and the
> download page is [URL].

### 4.3 Use case and player benefit

> Ascend turns match data into specific, measurable improvement work. Players see their most costly habits game
> after game, review them in under a minute, and follow a plan whose goals are checked against their next games
> (for example "die less than twice before 14:00"). Coaches save the hours they spend scrubbing VODs and spreadsheets.
>
> Ascend does not automate decisions or play the game for anyone. It shows nothing in-game, does not estimate hidden
> MMR, and only uses information that is public through the Riot API or visible in the player's own client. It helps
> players understand their own decisions; it does not make those decisions for them.

### 4.4 Tournaments API (scrims)

> Teams play many custom-lobby scrims. Today they must export each replay to a CSV by hand to get any statistics.
> With tournament codes, a captain would create one code per scrim game from Ascend's planner. When the game ends,
> Ascend receives the callback and retrieves the match through Match-v5 by tournament code. Players get the same
> post-game analysis as in ranked. We will generate codes only on demand (one per game), respect the Tournaments rate
> limits, and fall back to the callback-less lookup only if no callback arrives.

### 4.5 APIs and endpoints used

| API | Endpoint | Why |
|---|---|---|
| Account-v1 | `/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`, `/by-puuid/{puuid}` | link a player's Riot account; resolve scouted players |
| Summoner-v4 | `/lol/summoner/v4/summoners/by-puuid/{puuid}` | profile icon and level (and, before RSO, an icon-based ownership check) |
| League-v4 | `/lol/league/v4/entries/by-puuid/{puuid}` (or by-summoner) | current rank shown on profiles and team rosters |
| Champion-Mastery-v4 | `/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top` | seed a player's champion pool |
| Match-v5 | `/lol/match/v5/matches/by-puuid/{puuid}/ids`, `/matches/{matchId}`, `/matches/{matchId}/timeline` | post-game analysis, history, team and scouting statistics |
| Tournament-v5 *(requested)* | providers, tournaments, codes; games by code | scrim tracking (§ 4.4) |
| RSO *(requested, after approval)* | Riot Sign On | prove account ownership; let players see their own custom-game history with consent |

Not used: Spectator-v5. Live Client Data API (local, port 2999) is only used to detect the start and end of the
player's own game.

### 4.6 API key security and architecture

> The API key is never shipped to players. It is stored as a secret of a Cloudflare Worker that acts as our only
> gateway to the Riot API. Every request to the Worker must carry a valid Ascend account token (Supabase JWT, checked
> by signature). The Worker only forwards an allow-list of read-only GET endpoints to the official regional hosts over
> HTTPS, applies a per-user rate limit, and never reveals upstream authentication errors. The desktop and web apps
> also respect `Retry-After` and the `X-App-Rate-Limit` headers. Match and timeline bodies are cached locally on each
> device [and shared in the Worker cache], so each match is fetched as few times as possible.

### 4.7 Expected usage

> Current users: [N] monthly active players (public beta). Expected within 12 months: 300–1,000 monthly active
> players, mostly on EUW/EUNE. Estimated load at 1,000 active players: about 150,000–250,000 requests per day, about
> 15 requests per second at the evening peak. The standard production limits are sufficient; we are not requesting an
> increase.

### 4.8 Data handling and privacy

> Accounts are created with an e-mail address. Riot data stored: Riot ID, PUUID, region, and match data for the
> player's own games and for opponents a team chose to scout (public match data only). Finished match and timeline
> bodies are also kept in a private cache on our API gateway, so each game is fetched from Riot only once; this cache
> is deleted automatically after 90 days. Personal data is stored in the
> EU (Supabase, Frankfurt/Zurich region), and players can export or delete their account and data from the app at any
> time. Optional wellbeing check-ins are stored only after explicit consent and are never shared without the player
> turning sharing on. Privacy policy: [URL]. Terms of service: [URL].

### 4.9 Monetization

> [Choose one:]
> - Ascend is free. There is no paid tier and no advertising.
> - Ascend is free during the beta. Any future paid plan will keep a free tier with the core features, will follow
>   Riot's monetization policies, and will only start after approval.

### 4.10 Required notice (to show in the app and on the site)

> Ascend isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially
> involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or
> registered trademarks of Riot Games, Inc.

## 5. Ordre conseillé

1. **Utilisateur :** décider de la monétisation (R10) et du domaine du site (R4).
2. **graphic-design / backend-dev :** site public (`SITE_URL`, retrait du `noindex`), captures (R14).
3. ~~**frontend-dev :** mention Riot visible dans l'app (R7)~~ : fait le 19/11.
4. **backend-dev + frontend-dev :** preuve du compte par icône (R13), conseillée.
5. **cybersecurity :** relire les §§ 4.6 et 4.8 contre l'état réel.
6. **Utilisateur :** créer ou convertir la fiche produit, coller les textes du § 4, déposer, puis suivre la vérification
   (R5) et les messages du portail.
