# Session Chief (Claude Code) — 19/11 → 27/11/2026, archivée le 27/11

Session `local_c8abf60b-4556-452b-8f1b-e972f463ff10`, remplacée par un Chief neuf (renouvellement demandé par l'utilisateur pour libérer du contexte). Transcriptions complètes (zip) : `D:\DEV\NexusMind\archives-sessions\2026-11-27\` (chief, backend-dev, frontend-dev, audit, cybersecurity, graphic-design). Toutes les décisions de l'utilisateur sont dans `docs/DECISIONS.md` (lignes datées du 19 au 27/11) ; l'état du projet dans `docs/REFERENCE.md` ; la passation dans `docs/SESSION_CONTEXT.md` (« Chief — passation du 27/11/2026 »).

## Ce que cette session a livré

- **beta.16 → beta.23** (publiées par cette session) : hotfix ws Realtime ; picker d'import et parties hors session ; cache de pages et listes Riot (vitesse) ; lot perf AUDIT_PERF_2 (mémo stats, timelines gzip, résumés, sauvegardes allégées) ; cartes de micro-review justes (règle soloQ, lieux en mots, fenêtres vidéo) ; sessions sans fondamental ; review courte ; Review v2 (lecteur unique, filtres, panneau déplaçable, bloc-notes, Prise de note, Erreurs détectées + Modifier / Pourquoi, couche 1 d'apprentissage du moteur) ; mode clip (poignées, sans limite de durée) ; upload YouTube automatique (client Desktop + PKCE, file, son, avertissements) ; lecteurs Record / Review fusionnés ; plein écran ; corrections Planning 24:00, XP, stats collectives, carte du Lobby.
- **Site** asc3nd.app : textes à jour, captures de l'utilisateur, bouton de téléchargement suivant la version, `riot.txt` et fichier Google.
- **Dossiers** : description Riot (`docs/prod/RIOT_PRODUCT_DESCRIPTION.md`, lien PUUID + quota), vérification Google YouTube.
- **Workframe à trois tiers** (27/11) : `docs/TEAM_ROLES.md` « Trois tiers » (outil le plus adéquat par tâche, pas le moins cher) et « Renouvellement des sessions » ; `docs/notes/antigravity/README.md` ; copie générique `D:\DEV\NexusMind\WORKFRAME_CHIEF.md`.

## Non commité au moment de l'archivage

Docs du workframe (`TEAM_ROLES.md`, `DECISIONS.md`, `SESSION_CONTEXT.md`, `INBOX.md`, `docs/notes/antigravity/`), archives de sessions d'Antigravity, et le **correctif des fenêtres de console** (`electron/main/recorder.ts` + `tests/unit/noVisibleConsoleSpawn.test.ts`, release beta.25 « plus tard », voir `INBOX.md`).

## Leçons

- Ne rien envoyer aux sessions pendant un build de release ; sinon build depuis une copie propre (worktree avec jonctions `node_modules`, `prisma-client`, `resources/ffmpeg-bin`, à retirer avant suppression).
- Deux sessions qui s'adaptent l'une à l'autre en même temps → un seul arbitre (le Chief) et un contrat écrit.
- Tout lancement de processus enfant sous Windows : `windowsHide: true` (test garde-fou).
