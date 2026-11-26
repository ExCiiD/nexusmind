# Documentation d'Ascend (NexusMind) — index

Réorganisé le 26/11/2026. **Commencer par `REFERENCE.md`** (statut et vision), puis `DECISIONS.md`, `INBOX.md`, `DECISIONS_EN_ATTENTE.md` et `TEAM_ROLES.md`.

## À la racine : pilotage

| Fichier | Rôle |
|---|---|
| `REFERENCE.md` | Suivi et vision, tenu à jour par le Chief |
| `DECISIONS.md` | Registre des décisions de l'utilisateur (toutes les sessions le lisent) |
| `DECISIONS_EN_ATTENTE.md` | Décisions ouvertes, parquées jusqu'à ce que l'utilisateur les ouvre |
| `INBOX.md` | Fil durable entre les sessions |
| `TEAM_ROLES.md` | Rôles des sessions et règles de travail |
| `engine-timings.json` | Données lues par `scripts/check-patch-timings.mjs` et son workflow |

## À la racine : documents cités par du code ou des migrations

Ils ne sont pas rangés dans un dossier car les migrations SQL (qu'on ne réécrit pas) ou le code les citent par leur chemin.

| Fichier | Rôle |
|---|---|
| `DESIGN_STATE.md` | Spécifications d'interface (numéros de § cités partout) |
| `PLAN_GESTION_EQUIPE.md` | Plan de la section Équipe et staff (conception, historique de livraison) |
| `PLAN_MICRO_REVIEW.md` | Plan de la micro-review V1-V10 (historique de livraison ; la source du comportement actuel est `moteur/RAPPORT_MOTEUR.md` et le code) |
| `PROPOSITION_SCRIMS_PLANNING.md`, `CONTRAT_SCRIMS_PLANNING.md` | Scrims et Planning : proposition puis contrat |
| `PROPOSITION_ANALYSTE.md` | Page et outils de l'analyste (go du 26/11) |
| `AUDIT_SECURITE.md` | Audit de sécurité (constats `S19-xx`, tenu par Cyber) |
| `AUDIT_LIAISONS.md` | Liaisons entre sections et onglets par rôle |
| `CLOUD_SETUP.md` | Mise en place Supabase, Cloudflare |
| `contracts/` | Contrats d'interface (organisation, realtime, session de prépa, historique des sessions, région de compte) |

## Dossiers

| Dossier | Contenu |
|---|---|
| `moteur/` | Moteur de coaching : `ENGINE_NOTES.md` (carte et méthode), `MOTEUR_REGLES.md` (assistant), `RAPPORT_MOTEUR.md` (catalogue des règles), `RECHERCHE_CONNAISSANCES.md`, `DONNEES_JEU_2026.md`, `PLAN_MOTEUR_BILANS.md` (le seul plan vivant), `engine-reports/` (rapports de conception du 20/11 et de calibrage du 26/11) |
| `audits/` | `AUDIT_APP_2026-11.md` (référentiel des identifiants E, UI, L, WSC…), `AUDIT_PERF.md` (performance, mesures en annexe), `AUDIT_REGLES_METIER.md` (catalogue des règles métier M, S, R…), `QUALITY_CRITERIA.md` (critères par catégorie et procédure de revue) |
| `prod/` | Mise en production et conformité : clé Riot (`DEMANDE_CLE_PROD.md`, `PLAN_CLE_PROD.md`, `RIOT_PRODUCT_DESCRIPTION.md`, `riot-application/`), `GOOGLE_YOUTUBE_VERIFICATION.md`, `LEGAL_V0.3_DRAFT.md`, `MISE_EN_PROD_TEAM_DATA.md`, `PLAN_MONETISATION.md`, `PLAN_VITRINE.md` |
| `notes/` | Notes des sessions `BACKEND_NOTES.md`, `FRONTEND_NOTES.md`, mode d'emploi `FEEDBACK.md` |
| `archive/` | Documents dépassés, gardés pour l'historique (voir `archive/README.md`) |

## Changements du 26/11

- `ROADMAP.md`, `RAPPORT_FONCTIONNALITES.md` et le tableau de `PLAN_CHIEF.md` → `REFERENCE.md` ; les originaux sont dans `archive/`.
- `AUDIT_PERF.md` et `AUDIT_PERF_2.md` fusionnés en `audits/AUDIT_PERF.md`.
- `QUALITY_CRITERIA.md` allégé : les revues de livraisons et la première passe sont dans `archive/REVUES_QUALITY_2026-11.md`.
- Rapports de roams du 20/11 (mid et tous laners) fusionnés en `moteur/engine-reports/2026-11-20-bilan-des-roams.md`.
- Tous les renvois `docs/…` du code, des tests, des scripts et des documents ont été mis à jour. Les commentaires de migrations SQL appliquées n'ont pas été modifiés : un renvoi ancien (par exemple `docs/AUDIT_REGLES_METIER.md` avant le 26/11, aujourd’hui `audits/AUDIT_REGLES_METIER.md`) se retrouve par son nom de fichier dans le dossier correspondant.
