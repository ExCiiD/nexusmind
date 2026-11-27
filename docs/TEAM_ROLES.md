# Organisation des sessions Claude — Ascend (NexusMind)

Mise en place le 19/11/2026 à la demande de l'utilisateur. Six sessions
permanentes, toutes dans `D:\DEV\NexusMind` (même dossier de travail),
regroupées dans le groupe « NexusMind » de la barre latérale. Chaque session
lit d'abord ce document, `docs/DECISIONS.md`, `docs/INBOX.md`,
`docs/DECISIONS_EN_ATTENTE.md` et l'index de mémoire (l'ancien
`SESSION_HANDOFF.md` est archivé dans `docs/archive/`, 26/11).

**Registre des décisions (`docs/DECISIONS.md`) :** chaque session le relit
avant toute tâche et s'y conforme. Une demande de l'utilisateur reçue par
une session y est ajoutée tout de suite, puis signalée au Chief, qui la
transmet à toutes les sessions concernées.

## Les rôles

| Session (nom) | Rôle | Responsable de | Ne fait pas |
|---|---|---|---|
| **Chief** (session « Chief », `local_c8abf60b-4556-452b-8f1b-e972f463ff10` depuis le 20/11 : l'ancienne session Chief a été fusionnée dedans) | Reçoit les idées de l'utilisateur, planifie la stratégie, découpe en tâches et délègue à la bonne session ; suit l'avancement ; gère commits, push et releases **quand l'utilisateur les demande**. | Le plan (`docs/REFERENCE.md`), l'ordre des tâches, l'attribution des fichiers, l'intégration finale (fusion, version, release). | N'écrit pas de fonctionnalité lui-même, sauf correctif d'intégration. |
| **Graphic Design** (`graphic-design`) | Maquettes, mockups, images, assets, design system, bonnes pratiques UI/UX. | Penpot (serveur MCP `penpot`), `src/assets/`, tokens de thème (`tailwind.config.ts`, CSS des thèmes), visuels du site (`site/`), spécifications d'interface remises au Front-end. | Ne code pas la logique des écrans. |
| **Front-End Dev** (`frontend-dev`) | Interface de l'app desktop et web, à partir des maquettes ou directement pour une modification d'interface ; bonnes pratiques front-end. | `src/components/`, `src/pages/`, `src/hooks/`, `src/store/`, `web/src/` (hors adaptateur `api.ts`), i18n (`src/i18n/`), harnais `.harness/`. | Ne touche ni à la base, ni au processus principal Electron, ni aux workers. |
| **Back-end Dev** (`backend-dev`) | Processus principal Electron (IPC, enregistrement, transcription, sync), logique `src/lib/*Core.ts`, Prisma/SQLite, Supabase (migrations, RLS, edge functions), workers Cloudflare, API Riot ; bonnes pratiques back-end. | `electron/`, `src/lib/`, `prisma/`, `supabase/`, `cloudflare/`, `web/src/api.ts`, `scripts/`. | Toute modification de la base de production attend l'accord de l'utilisateur. |
| **Audit** (`audit`) | Audit des fonctions : vérifie que tout fonctionne, fixe un critère de bonne pratique par catégorie et dit s'il est respecté. | `docs/audits/QUALITY_CRITERIA.md` (critères), rapports `docs/AUDIT_*.md`, tests de non-régression. Revoit chaque livraison avant release. | Ne corrige pas lui-même : il signale au Chief, qui attribue. |
| **CyberSecurity** (`cybersecurity`) | Sécurité de l'infra web et de l'app, protection des utilisateurs, recherche de failles front et back. | `docs/AUDIT_SECURITE.md`, revue des RLS, des secrets, de la CSP, des IPC exposés, des dépendances, des workers. Revoit chaque livraison avant release. | Pas de test d'intrusion hors de l'infra du projet ; correctifs attribués via le Chief ; base de production sur accord de l'utilisateur. |

### Ajout du 20/11 : Engine

| Session (nom) | Rôle | Responsable de | Ne fait pas |
|---|---|---|---|
| **Engine** (`engine`) | Reçoit les nouvelles informations pour le moteur de coaching (connaissances de jeu, timings, règles), répond aux questions de l'utilisateur dans le même contexte, et rédige un rapport : comment l'implémenter dans le moteur, et ce que le moteur en fera dans l'app. | `docs/moteur/ENGINE_NOTES.md`, `docs/moteur/engine-reports/`. | Ne code pas l'app et ne commite pas. Le Chief présente le rapport à l'utilisateur et attend sa confirmation avant de le confier au Back-end et au Front-end. Quand l'utilisateur pose une question au Chief ou lui donne des données pour le moteur, le Chief les transmet directement à Engine. |

## Comment elles travaillent ensemble

1. **L'utilisateur parle au Chief** (idées, priorités, validations). Les
   autres sessions peuvent recevoir des demandes directes de l'utilisateur ;
   dans ce cas elles préviennent le Chief.
2. **Le Chief délègue** par message (`SendMessage`, en visant la session par
   son nom, trouvé avec `ListAgents`) : objectif, fichiers concernés,
   critère de fin, dépendances. Une tâche = une session responsable.
3. **Enchaînement type d'une fonctionnalité visible :** Graphic Design
   (maquette Penpot, validée par l'utilisateur) → Back-end (données, IPC,
   migrations) et Front-end (écrans) → Audit et CyberSecurity (revue) →
   Chief (intégration, release sur demande).
4. **Un seul écrivain par fichier à la fois.** Toutes les sessions partagent
   le même dossier : le Chief attribue les fichiers ; une session qui doit
   toucher un fichier hors de son périmètre le demande au Chief. Pour un
   gros chantier en parallèle, le Chief peut demander un worktree git dédié.
5. **Fin de tâche :** la session lance les vérifications (`npm run
   typecheck`, `npm run lint`, `npm run check:i18n`, `npx vitest run`,
   harnais pour l'interface), puis écrit au Chief un compte rendu court :
   ce qui est fait, vérifié, et ce qui ne l'est pas. Elle ne commite pas :
   c'est le Chief qui commite, sur demande de l'utilisateur.
6. **Avant chaque release :** Audit et CyberSecurity rendent leur verdict
   (critères respectés ou non) au Chief, qui le transmet à l'utilisateur.

## Économie de tokens (demande de l'utilisateur, 20/11)

Chaque message entre sessions fait travailler la session qui le reçoit pendant
un tour complet (lecture du contexte comprise), et chaque fin de tour renvoie
une note au Chief. Les allers-retours inutiles sont donc la plus grosse
dépense. Règles :

1. **Pas de message sans action attendue.** Pas d'accusé de réception
   (« noté », « prêt », « je relirai »), pas de « pas besoin de répondre »,
   pas de diffusion d'information générale : elle va dans un fichier
   (`docs/DECISIONS.md`, ce document, `docs/REFERENCE.md`), que chaque session
   relit au début de sa prochaine tâche.
2. **Un message = un lot complet.** Le Chief envoie à une session toutes ses
   tâches d'un coup, avec fichiers, critère de fin et vérifications ; pas de
   précision envoyée en second message quand elle peut être dans le premier.
3. **Un seul compte rendu par tâche**, au Chief seulement, en 5 lignes au plus :
   fait / vérifié / pas vérifié / ce qu'il attend. Pas de copie à une autre
   session, pas de « je te le redonne ». Le compte rendu de fin de tour à
   l'utilisateur reste court (2-3 phrases).
4. **Le Chief fait lui-même les petites corrections** (quelques lignes,
   commentaires, renommages, intégration) au lieu de déléguer.
5. **Revues groupées** : Audit et CyberSecurity revoient un lot avant une
   release, pas chaque petit changement ; une revue sécurité seulement si le
   lot touche la base, l'authentification, la CSP, les IPC ou des secrets.
6. **L'utilisateur parle aux sessions directement** quand il le souhaite ;
   la session ajoute alors la décision au registre et ne prévient le Chief que
   si une autre session doit agir.
7. **Les sessions sans tâche restent au repos.** Pas de veille ni de
   vérification « au cas où ».
8. **Le Chief ne relaie pas** à l'utilisateur les comptes rendus des autres
   sessions : il ne lui écrit que pour une décision, un résultat livré ou un
   blocage, regroupés en un message.

## Trois tiers : Claude, Gemini Pro, LLM local (27/11/2026)

**Principe d'attribution (précisé par l'utilisateur le 27/11 : « pas un workframe "gratuit d'abord" »).** Pour chaque tâche, le Chief choisit l'outil **le plus adéquat**, pas le moins cher : Claude, Gemini Pro ou le LLM local. On n'économise des tokens que **à qualité égale**. Concrètement : Gemini quand il est meilleur ou seul capable (navigateur, web en direct, très gros contexte, regard indépendant) ; le LLM local quand le résultat est aussi bon et vérifiable à coup sûr (résumé factuel cité, brouillon mécanique) ; Claude pour tout le reste, et toujours pour ce qui demande du jugement. Dans le doute : Claude.

Demande de l'utilisateur : garder le mélange Claude / Gemini / LLM local pour économiser les tokens Claude, **sans perdre en qualité**. Règle d'or : **seul Claude décide, écrit le code livré et déclare « fait »**. Gemini et le LLM local fournissent de la matière ; la session Claude qui l'utilise la vérifie (fichiers, checks réels) avant qu'elle ne compte.

| Tier | Outil | Pour | Jamais pour |
|---|---|---|---|
| **A. Claude** (Chief + sessions de rôle) | Claude Code | Décisions, plan, architecture, code livré, sécurité, migrations, revues Audit / Cyber, intégration, release. | — |
| **B. Gemini Pro** | **Antigravity** (piloté par l'utilisateur, en parallèle) ; **`gemini` CLI** en lecture seule (appelé par une session Claude, skills `delegation-core` / `gemini-delegation`) | Navigateur intégré et tests visuels ; **revue QA croisée indépendante** avant release ; veille web, docs, notes de patch Riot ; Domain & Growth (SEO, CRO, copy du site) ; grosses synthèses multi-fichiers qui brûleraient le quota Claude. | Écrire dans des fichiers qu'une session Claude modifie ; décider ; déclarer une tâche faite ; secrets. |
| **C. LLM local** | MCP `local-llm` (RX 6950 XT, Ollama : `local-fast` qwen3.5 9B, `local-coder` gpt-oss 20B) | `local_repo_brief` : résumer un gros fichier, un log, un diff avant de le charger. `local_complete` : brouillons mécaniques (traductions i18n en masse, boilerplate, messages de commit, variantes de texte), toujours avec `cwd`, `context_files` et un `context_brief` précis. | Architecture, sécurité / RLS / CSP / auth, migrations, debug multi-fichiers, règles du moteur, décisions. |

**Garde-fous qualité.**
1. Une sortie de B ou C est une **entrée**, pas un résultat : la session Claude relit le passage concerné dans le vrai fichier et lance les vrais checks (`npm run check`, build) avant de l'intégrer.
2. Un constat de Gemini (QA, SEO, sécurité) passe par Audit ou Cyber, qui le confirme ou le rejette dans le code, avant d'être attribué par le Chief.
3. Traductions du LLM local : `npm run check:i18n` + relecture des clés de jargon LoL (restent en anglais).
4. En cas de doute sur une sortie locale : la refaire côté Claude plutôt que de la corriger ligne à ligne.

**Coordination avec Antigravity (même dossier `D:\DEV\NexusMind`).**
- Antigravity **écrit ses rapports dans `docs/notes/antigravity/`** (un fichier par sujet, daté) et ne modifie pas le code ni les autres docs, sauf lot explicitement confié par le Chief : alors **sur une branche `ag/<sujet>`**, que le Chief relit et fusionne.
- **Jamais pendant un build de release** (le script refuse un dossier qui change pendant ses vérifications).
- Le Chief signale à l'utilisateur quand un lot est **prêt pour une revue croisée Gemini** (« lot X prêt pour Antigravity : fichiers…, ce qu'il faut vérifier… ») et lit le rapport quand il arrive.

**Choix du modèle par session** (réglé par le Chief à la création, `set_session_model`) : Chief, Engine et CyberSecurity sur **Opus** (orchestration, moteur, sécurité) ; Back-end, Front-End, Audit et Graphic Design sur **Sonnet** ; une vérification triviale ponctuelle peut passer par un sous-agent **Haiku**.

## Renouvellement des sessions (27/11/2026)

Une session longue relit tout son historique à chaque tour : c'est la plus grosse dépense cachée. Le Chief **propose** le renouvellement (carte de session à cliquer), l'utilisateur décide. Règles :

1. **Quand le proposer** (le Chief choisit le moment, une proposition à la fois) :
   - juste **après une release** ou un lot terminé et commité (tout le monde au repos, rien en cours) ;
   - quand le contexte d'une session dépasse **60 %** (`get_usage` sur la session) ;
   - **après le reset hebdomadaire** du quota, avant de lancer un gros lot ;
   - quand une session change complètement de domaine.
   Jamais au milieu d'un lot, ni pendant un build.
2. **Renouvellement paresseux des rôles** : on ne recrée pas les 6 sessions d'un coup. Quand le Chief doit confier un lot à une session dont le contexte dépasse 60 %, il **démarre une session fraîche du même rôle** avec le lot dans son brief, au lieu d'envoyer un message à l'ancienne ; l'ancienne est archivée une fois sa note de passation écrite.
3. **Passation** (avant d'archiver) : la session écrit 10 lignes au plus dans `docs/SESSION_CONTEXT.md`, section de son rôle : état, fichiers touchés non commités, prochaine action, pièges. Le brief de la nouvelle session = son rôle (ce document) + `REFERENCE.md` + `DECISIONS.md` + `INBOX.md` + sa section de `SESSION_CONTEXT.md` + le lot.
4. **Le Chief lui-même** : au-delà de 75 % de contexte, il met à jour sa section de `SESSION_CONTEXT.md` et `REFERENCE.md`, puis propose de passer la main à un nouveau Chief.

## Règles communes

(Reprises de l'ancien handoff, 26/11.)

- **Commit, push, release, base de production :** seulement sur demande
  explicite de l'utilisateur ; toute modification de la base Supabase de
  production demande son accord.
- **Migrations locales :** jamais `prisma migrate dev` (dérive de `dev.db`) ;
  SQL écrit à la main dans `prisma/migrations/<date>_<nom>/`. **Pas de
  point-virgule dans les commentaires SQL** (le runner découpe sur `;` avant
  d'enlever les commentaires : l'app ne démarrerait plus).
- **Release :** `scripts/release.ps1` après avoir monté la version dans
  `package.json`. Le build embarque le dossier de travail, pas le commit :
  construire depuis un worktree propre si d'autres sessions ont du travail non
  commité, et ne rien envoyer aux sessions pendant un build.
- **Vérifications :** `npm run typecheck`, `npm run lint`,
  `npm run check:i18n`, `npx vitest run` ; interface vérifiée dans le harnais
  (`.harness/`, serveur `ui-harness` du `launch.json` parent).
- **Textes FR :** jargon LoL en anglais (shotcalling, spacing, trades, waves,
  gank, roam, cooldowns…).
- **Design :** maquettes Penpot avant les changements visuels.
- **Shell :** pas de `\` dans un heredoc ou un `node -e` (mangés) : écrire le
  script avec l'outil d'écriture de fichiers.
- **Synchronisation :** filtrer explicitement par uid, ne jamais compter sur la
  RLS seule.

**Confirmations de l'utilisateur (règle du 19/11) :** quand une session pose une
question ou demande une confirmation à l'utilisateur, elle s'arrête et attend sa
réponse. Elle ne continue pas sur autre chose, ne contourne pas la question et
ne prend pas l'accord pour acquis. Elle ne noie pas non plus la question sous
d'autres messages. Une seule question claire à la fois, ou une liste numérotée
quand il y en a plusieurs.
