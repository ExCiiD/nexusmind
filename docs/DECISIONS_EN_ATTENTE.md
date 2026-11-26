# Décisions en attente de l'utilisateur

_Mis en attente le 26/11/2026 à la demande de l'utilisateur (« hold le reste des décisions sur un fichier, je les prendrai plus tard »). Purgé et revérifié le 26/11 après relecture de `docs/` et du code. Tenu par le Chief._

**Règles.** Aucune session ne tranche ni ne relance l'utilisateur sur ces points tant qu'il ne les a pas ouverts. Quand il décide : la ligne va dans `docs/DECISIONS.md`, puis elle est retirée d'ici. Les sessions peuvent avancer sur tout ce qui n'en dépend pas. Les recommandations sont celles des sessions, non validées. Les points tranchés (registre `DECISIONS.md`) ou déjà faits n'apparaissent pas. Statut général : `REFERENCE.md`.

Légende : **Reco** = recommandation de la session qui a posé la question.

_Retirés le 26/11 : A1b, A1c, A2, A3, A4, B2, B3, C1, C2, C3, C5, D3 (go de l'utilisateur, voir `DECISIONS.md`), D7 (clé OpenAI révoquée), D8 (migration appliquée), B1 (4 ajouts retenus), B6 (mention du site à retirer), D1 (textes légaux v0.3 validés), A1 (feu vert donné), B2 (disponibilités E15-C déjà faites, UI-21 fait, WSC-04 réglé par masquage), B3 « games » (jargon voulu), B4 (fichier `REFERENCE.md` créé), B5 (go), C4 (scripts `seed` et `prisma:migrate` déjà supprimés), D2 (migrations alignées sur la production le 20/11), D4 (web app redéployée le 20/11)._

---

## A. Moteur (chantier « bilans » lancé, restent les seuils)

| # | Question | Reco | Voir |
|---|---|---|---|

## B. Produit et interface

| # | Question | Reco | Voir |
|---|---|---|---|

## C. Performance et technique de l'app

| # | Question | Reco | Voir |
|---|---|---|---|

## D. Base de production, déploiement, légal (rien ne bouge sans accord explicite)

| # | Question | Reco | Voir |
|---|---|---|---|
| D5 | Signature payante des installeurs : **à redemander vers 300 utilisateurs** (mémoire du 21/11) ; jeton de publication à portée minimale + 2FA GitHub restent à faire côté utilisateur | — | `archive/PLAN_CHIEF_2026-11-19_au_26.md` #23 |
| D6 | **Clé Riot de production** (dossier prêt, `riot.txt` publié le 24/11) et **vérification Google YouTube** (dossier prêt, rien déposé) : formulaires à soumettre par l'utilisateur ; monétisation et site public | Soumettre les deux | `prod/DEMANDE_CLE_PROD.md`, `prod/GOOGLE_YOUTUBE_VERIFICATION.md`, `prod/PLAN_MONETISATION.md` |
