# Décisions de l'utilisateur — registre partagé

**Toute session lit ce fichier avant de travailler** (maquette, spec, code,
rapport) et s'y conforme. Une décision de l'utilisateur vaut pour tout le
projet, quelle que soit la session à qui il l'a dite. La session qui la
reçoit l'ajoute ici et prévient le Chief, qui la transmet aux sessions
concernées. Une ligne par décision, la plus récente en haut, avec la date et
les mots de l'utilisateur quand c'est possible.

| Date | Décision | Concerne |
|---|---|---|
| 20/11 | **« Lance-le »** : lot 1 de scalabilité (Supabase Realtime à la place du polling, auth vérifiée une fois, groupes chargés une fois, requêtes filtrées). **Chercher d’autres optimisations de charge et de vitesse.** | back, front, audit |
| 20/11 | **Ne pas restaurer l’historique effacé le 19/11, et ne plus poser la question.** Rester sur la demande en cours. | toutes |
| 20/11 | **« Yes, every game »** : l’app enregistre **toutes les parties**, même sans session active (historique, stats, enregistrement) ; la session reste un cadre en plus. | back, front |
| 20/11 | **Serveur de chaque compte** : un joueur peut avoir plusieurs comptes sur des serveurs différents (ex. EUW et SG). **Détection automatique par compte** (à partir du puuid), **plus un choix manuel par compte dans les Paramètres** (« Auto » par défaut). Valable pour tous les utilisateurs, y compris après un transfert de région. | back, front |
| 20/11 | Écrans du § 18 (`DESIGN_STATE.md`) **« Validées »** : dashboard « Organisation » du manager, page « Rejoins une équipe » (entrée unique « Équipe » sans groupe), toast de check-in au lancement d'une session. Maquettes : page Penpot « Rôles — manager, sans groupe, check-in ». | design, front, back |
| 20/11 | **Objectif : app largement scalable** (plus de fonctionnalités et d’utilisateurs) **et rapide** (requêtes et chargements) ; garder Supabase Pro (pris à cause des erreurs de connexion / chargements infinis). | toutes |
| 20/11 | **« Yes, all »** sur l’audit des liaisons (docs/AUDIT_LIAISONS.md) : Scouting d’un joueur **réduit aux dossiers publiés** ; **manager : dashboard d’organisation** (événements, présence, tâches, annonces) ; **joueur sans groupe : une seule entrée « Équipe »** (rejoindre ou créer, annonce LFT) ; **check-in bien-être proposé au lancement d’une session** ; **l’analyste peut fixer les objectifs de session** ; liaisons L1-L6 à faire. | design, front, back |
| 20/11 | **Accord de production et de release (beta.13)** : les migrations des sessions (150000 → 180000 et suivantes) et la publication, après les revues Audit et CyberSecurity. | back, chief |
| 20/11 | Dashboard joueur (§ 16) et préparation de session (§ 17) **approuvés**, avec un ajout aux **Annonces** : « ajouter un bouton "voir tout le message" si le message d'annonce est trop long. et "voir toutes les anonces" si il y'en a plusieurs » (message coupé à 3 lignes ; liste complète dès 2 annonces). | design, front |
| 20/11 | **Les sections forment un tout** : relier les pages qui se complètent (ex. « Mon plan » oublié), **sans forcer** une liaison inutile (un joueur peut ne pas jouer en groupe). Audit des liaisons demandé au Chief. | toutes |
| 20/11 | **Coachs : préparer les sessions à l’avance** (objectifs collectifs et individuels, drafts du Draft Sim). | design, back, front |
| 20/11 | **Onglets selon le rôle** : masquer les onglets presque vides pour un rôle (dashboard vide, pages de 1-2 blocs) ou les fusionner dans le dashboard, **sauf les pages qui se remplissent avec le temps**. | design, front |
| 20/11 | **Dashboard Management d’un joueur** (sans rôle management ou coach) : seulement ce à quoi il a accès — bien-être perso, planning, tâches attribuées, annonces, **mes dispos directement dans la page** (pas en pop-up). | design, front |
| 20/11 | **« Mon plan » relié à Coaching › Joueurs et au Dashboard** : l’axe et les notes du plan de développement donnés à un joueur s’affichent directement dans sa page « Mon plan » (section Pratique). | front, back |
| 20/11 | Historique des réunions : spec DESIGN_STATE § 15 « 2 bis » **« Approved »**. | front, back |
| 20/11 | **Session d’équipe créée automatiquement** (vide) à la création d’un événement Planning scrim / flex / tournoi ; elle **s’ouvre et se met à jour toute seule à l’heure de l’événement**. Si l’événement est **annulé** alors que la session n’a pas commencé (vide), la session est **supprimée** aussi. | back, front |
| 20/11 | **Historique des sessions de réunion** en plus des sessions de jeu. | design, back, front |
| 20/11 | **Optimiser la consommation de tokens entre les sessions** (« peut-être des allers-retours pas nécessaires ») : règles dans `docs/TEAM_ROLES.md` § Économie de tokens — pas de message sans action attendue, pas d’accusé de réception, un lot par message, un compte rendu de 5 lignes au Chief seulement, petites corrections faites par le Chief, revues groupées avant release. | toutes |
| 20/11 | **Historique des sessions d'équipe** demandé (« design moi une page historique de session d'équipe avec un filtre de type de sessions (flex/scrim/tournois)… filtre par game… notes et reviews… propose ensuite des choses à ajouter ») : page « Sessions d'équipe » (liste) + page d'une session terminée, spec `DESIGN_STATE.md` § 15, maquette Penpot faite, **« Validée »** par l'utilisateur. Les 7 propositions d'ajouts du § 15.3 restent à choisir. | design, front, back |
| 20/11 | Champion Pool : **« New » sous « Flex »** (« dans champ pool, la section "new" devrait etre en dessous de flex ») — reçu par Graphic Design, transmis au Chief. | front, design, back |
| 20/11 | Moteur : **bilan coût/gain de chaque roam pour tous les laners**, pas seulement le mid. **Support** : jugé sur ce que paie son ADC (farm, PV et mana, gold et XP contre l'ADC adverse) et sur le timer de départ (wave crash, après un recall, après 1-2 kills sur la botlane adverse). **Quêtes de rôle** comptées dans l'impact (écart avec le vis-à-vis direct). **Jungler** : « bilan de gank » (camps perdus, écart de gold et d'XP avec le jungler ennemi avant et après, compensation, avantage créé). Rapports dans `docs/engine-reports/2026-11-20-*`, en attente d'implémentation. | engine, back, front |
| 20/11 | **Tout le monde doit être au courant de ce que je demande** : chaque demande va dans ce registre et chaque session le relit. | toutes |
| 20/11 | Cartes du Lobby : **n'afficher que des champions et skins détourés**, jamais l'art d'origine. Si le skin n'a pas de détouré, le premier skin détouré du champion, sinon un halo neutre. | front, design |
| 20/11 | **Lobby d'équipe en premier** dans la section « Équipe & staff », **avant Management** (barre latérale, maquettes, specs, captures). | front, design |
| 20/11 | Champion Pool : section **« New » sous « Flex »** (ordre main, comfort, flex, new, learning), partout où les tiers s'affichent. | front, design, back |
| 20/11 | Choix du champion et du skin de sa carte : icônes du dos cliquables sur **sa** carte seulement, zoom au survol, pop-up des skins du champion cliqué (spec `DESIGN_STATE.md` § 14, « Validée »). | front, design, back |
| 20/11 | **Saison en cours seulement** : aucune donnée 2025 (15.x) dans le moteur ; règles d'avant 2026 gardées seulement sans timer précis ; préparer 2027 à l'avance, basculer seulement une fois vérifiée. | engine, back, front |
| 20/11 | Les 73 parties 2025 du cache local : **« Oui, supprimer »** (fait). | back |
| 20/11 | Le Chief est la session `local_c8abf60b…` ; ne plus relayer les messages « session X attend ». | toutes |
| 19/11 | **Coût d'hébergement : plafond de 2 €** au-delà des offres gratuites, prévenir avant tout coût. | back |
| 19/11 | Équipe construite depuis les joueurs du groupe, compte Riot obligatoire pour rejoindre ; jargon LoL en anglais dans les textes français. | toutes |
| 19/11 | Changements visuels maquettés dans Penpot avant d'être codés. | design, front |
