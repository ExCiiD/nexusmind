# Décisions en attente de l'utilisateur

_Mis en attente le 26/11/2026 à la demande de l'utilisateur (« hold le reste des décisions sur un fichier, je les prendrai plus tard »). Purgé et revérifié le 26/11 après relecture de `docs/` et du code. Tenu par le Chief._

**Règles.** Aucune session ne tranche ni ne relance l'utilisateur sur ces points tant qu'il ne les a pas ouverts. Quand il décide : la ligne va dans `docs/DECISIONS.md`, puis elle est retirée d'ici. Les sessions peuvent avancer sur tout ce qui n'en dépend pas. Les recommandations sont celles des sessions, non validées. Les points tranchés (registre `DECISIONS.md`) ou déjà faits n'apparaissent pas. Statut général : `REFERENCE.md`.

Légende : **Reco** = recommandation de la session qui a posé la question.

_Retirés le 26/11 : D7 (clé OpenAI révoquée), D8 (migration appliquée), B1 (4 ajouts retenus), B6 (mention du site à retirer), D1 (textes légaux v0.3 validés), A1 (feu vert donné), B2 (disponibilités E15-C déjà faites, UI-21 fait, WSC-04 réglé par masquage), B3 « games » (jargon voulu), B4 (fichier `REFERENCE.md` créé), B5 (go), C4 (scripts `seed` et `prisma:migrate` déjà supprimés), D2 (migrations alignées sur la production le 20/11), D4 (web app redéployée le 20/11)._

---

## A. Moteur (chantier « bilans » lancé, restent les seuils)

| # | Question | Reco | Voir |
|---|---|---|---|
| A1b | **Seuil du roam du mid** (code fait, affichage désactivé) : seuil 1,25 = environ 12 cartes de roam perdant pour 100 parties de mid (leurs parties se gagnent à 26 % contre 53 %), 5-6 cas douteux sur 20 relus sur les seules données. Activer tel quel, relever le seuil (à 1,5 : 8 pour 100, 27 % de victoires) ou limiter à avant 14:00 ? Tant que non tranché, `DETECTOR_SPEC.roam.enabled = false`. | Relever un peu le seuil et relire quelques cartes en vidéo avant d'activer | `moteur/engine-reports/2026-11-26-calibrage-roam-mid.md` |
| A1c | **Seuils des autres bilans** (drapeaux à `false`) : top 1,5 (13,8 pour 100 parties, 26,7 % de victoires contre 53,2 %), ADC 1,25 (7,1 ; 27,7 % contre 51,6 %), support 1,25 (6,7 ; 25,0 % contre 51,7 %), ganks 2,5 (15,0 pour 100 parties de jungler ; environ 8 cas douteux sur 20). Limiter ADC et support à avant 14:00 ? Réduire la suite adverse des ganks ? Palier 16.16+ : seulement 114 parties-joueur dans le cache, calibrage fragile. Quêtes : écart réel affiché seul, aucun terme dans le verdict. Assistant : aucune règle écrite. | Activer d'abord mid + top, relire des cartes en vidéo, puis les autres | `moteur/engine-reports/2026-11-26-calibrage-*.md` |
| A2 | **Encart « Bilan des roams / ganks »** dans la Review : faire la maquette Penpot ? | Après calibrage des verdicts | `moteur/PLAN_MOTEUR_BILANS.md` § 5 |
| A3 | Le moteur **apprend des corrections** des joueurs (décision du 21/11 « à terme ») : à quelle étape ? Remontée cloud = consentement + revue Cyber + migration | Après les bilans (phase 5) | `moteur/PLAN_MOTEUR_BILANS.md` § 4 |
| A4 | Saison **2027** (janvier) : valider le calendrier de préparation, bascule seulement une fois les valeurs vérifiées | Préparer le mode prudent avant décembre | `moteur/engine-reports/2026-11-20-saison-courante-et-saison-2027.md` § 2.4 |

## B. Produit et interface

| # | Question | Reco | Voir |
|---|---|---|---|
| B2 | Restes de l'audit : **WSC-18** tiers manuels écrasés par la web app (migration de production nécessaire), **L14** filtre `ranked5` (retiré de l'interface, encore dans le code : nettoyer ou garder pour d'anciennes sessions), **E31** capture ddagrab (porte de secours : garder ou supprimer) | WSC-18 : corriger avec une migration sur accord ; L14 : nettoyer ; E31 : garder tant que le build packagé n'est pas validé | `audits/AUDIT_APP_2026-11.md` § 5 q. 8 |
| B3 | Clé `microReview.reason.noPrio` (« Entré sans prio de lane ») : jamais écrite par le code, présente seulement dans les fichiers de langue, aucune réponse enregistrée ne peut la contenir. La supprimer ? | Oui, puis `npm run check:i18n` | `audits/AUDIT_APP_2026-11.md` § 5 q. 12 |

## C. Performance et technique de l'app

| # | Question | Reco | Voir |
|---|---|---|---|
| C1 | **UI-09** découpage du renderer par route (pas commencé) et **RPC `staff_dashboard`** (pas faite), tous deux « plus tard » depuis le 20/11. UI-08 (minification) et UI-11 (pause du polling) sont faits : rien à décider. | Faire UI-09 après un build packagé de contrôle ; RPC plus tard | `audits/AUDIT_PERF.md` gains 5 et 10 |
| C2 | Installeur : retirer les runtimes ONNX inutiles (P2, −363 Mo non compressés ; `asarUnpack` embarque tout `onnxruntime-node`), `@prisma/client` et bibliothèques du renderer en devDependencies (D3/D4), garder ou non le repli `ffmpeg-static` (D6) | Oui pour P2 et D3/D4 ; D6 : garder tant que le build packagé n'est pas validé | `audits/AUDIT_APP_2026-11.md` § 3.5 |
| C3 | Post-partie (E10) : appliquer le correctif de l'enrichissement (`enrichWithMatchApi` ne regarde que le dernier match ; cœur du flux, à tester sur des parties enchaînées) | Oui avec test réel | `audits/AUDIT_APP_2026-11.md` § 5 q. 3 |
| C5 | Whisper : passer de `whisper-base` (en service) à `whisper-small` (meilleur français, plus lent). Aucun comparatif n'existe : demander d'abord au Back-end de le produire (qualité FR, temps, taille) | Comparatif d'abord | `archive/PLAN_CHIEF_2026-11-19_au_26.md` #10 |

## D. Base de production, déploiement, légal (rien ne bouge sans accord explicite)

| # | Question | Reco | Voir |
|---|---|---|---|
| D3 | Purge des marqueurs de suppression `sync_records` de plus de 90 jours | Plus tard, après revue Cyber | `archive/PLAN_CHIEF_2026-11-19_au_26.md` #11 |
| D5 | Signature payante des installeurs : **à redemander vers 300 utilisateurs** (mémoire du 21/11) ; jeton de publication à portée minimale + 2FA GitHub restent à faire côté utilisateur | — | `archive/PLAN_CHIEF_2026-11-19_au_26.md` #23 |
| D6 | **Clé Riot de production** (dossier prêt, `riot.txt` publié le 24/11) et **vérification Google YouTube** (dossier prêt, rien déposé) : formulaires à soumettre par l'utilisateur ; monétisation et site public | Soumettre les deux | `prod/DEMANDE_CLE_PROD.md`, `prod/GOOGLE_YOUTUBE_VERIFICATION.md`, `prod/PLAN_MONETISATION.md` |
