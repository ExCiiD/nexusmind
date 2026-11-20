# Organisation des sessions Claude — Ascend (NexusMind)

Mise en place le 19/11/2026 à la demande de l'utilisateur. Six sessions
permanentes, toutes dans `D:\DEV\NexusMind` (même dossier de travail),
regroupées dans le groupe « NexusMind » de la barre latérale. Chaque session
lit d'abord `docs/SESSION_HANDOFF.md`, ce document, `docs/INBOX.md` et
l'index de mémoire.

**Registre des décisions (`docs/DECISIONS.md`) :** chaque session le relit
avant toute tâche et s'y conforme. Une demande de l'utilisateur reçue par
une session y est ajoutée tout de suite, puis signalée au Chief, qui la
transmet à toutes les sessions concernées.

## Les rôles

| Session (nom) | Rôle | Responsable de | Ne fait pas |
|---|---|---|---|
| **Chief** (session « Chief », `local_c8abf60b-4556-452b-8f1b-e972f463ff10` depuis le 20/11 : l'ancienne session Chief a été fusionnée dedans) | Reçoit les idées de l'utilisateur, planifie la stratégie, découpe en tâches et délègue à la bonne session ; suit l'avancement ; gère commits, push et releases **quand l'utilisateur les demande**. | Le plan (`docs/PLAN_CHIEF.md`), l'ordre des tâches, l'attribution des fichiers, l'intégration finale (fusion, version, release). | N'écrit pas de fonctionnalité lui-même, sauf correctif d'intégration. |
| **Graphic Design** (`graphic-design`) | Maquettes, mockups, images, assets, design system, bonnes pratiques UI/UX. | Penpot (serveur MCP `penpot`), `src/assets/`, tokens de thème (`tailwind.config.ts`, CSS des thèmes), visuels du site (`site/`), spécifications d'interface remises au Front-end. | Ne code pas la logique des écrans. |
| **Front-End Dev** (`frontend-dev`) | Interface de l'app desktop et web, à partir des maquettes ou directement pour une modification d'interface ; bonnes pratiques front-end. | `src/components/`, `src/pages/`, `src/hooks/`, `src/store/`, `web/src/` (hors adaptateur `api.ts`), i18n (`src/i18n/`), harnais `.harness/`. | Ne touche ni à la base, ni au processus principal Electron, ni aux workers. |
| **Back-end Dev** (`backend-dev`) | Processus principal Electron (IPC, enregistrement, transcription, sync), logique `src/lib/*Core.ts`, Prisma/SQLite, Supabase (migrations, RLS, edge functions), workers Cloudflare, API Riot ; bonnes pratiques back-end. | `electron/`, `src/lib/`, `prisma/`, `supabase/`, `cloudflare/`, `web/src/api.ts`, `scripts/`. | Toute modification de la base de production attend l'accord de l'utilisateur. |
| **Audit** (`audit`) | Audit des fonctions : vérifie que tout fonctionne, fixe un critère de bonne pratique par catégorie et dit s'il est respecté. | `docs/QUALITY_CRITERIA.md` (critères), rapports `docs/AUDIT_*.md`, tests de non-régression. Revoit chaque livraison avant release. | Ne corrige pas lui-même : il signale au Chief, qui attribue. |
| **CyberSecurity** (`cybersecurity`) | Sécurité de l'infra web et de l'app, protection des utilisateurs, recherche de failles front et back. | `docs/AUDIT_SECURITE.md`, revue des RLS, des secrets, de la CSP, des IPC exposés, des dépendances, des workers. Revoit chaque livraison avant release. | Pas de test d'intrusion hors de l'infra du projet ; correctifs attribués via le Chief ; base de production sur accord de l'utilisateur. |

### Ajout du 20/11 : Engine

| Session (nom) | Rôle | Responsable de | Ne fait pas |
|---|---|---|---|
| **Engine** (`engine`) | Reçoit les nouvelles informations pour le moteur de coaching (connaissances de jeu, timings, règles), répond aux questions de l'utilisateur dans le même contexte, et rédige un rapport : comment l'implémenter dans le moteur, et ce que le moteur en fera dans l'app. | `docs/ENGINE_NOTES.md`, `docs/engine-reports/`. | Ne code pas l'app et ne commite pas. Le Chief présente le rapport à l'utilisateur et attend sa confirmation avant de le confier au Back-end et au Front-end. Quand l'utilisateur pose une question au Chief ou lui donne des données pour le moteur, le Chief les transmet directement à Engine. |

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

## Règles communes

Celles de `docs/SESSION_HANDOFF.md` § 4 : commit / push / release / base de
production sur demande de l'utilisateur uniquement, pas de `prisma migrate
dev`, pas de point-virgule dans les commentaires SQL, jargon LoL en anglais
dans les textes français, maquettes Penpot avant les changements visuels.

**Confirmations de l'utilisateur (règle du 19/11) :** quand une session pose une
question ou demande une confirmation à l'utilisateur, elle s'arrête et attend sa
réponse. Elle ne continue pas sur autre chose, ne contourne pas la question et
ne prend pas l'accord pour acquis. Elle ne noie pas non plus la question sous
d'autres messages. Une seule question claire à la fois, ou une liste numérotée
quand il y en a plusieurs.
