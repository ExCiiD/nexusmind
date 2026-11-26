> **ARCHIVÉ le 26/11/2026** : document livré ou remplacé, gardé pour l'historique. Ne pas suivre comme instruction.

# Handoff du projet Ascend (NexusMind) — 19/11/2026

À lire en premier par toute session, avec `docs/TEAM_ROLES.md` (organisation
des sessions), `docs/INBOX.md` et l'index de mémoire. Ce document remplace le
handoff du 17/11 : il réunit l'état de toutes les sessions du projet,
archivées le 19/11 après cette synthèse (sauf deux, voir § 5).

## 1. Où en est le projet

- **Version publiée :** `1.0.0-beta.7` (pré-version GitHub, commit `dee94ad`).
- **`main` local :** 2 commits d'avance sur `origin/main`, ni poussés ni
  publiés : la réorganisation de la section « Équipe & staff »
  (`4ffef1d` + fusion `41f457c`). C'est la prochaine version (`beta.8`).
- **Base de production (Supabase) modifiée le 19/11, avec accord :**
  - `sync_push` ne réécrit plus une ligne renvoyée à l'identique
    (`supabase/migrations/20261119120000_sync_push_skip_noop.sql`) ;
  - nouvelle table `team_session_attendance` (présence aux réunions,
    `20261119140000_team_session_attendance.sql`).
- **Données supprimées le 19/11, avec accord :** équipes locales jade et
  Crimson, roster publié et scouting manuels du groupe AscendTest.
  Sauvegardes dans `C:\Users\ariso\AppData\Roaming\nexusmind\data\backups\`.
- **Web app et site :** le site vitrine est en ligne en aperçu non indexé
  (https://ascend-site.nexusmind-riot-proxy.workers.dev). La web app n'a pas
  été redéployée depuis : la règle CSP des logos (`web/public/_headers`) et la
  page Management web attendent un déploiement.

## 2. Livré récemment (beta.4 → beta.7 + `main`)

- Équipe construite automatiquement depuis les joueurs du groupe (plus de
  liaison manuelle) ; compte Riot obligatoire pour rejoindre un groupe.
- Section « Équipe & staff » en quatre pages (Management, Espace d'équipe,
  Coaching, Stats collectives) avec un seul sélecteur de groupe (sur `main`).
- Sessions d'équipe : fin de partie → review / dernière partie / review
  finale maintenant ou plus tard ; réunions (raison, personnes, présence) ;
  bouton « Ouvrir la session d'équipe » dans le Planning.
- Transcription Whisper réparée (import `wavefile`), anti-boucle, bouton
  « Relancer la transcription » ; micro activé par défaut.
- Détecteurs de micro-review sur l'horloge 2026, connaissances high-elo du
  moteur, audit complet de l'app (`docs/AUDIT_APP_2026-11.md`).
- Cartes joueurs : apparence, fonds, détourage des champions, récompenses
  MVP / Grinder ; export LFT ; Champion Pool tiers v2 ; lancement au
  démarrage de Windows.

## 3. Travail ouvert, par priorité et par rôle

| # | Sujet | Rôle | Détail |
|---|---|---|---|
| 1 | Pousser et publier `beta.8` (section Équipe & staff) | Chief | Vérifiée dans le harnais avec deux groupes ; 1 502 tests OK. |
| 2 | Bug « chargement infini / impossible de se reconnecter après déconnexion » (ouvert depuis le 17/11) | Back-end | Demander desktop ou web et les étapes. Partir de `web/src/api.ts`, `web/src/pages/AccountPage.tsx`, `electron/main/ipc/auth.ipc.ts`, la restauration de session Supabase du desktop. |
| 3 | Pack de détourage de tous les skins | Graphic Design → Back-end → Front-end | Lancé le 19/11 à 11:15, ~2 145 skins, ~6 h ; sortie `D:\DEV\NexusMind\cutout-pack` (`review.html` pour vérifier). Ensuite : héberger les images, puis choix du skin sur la page Profil. La session d'origine (« Auto background removal… ») est gardée non archivée tant que le calcul tourne. |
| 4 | Règles encore sur l'horloge 2025 | Back-end | Plaques (plus à 14:00 en 2026) : règles dive, roam mid sur plaques, tour latérale ; M12 « mort avant 4:00 ». Voir `docs/RAPPORT_MOTEUR.md`. |
| 5 | Détourage dans l'app | Front-end | Pas d'indicateur pour le téléchargement du modèle (224 Mo) ; seul le skin 0 est découpé ; tresse de Jinx coupée (`REFINE_DEFAULTS`, puis augmenter `CUTOUT_VERSION`). |
| 6 | Draft Sim : anciennes couleurs de tiers dans la barre du pool | Front-end | Aligner `DraftTab.tsx` sur `ChampionPoolBoard.tsx`. |
| 7 | Scouting : liste les adversaires de toutes les équipes de l'ordinateur | Front-end + Back-end | Filtrer sur le groupe choisi. |
| 8 | Page Penpot des 6 fonds de cartes | Graphic Design | L'onglet Penpot doit rester au premier plan pendant le travail. |
| 9 | Déployer la web app | Back-end | CSP logos + page Management web. |
| 10 | Qualité de transcription | Back-end | Modèle `whisper-base` ; évaluer `whisper-small` (meilleur français, plus lent). |
| 11 | Purge des marqueurs de suppression de `sync_records` (> 90 jours) | Back-end | Plus tard ; base de production → accord requis. |
| 12 | Backlog de l'audit (décisions et correctifs) | Audit + Chief | `docs/AUDIT_APP_2026-11.md` § 3 (E02, E06, E10, UI-08, UI-11, L06, WSC-05…). |
| 13 | Sécurité | CyberSecurity | `docs/AUDIT_SECURITE.md` ; clé OpenAI encore dans `.env` (à révoquer) ; secret YouTube embarqué ; textes légaux v0.1 dans l'app contre v0.2 sur le site (L06) ; ffmpeg téléchargé sans vérification d'empreinte (S3). |
| 14 | Ménage | Chief | Worktrees déjà fusionnés : `wt-app-audit`, `wt-detectors-2026`, `wt-engine-knowledge`, `wt-section3`. |

## 4. Règles de travail (à respecter par toutes les sessions)

- **Commit, push, release, base de production :** seulement sur demande
  explicite de l'utilisateur. Toute modification de la base Supabase de
  production demande son accord.
- **Migrations locales :** jamais `prisma migrate dev` (dérive de `dev.db`) ;
  écrire le SQL à la main dans `prisma/migrations/<date>_<nom>/`. **Pas de
  point-virgule dans les commentaires SQL** : le runner découpe sur `;` avant
  d'enlever les commentaires (l'app ne démarrerait plus).
- **Release :** `scripts/release.ps1` après avoir monté la version dans
  `package.json`. Si d'autres sessions ont du travail non commité dans le
  dossier, le mettre de côté pendant le build (le build embarque le dossier
  de travail, pas le commit), puis le restaurer et vérifier.
- **Vérifications :** `npm run typecheck`, `npm run lint`,
  `npm run check:i18n`, `npx vitest run` ; interface vérifiée dans le
  harnais (`.harness/`, serveur `ui-harness` du `launch.json` parent, port 5199).
- **Textes FR :** garder le jargon LoL en anglais (shotcalling, spacing,
  trades, waves, gank, roam, cooldowns…).
- **Design :** les changements visuels se maquettent dans Penpot d'abord
  (serveur MCP `penpot`, onglet Penpot connecté et au premier plan).
- **Shell :** pas de `\` dans un heredoc ou un `node -e` (ils sont mangés) :
  écrire le script avec l'outil d'écriture de fichiers.
- **Synchronisation :** filtrer explicitement par uid, ne jamais compter
  sur la RLS seule.

## 5. Sessions archivées le 19/11 (historique)

| Session | Résultat |
|---|---|
| Main (17/11) | Coordination initiale, `docs/INBOX.md`, ancien handoff. |
| Phase A — assistant à règles métier | Assistant + `AssistantFeedback`, fusionné. |
| Moteur de règles métier complet | Moteur de coaching, fusionné. |
| Local assistant engine + guided micro-review | Micro-review guidée, Codex, site vitrine déployé. |
| Build the Ascend design library in Penpot (**non archivée**) | Coordination du 18-19/11, bibliothèque Penpot, merges beta.3-beta.4. L'archiver archiverait aussi « Auto background removal… » : à archiver ensemble une fois le pack de détourage terminé (#3). |
| Auto background removal for player card champion art (**non archivée**) | Lanceur du pack de détourage (#3), en cours. |
| Tiers v2 (New) + maquette Champion Pool | Nouvelle page Champion Pool (reste : couleurs Draft Sim, #6). |
| Cartes joueurs du Roster | Cartes icône / bannière / top 5. |
| Fermer l'auto-promotion capitaine | Vérifié en production : rien à changer. |
| Détourage automatique des champions | BiRefNet lite en local (restes : #5). |
| Looking-for-team announcement export | Export LFT, apparence des cartes, icône jungle officielle (reste : #8). |
| Weekly MVP and Grinder awards | Récompenses + lancement au démarrage. |
| Engine knowledge / Re-time detectors 2026 | Connaissances du moteur, horloge 2026 (reste : #4). |
| Full app audit | Audit + réorganisation de la section 3 (fusionnée, reste : #1, #7, #12). |
