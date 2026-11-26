# Plan du Chief — lots à déléguer (26/11/2026)

Tous les points ci-dessous ont reçu le go de l'utilisateur le 26/11 (`DECISIONS.md`). Un lot = une session, des fichiers
délimités. Les lots touchant la production attendent l'accord explicite de l'utilisateur au moment d'appliquer.
Les 59 fichiers modifiés non commités (moteur, riot-proxy, tests) appartiennent aux sessions en cours : ne pas y toucher.

| Lot | Session | Contenu | Dépend de |
|---|---|---|---|
| L1 | Engine → Front | Activer les bilans **mid** puis **top** : relever un peu le seuil du mid (1,25 vers environ 1,4), relire quelques cartes en vidéo, passer les drapeaux `DETECTOR_SPEC` à `true`. Puis ADC, support, ganks (A1c). | relecture vidéo |
| L2 | Graphic | Maquette Penpot de l'encart « Bilan des roams / ganks » ; maquette des 4 ajouts de l'historique d'équipe (rappel de review 48 h, recherche par adversaire, tendance, lien Journal des drafts). | L1 pour l'encart |
| L3 | Chief | **Rien à retirer du site** : la mention existante est la promesse Riot « aucune information pendant la partie » (`site/src/copy/fr.mjs:400`, `en.mjs:397`), à garder. Le rappel d'objectif en cours de partie n'est écrit nulle part sur le site ni construit : il est abandonné pour rester conforme. À confirmer par l'utilisateur. | — |
| L4 | Back + Front | Page analyste, suites (`PROPOSITION_ANALYSTE.md`), en commençant par le rapport de période. | — |
| L5 | Back | Optimisation des requêtes en vitesse (scouting d'abord), sans réduire les données (`INBOX.md`). Comparatif Whisper base/small (C5). Correctif E10 avec test sur parties enchaînées (C3). | quota Riot remis à zéro |
| L6 | Front | Supprimer la clé `microReview.reason.noPrio` + `npm run check:i18n` (B3) ; nettoyer `ranked5` (L14). | — |
| L7 | Back + Cyber | WSC-18 : colonne `auto_tier` et migration, **à appliquer sur accord explicite**. Purge des marqueurs de suppression (D3) après revue Cyber. | revue Cyber |
| L8 | Back | Installeur : runtimes ONNX, `@prisma/client` et bibliothèques du renderer en devDependencies (C2) ; build packagé de contrôle, puis UI-09 (C1). | build packagé |
| L9 | Engine + Back | Saison 2027 : mode prudent prêt avant décembre. | — |
| L10 | Chief | Après L1 : `REFERENCE.md`, `DECISIONS_EN_ATTENTE.md`. Reste côté utilisateur : D5, D6, contrôle analyste, bug reconnexion. | — |
