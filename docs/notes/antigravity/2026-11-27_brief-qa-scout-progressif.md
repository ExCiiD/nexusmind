# Brief QA croisée — lot « scout progressif » (27/11/2026)

Demandé par le Chief. Lis d'abord `docs/notes/antigravity/README.md`. **Ne lis pas** `docs/audits/AUDIT_SCOUT_PROGRESSIF_2026-11-27.md` avant d'avoir fini : on veut un regard indépendant.

## Le lot (non commité, dans le dossier de travail)

Objectif (décision du 24/11) : un scout d'équipe plus **rapide**, sans réduire les données (la saison complète reste la profondeur par défaut).

- Moteur partagé desktop + web : `src/lib/scoutEngine.ts` ; contrat `docs/contracts/scouting-progressive.md`.
- Desktop : `electron/main/ipc/team.ipc.ts` (IPC `team:scout-team`, `team:scout-progress`, `team:scout-cancel`, `team:scout-member`), `electron/main/riotClient.ts` (rythme des requêtes vers le proxy, pauses background / global), `src/lib/riotLimits.ts`, `electron/preload/index.ts`, `src/lib/ipc.ts`.
- Web : `web/src/riotWeb.ts`, `web/src/scoutingWeb.ts`, `web/src/api.ts`.
- Interface : `src/pages/Team/ScoutingTab.tsx`, `src/components/team/ScoutProgressBanner.tsx`, `src/store/scoutLive.ts`, `src/store/useBackgroundJobsStore.ts`, `src/components/BackgroundJobsIndicator.tsx`, `src/i18n/locales/{fr,en}.json`.
- Tests : `tests/unit/scoutEngine.test.ts`, `riotProxyPacing.test.ts`, `riotWebPacing.test.ts`, `scoutLive.test.ts`, `scoutResumeStore.test.ts`.
- `git status` / `git diff` donnent la liste exacte.

## Ce qu'il faut vérifier

1. **Aucune donnée perdue** par rapport à l'ancien chemin (`git diff` de `team.ipc.ts`) : pools, stats, parties communes, profondeur.
2. **Annulation** : rien ne continue après Annuler, même pendant la première phase ; pas de fuite d'écouteurs.
3. **Appels urgents jamais retenus** par une pause du scout (enregistrement, post-game, micro-review, écran ouvert), en mode proxy comme en clé directe.
4. **Erreurs** : session expirée, panne du proxy, liste de parties en échec, parties illisibles. L'écran ne doit jamais dire « terminé » ni « aucune partie » à tort, et un pool partiel ne doit jamais écraser un pool complet.
5. **Web app** : le scout complet survit aux limites du proxy ; aucun texte ne promet une reprise que le web ne sait pas faire.
6. **Visuel** : harnais `.harness/` (serveur `ui-harness` du `launch.json` parent, mock `.harness/scoutMock.ts`), et les captures de `docs/audits/scout-front-captures/` (FR / EN, clair / sombre). Textes FR avec le jargon LoL en anglais, aucun texte brut d'erreur affiché.

## Rapport

`docs/notes/antigravity/2026-11-27_qa-scout-progressif.md` : constats (fichier:ligne, scénario, gravité bloquant / important / mineur), puis ce que tu n'as pas pu vérifier. Pas de modification du code. Pas de build de release en cours.
