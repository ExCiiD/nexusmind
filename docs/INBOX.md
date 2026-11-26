# Inbox

A scratch list for anything you want remembered across a session gap —
half-formed ideas, "don't forget X", attachments you're about to send. Chat
messages can get lost across a long session's auto-compactions; this file
can't, since it's read fresh at the start of every session.

Add an entry whenever you think of something, in whatever shape it's in.
Claude checks this file at the start of each session and will ask about any
`pending` item instead of silently skipping it.

## Pending

- [ ] (2026-11-24) **Optimiser les requêtes en VITESSE, pas en quantité de données** (Riot surtout, scouting d’équipe en premier : ~1 500 requêtes aujourd’hui). Même quantité de données ou plus, **jamais moins sauf si c’est inutile** ; certaines requêtes ne s’optimisent pas, et c’est OK. Pistes scout : pool instantané par la maîtrise (1 requête / joueur), parties communes aux 5 adversaires téléchargées une seule fois, affichage progressif (les plus récentes d’abord), parallélisme dans le budget du proxy. **Ne PAS** réduire la profondeur par défaut (la saison complète reste). À confier à Back-end + Front-End après le reset du quota (jeudi 26/11).
- [ ] (2026-11-17, repris de l'ancien handoff le 26/11) **Bug « chargement infini / impossible de se reconnecter après déconnexion »** : jamais confirmé corrigé. Demander à l'utilisateur s'il persiste (desktop ou web, étapes) ; sinon le passer en Done. Pistes : `web/src/api.ts`, `web/src/pages/AccountPage.tsx`, `electron/main/ipc/auth.ipc.ts`.
- [ ] (2026-11-26) **Décisions en attente** de l'utilisateur : toutes regroupées dans `docs/DECISIONS_EN_ATTENTE.md`. **Chantier moteur « bilans »** (roams, ganks, quêtes de rôle) : plan dans `docs/moteur/PLAN_MOTEUR_BILANS.md`, feu vert donné le 26/11 (phases en cours, seuils A1b/A1c à valider).

<!-- - [ ] (2026-11-17) Example: UI upgrade — background/icons/popups, details TBD -->

## Done

<!-- Move an item here with the date it was completed, instead of deleting it. -->
