# Décisions en attente de l'utilisateur

_Mis en attente le 26/11/2026 à la demande de l'utilisateur (« hold le reste des décisions sur un fichier, je les prendrai plus tard »). Tenu par le Chief._

**Règles.** Aucune session ne tranche ni ne relance l'utilisateur sur ces points tant qu'il ne les a pas ouverts. Quand il décide : la ligne va dans `docs/DECISIONS.md`, puis elle est retirée d'ici (ou cochée avec la date). Les sessions peuvent avancer sur tout ce qui n'en dépend pas. Les recommandations sont celles des sessions, non validées. Les points déjà tranchés (registre `DECISIONS.md`) n'apparaissent pas.

Légende : **Reco** = recommandation de la session qui a posé la question.

---

## A. Moteur (décision qui débloque du développement)

| # | Question | Reco | Voir |
|---|---|---|---|
| A1 | **Feu vert du chantier « bilans » (roams, ganks, quêtes de rôle)** : lancer la phase 0 (vérifications sur le cache) puis la phase 1, ou autre ordre ? | Oui, par phases, livraison silencieuse (mesure sans carte) avant d'afficher | `PLAN_MOTEUR_BILANS.md` § 7 |
| A1b | **Seuil du bilan de roam du mid (phase 1 faite, affichage désactivé)** : seuil 1,25 = ~12 cartes de roam perdant pour 100 parties de mid (leurs parties se gagnent à 26 % contre 53 %), 5-6 cas douteux sur 20 relus sur les seules données. Activer tel quel, relever le seuil, ou limiter à avant 14:00 ? Tant que non tranché, `DETECTOR_SPEC.roam.enabled = false`. Le « rentable » est rare (~2 pour 100) car la pression sans kill est invisible. | Relever un peu le seuil et relire quelques cartes en vidéo avant d'activer | `engine-reports/2026-11-26-calibrage-roam-mid.md` |
| A1c | **Seuils des autres ledgers (phases 2-4 faites, tout désactivé)** : drapeaux à `false` dans `DETECTOR_SPEC` : top 1,5 · ADC 1,25 · support 1,25 · ganks 2,5. Questions : limiter ADC et support à avant 14:00 ? réduire la suite adverse des ganks (relecture vidéo d'abord) ? Palier 16.16+ : seulement 114 parties-joueur dans le cache, calibrage fragile. Quêtes : écart réel affiché seul, aucun terme dans le verdict (double compte). Assistant : aucune règle écrite (se déclencherait sur 0 à 1,5 % des fenêtres de 5 parties), seuls les indicateurs par partie existent. | Activer d'abord mid + top, relire des cartes en vidéo, puis les autres | `engine-reports/2026-11-26-calibrage-*.md` |
| A2 | **Encart « Bilan des roams / ganks »** dans la Review : faire la maquette Penpot ? | Après la phase 3, une fois les verdicts calibrés | `PLAN_MOTEUR_BILANS.md` § 5 |
| A3 | Le moteur **apprend des corrections** des joueurs (décision du 21/11 « à terme ») : à quelle étape ? Remontée cloud = consentement + revue Cyber + migration | Après les bilans (phase 5) | `PLAN_MOTEUR_BILANS.md` § 4 |
| A4 | Saison **2027** (janvier) : valider le calendrier de préparation, bascule seulement une fois les valeurs vérifiées | Préparer le mode prudent avant décembre | `engine-reports/2026-11-20-saison-courante-et-saison-2027.md` § 2.4 |

## B. Produit et interface

| # | Question | Reco | Voir |
|---|---|---|---|
| B1 | **Historique des sessions d'équipe : 7 ajouts proposés** (comparer deux sessions, tendance, recherche par adversaire, moments clés, joueur de la session, rappel de review 48 h, lien Journal des drafts) : lesquels ? | À choisir | `DESIGN_STATE.md` § 15 « 3. Propositions » |
| B2 | Filtre `ranked5` (L14), règles de disponibilité hebdomadaires (E15-C), bouton « Choisir » des suggestions d'objectif (UI-21), onglets équipe de Coaching sur le web (WSC-04), tiers manuels sur le web (WSC-18), backend de capture ddagrab (E31) | Voir l'audit | `AUDIT_APP_2026-11.md` § 5 q. 8 |
| B3 | Le français écrit « parties » 241 fois et « games » 76 fois : « games » est-il du jargon voulu ? `microReview.reason.noPrio` peut-il rester dans des réponses enregistrées ? | À trancher | `AUDIT_APP_2026-11.md` § 5 q. 12 |
| B4 | **Deux listes de tâches** (`ROADMAP.md` et `RAPPORT_FONCTIONNALITES.md`) : laquelle reste la référence ? Les deux sont périmées (DOC3) ; l'autre serait archivée. | `PLAN_CHIEF.md` pour le suivi, `ROADMAP.md` pour la vision, archiver `RAPPORT_FONCTIONNALITES.md` | `AUDIT_APP_2026-11.md` DOC3 / DOC4 |
| B5 | Page « analyste » et fonctionnalités de l'analyste esport : suites non encore choisies, le cas échéant | Voir la proposition | `PROPOSITION_ANALYSTE.md` |

## C. Performance et technique de l'app

| # | Question | Reco | Voir |
|---|---|---|---|
| C1 | Minifier le renderer (UI-08, −43 %), découper par route (UI-09, déjà « plus tard » le 20/11), pause du polling quand la fenêtre est cachée (UI-11), RPC `staff_dashboard` (gain 5 du 20/11, « plus tard ») | Oui pour UI-08 et UI-11, après un build packagé de contrôle | `AUDIT_APP_2026-11.md` q. 4-5 ; `AUDIT_PERF_2.md` |
| C2 | Installeur : retirer les runtimes ONNX inutiles (P2, −363 Mo non compressés), bibliothèques du renderer et `@prisma/client` en devDependencies (D3/D4), garder ou non le repli `ffmpeg-static` (D6) | Oui pour P2 et D3/D4 ; D6 : garder tant que le build packagé n'est pas validé | `AUDIT_APP_2026-11.md` q. 6 |
| C3 | Post-partie (E10) : appliquer le correctif de l'enrichissement (cœur du flux, à tester sur des parties enchaînées) | Oui avec test réel | `AUDIT_APP_2026-11.md` q. 3 |
| C4 | Scripts : réparer ou supprimer `npm run seed` (S1) ; `prisma:migrate` (S2, retiré ? voir #19 du plan) | Supprimer `seed` ; S2 déjà retiré | `AUDIT_APP_2026-11.md` q. 11 |
| C5 | Whisper : passer de `whisper-base` à `whisper-small` (meilleur français, plus lent) | Selon le comparatif de Back-end | `PLAN_CHIEF.md` #10 |

## D. Base de production, déploiement, légal (rien ne bouge sans accord explicite)

| # | Question | Reco | Voir |
|---|---|---|---|
| D1 | **Textes légaux** : v0.3 (`LEGAL_V0.3_DRAFT.md`) à valider ; source unique app / site (L06) ; consentement bien-être (RGPD art. 9) | Valider v0.3, source unique dans `src/legal/` copiée vers le site au build | `PLAN_CHIEF.md` #21, #27, #30, #35 |
| D2 | Supabase : autoriser une **lecture seule de la production** pour versionner les migrations appliquées (WSC-05) | Oui | `AUDIT_APP_2026-11.md` q. 9 ; `PLAN_CHIEF.md` #20 |
| D3 | Purge des marqueurs de suppression `sync_records` de plus de 90 jours | Plus tard, après revue Cyber | `PLAN_CHIEF.md` #11 |
| D4 | Redéployer la web app (CSP élargie, méthodes ajoutées) si pas déjà fait | Voir l'état dans `PLAN_CHIEF.md` | `AUDIT_APP_2026-11.md` q. 2 |
| D5 | Signature payante des installeurs : **à redemander vers 300 utilisateurs** (mémoire du 21/11) ; jeton de publication à portée minimale + 2FA GitHub restent à faire côté utilisateur | — | `PLAN_CHIEF.md` #23 |
| D6 | Dossier **clé Riot de production** et vérification Google (YouTube) : formulaires à soumettre par l'utilisateur ; monétisation (R10) et site public | Voir le dossier | `DEMANDE_CLE_PROD.md`, `GOOGLE_YOUTUBE_VERIFICATION.md`, `PLAN_MONETISATION.md` |
| D7 | Clé OpenAI encore dans `.env` locale (à révoquer) et `GH_TOKEN` inutile | Révoquer (action de l'utilisateur chez le fournisseur) | `AUDIT_APP_2026-11.md` § 3.5 |

## E. Hors périmètre Chief, à signaler

- Fichiers à la racine `D:\DEV\NexusMind\` : `ascend_*_export.tsx` (4 instantanés d'interface du 17/11, hors dépôt, ~260 Ko) et `WORKFRAME_CHIEF.md` (cadre réutilisable pour d'autres projets) ne sont pas supprimés : garder ou jeter ? Les `wt-e45-*.log` appartiennent au worktree Electron 45 en cours.
