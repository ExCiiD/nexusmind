# Référence — suivi et vision d'Ascend (NexusMind)

**Fichier unique de suivi et de vision, tenu à jour par le Chief** à chaque compte rendu d'un département (décision de l'utilisateur du 26/11/2026). Il remplace `ROADMAP.md`, `RAPPORT_FONCTIONNALITES.md` et le tableau de `PLAN_CHIEF.md` (tous trois archivés dans `docs/archive/`). Les décisions de l'utilisateur sont dans `DECISIONS.md`, celles qu'il a mises en attente dans `DECISIONS_EN_ATTENTE.md`.

_Dernière mise à jour : 26/11/2026. Base : `main` = merge Electron 45 (`21ec218`), dernière version publiée 1.0.0-beta.23. Les statuts ont été revérifiés dans le code et dans git ce jour-là ; « non vérifié » = pas contrôlé._

---

## 1. Vision

**Ascend** (ex-NexusMind) : application Windows de coaching et de revue pour joueurs de League of Legends. Local-first (SQLite), avec cloud Supabase (synchronisation, groupes, web app), proxy Riot sur un Cloudflare Worker, et un assistant **entièrement à règles métier** (déterministe, explicable, sans IA payante). Site vitrine asc3nd.app, web app app.asc3nd.app, installeur publié en pré-versions `1.0.0-beta.x` sur GitHub.

**Promesse.** Donner au joueur la boucle hypothèse → pratique → mesure → verdict, pour qu'il apprenne à se diagnostiquer seul ; donner aux équipes (coach, manager, analyste, capitaine) un espace partagé. Aucune information pendant la partie.

**Capacités livrées (beta.23).**
- **Joueur** : sessions à objectifs (38 fondamentaux en 7 familles, session sans fondamental possible), détection de partie et enregistrement de **toutes** les parties, lecteur unique (Record et Review fusionnés), clips et mode clip, partage YouTube (envoi automatique, PKCE) et Discord, review v2, review courte, micro-review de 45 s guidée (46 schémas, fiches Codex), Labo d'erreurs, statistiques, radar des fondamentaux, « Mon plan » (expériences avec verdict), assistant (32 règles), profil (paliers, 27 icônes, titres), 8 thèmes, serveur par compte.
- **Équipe et staff** : groupes avec rôles multiples, Lobby d'équipe (cartes champion et skin détourés), roster lié au puuid, Champion Pool (main, comfort, flex, new, learning), Draft Sim, Scouting par groupe, scrims et Planning, sessions d'équipe automatiques avec historique et réunions transcrites, préparation de session, « Mon espace » et Organisation (manager), espace analyste (Objectifs, Journal des drafts, Dossier adverse), bien-être avec consentement RGPD art. 9, annonces, tâches, essais, bot Discord.
- **Plateforme** : synchronisation multi-appareils (`sync_records`, filtrage explicite par uid), Realtime, web app PWA, invitations (pas d'inscription publique), suppression de compte, sauvegarde cloud manuelle, baseline de migrations rejouable, CSP, Electron 45.4.1 avec fuses.

**Phases à venir.**
- *Court terme* : clé Riot de production (dossier prêt), vérification Google YouTube, mise en production de la migration `team_data_scoped_to_linked_group`, **chantier « bilans »** (roams, ganks, quêtes de rôle : code fait, affichages désactivés, seuils à valider), préparation de la saison 2027.
- *Moyen terme* : suites de la page analyste (go du 26/11), historique des sessions d'équipe (ajouts à choisir), « Phase B » autonomie du joueur (matchups, anti-tilt, bibliothèque de référence, revue croisée), apprentissage du moteur par les corrections des joueurs, repères par rang, notifications push et e-mail, offre freemium (Gratuit / Pro / Team, après approbation de la clé Riot).
- *Fin* : signature des installeurs (à ~300 utilisateurs), passage de pré-version à version 1.0.

**Idées non planifiées** : mini-replay animé sans VOD, micro-review sur mobile, notification « micro-review prête », raccourcis QCM, clip automatique à chaque erreur, contrôle automatique des timers à chaque patch, connaissances par champion, carnet de matchups (à valider vis-à-vis des règles Riot), seuils réglables par le coach, comparaison Labo contre équipe, export CSV/JSON, bilan hebdomadaire par lien public, LLM local pour reformuler (jamais pour décider), comparer son radar à un joueur suivi, profils synchronisés hébergés.

---

## 2. En cours et bloqué (au 26/11)

| Sujet | Responsable | Statut | Prochaine action |
|---|---|---|---|
| **Chantier « bilans »** : roams (mid, top, ADC, support), ganks, quêtes de rôle, indicateurs de l'assistant. Plan : `moteur/PLAN_MOTEUR_BILANS.md` | Engine → Back-end, Front-end | **Feu vert de l'utilisateur le 26/11.** Phases 0 à 4 faites ; **tous les drapeaux `DETECTOR_SPEC.*.enabled` sont à `false`** ; `ANALYSIS_VERSION` 16 | Valider les seuils A1b/A1c (`DECISIONS_EN_ATTENTE.md`), relire quelques cartes en vidéo, activer mid puis top, puis le reste ; monter `ANALYSIS_VERSION` une seule fois à l'activation |
| Migration `20261126090000_team_data_scoped_to_linked_group` (données d'équipe lisibles par le staff du groupe lié) + retour arrière + test 16/16 | Back-end, Cyber | Écrite, **non appliquée en production** | Accord explicite de l'utilisateur, voir `prod/MISE_EN_PROD_TEAM_DATA.md` |
| Page analyste, suites (proposition `PROPOSITION_ANALYSTE.md`) | Graphic → Back-end, Front-end | **« Go » de l'utilisateur le 26/11** ; points 1 à 3 déjà construits, 5 partiel | 5 phases à déléguer, en commençant par le rapport de période et l'extraction de la timeline partagée |
| Historique des sessions d'équipe : 4 ajouts retenus le 26/11 (rappel de review 48 h, recherche par adversaire, tendance, lien Journal des drafts ; `DESIGN_STATE.md` § 15.3) | Graphic puis Front/Back | Aucun construit ; maquette à faire | `DECISIONS.md` 26/11 |
| Clé Riot de production + vérification Google YouTube | Utilisateur | Dossiers prêts (`prod/DEMANDE_CLE_PROD.md`, `prod/GOOGLE_YOUTUBE_VERIFICATION.md`) ; Riot semble déposé (`riot.txt`, 24/11), aucune trace d'approbation ; Google non déposé | L'utilisateur soumet les formulaires |
| Révocation de la clé OpenAI (encore dans `.env` local) et de `GH_TOKEN` | Utilisateur | **À faire chez le fournisseur** | Aucun code ne lit la clé |
| 2FA GitHub et jeton de publication à portée minimale | Utilisateur | À faire | — |
| Signature payante des installeurs | Utilisateur | Reportée : à reposer vers 300 utilisateurs | — |
| Bug « chargement infini / reconnexion impossible » (corrigé le 19/11) | Utilisateur | Jamais confirmé en réel | Demander si le bug persiste, sinon fermer |
| Optimisation des requêtes en vitesse (scouting en premier) | Back-end, Front-end | Demandée le 24/11, à lancer après le reset du quota Riot (26/11) ; la profondeur par défaut reste la saison complète | Voir `INBOX.md` |
| Saison 2027 | Engine, Back-end | Préparer le mode prudent avant décembre, basculer seulement une fois les valeurs vérifiées | `moteur/engine-reports/2026-11-20-saison-courante-et-saison-2027.md` |

## 3. Backlog technique ouvert (vérifié le 26/11)

| Id | Sujet | Statut réel | Décision |
|---|---|---|---|
| UI-09 | Découpage du renderer par route (`React.lazy`) | **Pas commencé** (0 `lazy`, 0 `manualChunks`) | « Plus tard » (20/11) |
| UI-08 | Minification du renderer | **Fait** (`electron.vite.config.ts`) | — |
| UI-11 | Pause du polling quand la fenêtre est cachée | **Fait pour l'essentiel** (hook `useVisiblePolling`, 5 composants) ; à re-mesurer | — |
| Gain 5 | RPC `staff_dashboard` | **Pas faite** : 3 requêtes directes dans `staffDashboardCore.ts` | « Plus tard » (20/11) |
| P2, D3/D4, D6 | Installeur : exclure les runtimes ONNX inutiles, `@prisma/client` et bibliothèques du renderer en devDependencies, repli `ffmpeg-static` | **Aucun fait** ; `asarUnpack` embarque `onnxruntime-node` en entier | Décision C2 en attente |
| E10 | Enrichissement post-partie (`enrichWithMatchApi` ne regarde que le dernier match) | **Non corrigé** (BE-3, P1 ouvert) | Décision C3 en attente (test sur parties enchaînées) |
| Whisper | `whisper-base` utilisé ; aucun comparatif avec `whisper-small` | Non commencé | Produire le comparatif, puis décision C5 |
| WSC-18 | Tiers manuels écrasés par la web app (pas de colonne `auto_tier`) | **Non fait** : migration de production nécessaire | Décision requise |
| L14 | Filtre `ranked5` | Retiré de l'interface le 19/11, **encore dans le code** (type, enum zod, `queueBucket`, i18n) | Nettoyer ou garder pour d'anciennes sessions |
| E31 | Backend de capture ddagrab (porte de secours, `NXM_RECORDER=ddagrab`, défaut `wgc`) | Toujours en place, **jamais tranché** | Garder ou supprimer |
| #11 | Purge des marqueurs de suppression `sync_records` de plus de 90 jours | En attente | Après revue Cyber |
| #26 | `npm audit` | 45 → 12 avis (`eed9738`), reste dans les outils de développement | À examiner |
| S19-02, 05, 06, 11, 12, 14 | Constats de sécurité encore ouverts | Voir `AUDIT_SECURITE.md` ; S19-01 (Electron 45) attend des tests manuels | — |
| i18n | Clé `microReview.reason.noPrio` | Jamais écrite par le code, présente seulement dans les deux fichiers de langue | Suppression recommandée, à confirmer |
| Phase 2 | Découper les fichiers de plus de 1 400 lignes, logger structuré, crash reporting opt-in | Non fait | Au fil de l'eau |

## 4. Livré (résumé des 52 tâches du plan de novembre)

Tout ce qui suit est **fait, publié** (beta.8 à beta.23) et n'a plus besoin de suivi. L'historique détaillé est dans `archive/PLAN_CHIEF_2026-11-19_au_26.md` (numéros `#1` à `#52` utilisés dans les autres documents).

- **Release et build** : beta.8 → beta.23, `release.ps1` contrôlé (#1, #17), Electron 45.4.1 + electron-builder 26.18 + fuses (#22), baseline des migrations (#20).
- **Fiabilité** : reconnexion (#2), `web/src/api.ts` vérifié contre `AscendAPI` (#18), suppression de compte et contenus de groupe en `SET NULL` (#29, #33), pseudo Riot renommé rattaché au puuid (#38), rôles multiples (#39).
- **Interface** : pack de détourage et choix de skin (#3, #5), fonds de cartes (#8), contrastes et accessibilité clavier (#16, #31, #36), 27 icônes de profil (#37), Design System Penpot resynchronisé (#15).
- **Équipe** : Scouting par groupe (#7), Draft Sim aligné (#6), web app déployée (#9), page Management web, bot Discord durci et déployé (#24), consentement bien-être (#27, #35), textes légaux v0.3 (#21, #30), Mon espace, préparation de session, Organisation.
- **Moteur** : règles recalées sur l'horloge 2026 (#4, #45), bilans phases 0 à 4.
- **Sécurité** : secret YouTube retiré (PKCE), ffmpeg épinglé par empreinte, `REVOKE` des fonctions cron (#25), CSP du renderer.

## 5. Organisation de `docs/`

Voir `README.md` (index). Règle : ce fichier est la seule source de vérité du **statut** ; les plans et rapports détaillent le **comment**. Quand un département livre, le Chief met à jour les §§ 2 à 4 ici, jamais ailleurs.
