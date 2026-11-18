# Rapport — fonctionnalités d'Ascend : ce qui existe, ce qui reste, ce qui pourrait venir

_18/11/2026, version 1.0.0-beta.1 plus le travail non encore publié (micro-revue V5 à V10, impact en fight du support,
retrait du protocole basse énergie, refonte visuelle en cours dans une autre session). Sources : le code, `docs/ROADMAP.md`,
`docs/PLAN_GESTION_EQUIPE.md`, `docs/MOTEUR_REGLES.md`, `docs/PLAN_MICRO_REVIEW.md`._

Légende : ✅ disponible · 🟡 disponible avec un reste à faire · ⏳ à faire · 💡 idée.

---

## 1. Ce qui est disponible

### 1.1 Joueur — application de bureau (Windows 10 et 11)

| Domaine | Fonctionnalités | État |
|---|---|---|
| Démarrage | accès sur invitation (code à usage unique, 14 jours, ou code d'équipe), connexion par code e-mail, liaison du compte Riot (puuid), plusieurs comptes, bilan initial des 38 fondamentaux en 7 familles, français et anglais | ✅ |
| Session de jeu | 1 à 3 objectifs (fondamentaux), KPI suivis, modèles de session, objectifs assignés par le coach en un clic, « reprendre la dernière session », clôture automatique après 45 min sans partie avec conclusion pré-remplie | ✅ |
| Enregistrement | détection des parties, enregistrement automatique (encodeur matériel), qualité, images par seconde et dossier réglables, bibliothèque, lecteur avec marqueurs (événements, erreurs, signets), clips, partage YouTube et Discord, signet automatique 15 s avant chaque erreur grave | ✅ |
| Review | formulaire de review (scores des KPI, objectif respecté pré-rempli par la vérification automatique, notes horodatées pré-remplies), fil de commentaires avec le coach, review d'une VOD externe, débrief vocal transcrit sur le PC | ✅ |
| Micro-revue 45 s | jusqu'à 3 moments critiques par partie, extrait VOD de 15 s calé 12 s avant (ou carte schématique sans VOD), QCM de diagnostic avec sortie « justifié » et « Autre cause… », fiche Codex et « Préparer ma prochaine session », 30 XP ; 41 schémas reconnus, 75 fiches | ✅ |
| Labo d'erreurs | 26 erreurs dont 15 auto-détectées, 4 familles, classement par fréquence, coût en winrate, matrice début / milieu / fin, tendance, derniers moments avec « Revoir » et « Travailler cette erreur », prescription Codex | ✅ |
| Statistiques | onglet Analyse (pool, victoires contre défaites, winrate selon la durée et l'heure, tilt après défaite), progression par fondamental, stats détaillées de chaque partie, historique, badges, comparateur de phase de lane noté de S à F | ✅ |
| Tableau de bord | forme sur 10 parties, session active, Calibration flash toutes les 15 parties, radar « Empreinte des fondamentaux » par rôle (laner ou support), erreurs récurrentes, dernière partie, bilan hebdomadaire de l'assistant | ✅ (carte « Progression » retirée dans la session design en cours) |
| Assistant | 3 points après chaque partie, brief de session, bilan hebdo, 32 règles, Focus, 👍/👎 qui réordonne les conseils, « ce qui compte pour toi » (régression locale) | 🟡 à valider sur de vraies parties |
| Mon plan | focus et expérience en cours (5 parties, verdict acquis / en progrès / sans effet), priorités avec « Pourquoi ? », historique des verdicts, fondamentaux diplômés, bandeau de réévaluation | ✅ |
| Profil | carte de joueur, 8 paliers d'entraînement (Recrue → Légende), 13 icônes, 24 titres, XP (review 50, micro-revue 30, bilan 100) | 🟡 stocké sur le PC seulement |
| Apparence | 8 thèmes, thème personnalisé, fonds d'écran (dont image perso locale), opacité des cadres | ✅ |

### 1.2 Équipe et staff

| Domaine | Fonctionnalités | État |
|---|---|---|
| Groupes | équipe ou groupe de coaching, rôles (propriétaire, manager, coach, analyste, joueur, capitaine), codes d'invitation, partage choisi par le joueur groupe par groupe (reviews, stats, données d'équipe, bien-être) | ✅ |
| Page Équipe | tableau de bord, roster, drafts, pool de champions avec détection de tier et de menaces, scouting des adversaires, scrims, statistiques d'équipe et parties personnalisées, tournoi | 🟡 édition partagée en direct à finir |
| Page Coaching | vue d'ensemble staff, joueurs (sessions, reviews, commentaires, objectifs assignés, réponses de micro-revue à valider ou corriger, plans de développement), espace d'équipe (annonces, tâches, notes privées), planning façon agenda (disponibilités, créneaux communs, export et abonnement .ics), review de VOD collaborative, bien-être (check-in énergie, humeur, sommeil, alerte, corrélation), rapports hebdo joueur et équipe, essais de recrutement | 🟡 restes listés en 2.4 |
| Codex d'équipe | règles écrites par le coach, prioritaires sur les fiches intégrées pour tous les membres | ✅ (formulaire enrichi dans la session design en cours) |
| Sessions d'équipe | cycle de vie, synchro rapide, objectifs, stats par partie et duels, enregistrement et transcription, review de fin de session, réunions | 🟡 jamais testé avec de vrais comptes |
| Notifications | cloche in-app : commentaire du staff, objectif assigné, scrim créé ou modifié, rappels J-1 et H-1, joueur inactif 5 jours ; préférences et heures calmes | 🟡 pas de push web, d'e-mail ni de Discord |
| Bot Discord | code prêt et testé | ⏳ l'application Discord est à créer sur ton compte |

### 1.3 Application web (tous appareils, installable)

Connexion, accueil (retours du coach non lus, objectifs assignés, prochains scrims), mes reviews (lecture et réponse au
coach), scrims (planification, disponibilités, checklist, drafts liées, analyse après le scrim), écrans de Coaching
partagés avec le desktop, page Équipe en lecture et écriture, invitations pour les admins, ouverture directe depuis le
desktop sans retaper de code. Pas d'enregistrement ni de détection de partie (réservé au PC). État : 🟡 en ligne,
écrans connectés à tester.

### 1.4 Compte, données, sécurité

Session chiffrée par le trousseau Windows, sauvegarde automatique quotidienne dans le cloud (10 gardées) et en fichier,
synchronisation entre plusieurs PC, suppression du compte et export des données, proxy Riot sur un Worker Cloudflare (la
clé n'est plus dans l'application), CSP et sandbox, signalements de bugs envoyés depuis l'app. État : 🟡 la synchro à deux
PC reste à éprouver en conditions réelles.

### 1.5 Site vitrine

Site FR et EN avec aperçus interactifs (micro-revue, tableau de bord, Labo d'erreurs, radar, paliers, thèmes), pages
légales, section « Données Riot », téléchargement de l'installeur, FAQ (deux questions ajoutées aujourd'hui sur le moteur
et le Labo). État : 🟡 en ligne en aperçu non indexé ; la dernière reconstruction n'est pas déployée.

---

## 2. Ce qui reste à faire

### 2.1 Avant l'ouverture publique

| Tâche | Pourquoi | Qui |
|---|---|---|
| Nom de domaine, puis demande de clé API Riot « Production » | la clé de production exige un site public avec CGU et confidentialité | toi |
| Audit de sécurité (phase S : authentification, RLS, isolation, Edge Functions, en-têtes, XSS, Electron, dépendances) | obligatoire avant la publication complète | à planifier |
| Fermer les inscriptions publiques dans Supabase Auth, SMTP et modèles d'e-mail, test d'un compte invité de bout en bout | l'accès sur invitation doit être étanche | toi, puis test |
| Signature de code de l'installeur, passage de « prerelease » à « release » pour la 1.0 | plus d'alerte SmartScreen, mises à jour vérifiées | à faire |
| Montée d'Electron (la version 33 n'est plus maintenue) | sécurité | à faire |
| Relecture juridique des CGU et de la politique de confidentialité | brouillons | conseillé |

### 2.2 Moteur et micro-revue

| Tâche | Détail |
|---|---|
| Lancer le test de bout en bout de la micro-revue | `tests/e2e/microReview.spec.ts` est à jour mais n'a pas tourné (il demande une compilation complète : `npm run test:e2e`) |
| Corriger la relance manuelle de la détection | le bouton « détecter les erreurs » du lecteur vidéo (`mistake:auto-detect`) n'applique pas le décalage de gravité appris (MX3), le chemin automatique si ; et une erreur auto que tu as supprimée est recréée par ce bouton |
| M15 « mort pendant un objectif » | reporté : il faut une formule fiable du temps de réapparition |
| Schémas jamais déclenchés sur les vraies parties | weak side volée, fuite d'invade, support collé à l'ADC : à revoir avec plus de données ou à retirer |
| Comparer son radar à un joueur suivi | le serveur est prêt (puuid mémorisé), il manque l'interface |
| Repères par rang | impossibles en local : demandent des agrégats anonymes côté serveur |
| Synchroniser les 👍/👎 de l'assistant | la table n'est ni synchronisée ni sauvegardée |

### 2.3 Qualité du code

Validation des ~90 handlers IPC restants, tests des handlers stats / équipe / review / enregistrement, découpage des
fichiers de plus de 1 400 lignes (lecteur vidéo, `team.ipc`, Paramètres, Draft, Session, `recording.ipc`), journal
structuré et rapport de plantage optionnel, 56 avertissements ESLint (aucune erreur).

### 2.4 Équipe, coaching, web

- Édition partagée en direct du roster et des drafts (aujourd'hui : publication ponctuelle), lien automatique équipe ↔ groupe.
- Staff : historique dans le temps (pas seulement l'instantané), scrim terminé → statut « fait » et rattachement des
  parties personnalisées (bloqué par la clé API), rapport post-tournoi.
- Plans de développement : relier les axes aux objectifs assignés et aux expériences, verdict automatique.
- Présence réelle aux créneaux par les parties jouées (bloqué par la clé API), export Google / Apple Calendar en un clic.
- Review de VOD : résumé automatique du scrim (bloqué par la clé API), notification à l'assignation, mentions dans les
  commentaires vidéo.
- Notifications : push web, e-mail récapitulatif, « disponibilité manquante », « rapport prêt », temps réel.
- Essais : promotion d'un candidat vers le roster, comparaison réelle avec le titulaire.
- Web : tableau de bord de progression en lecture, parties personnalisées dans l'analyse post-scrim, bundle plus léger.

### 2.5 Interface

- Passe d'audit page par page restante (Session, Review, Historique, Statistiques, Équipe, Coaching, Planning, Paramètres).
- Refonte graphique : la direction A est appliquée au site ; l'app et le web sont en cours (coins 8 px, titres en
  Big Shoulders Display, page Coaching renommée « Coaching & Management »).
- Profil synchronisé, pour que coéquipiers et coachs le voient.

### 2.6 À décider

- Les garde-fous de l'assistant contre le tilt (pause conseillée après 3 défaites d'affilée et plus de 2 h, série de
  défaites, session longue) sont une fonctionnalité distincte du protocole basse énergie et sont restés en place. Le
  check-in bien-être et sa corrélation aussi.
- Un rappel d'objectif pendant la partie (prévu dans la roadmap) contredirait la promesse du site « aucune information
  pendant la partie » : à trancher avant de le construire.

---

## 3. Idées d'updates et de nouvelles fonctionnalités

Classées par effet attendu sur la progression du joueur, la plus forte d'abord.

| Idée | Ce que ça apporte | Effort | Sur quoi ça s'appuie |
|---|---|---|---|
| Mini-replay animé du moment sans VOD | quand il n'y a pas d'enregistrement, rejouer les 15 s sur la minimap avec les 10 champions (positions interpolées, kills, objectifs) au lieu d'un point fixe | moyen | les positions et événements déjà lus par le détecteur |
| Répondre à la micro-revue depuis le téléphone | les moments et les cartes sont des données : les synchroniser permet de répondre dans le bus, sans le PC | moyen | synchro, app web |
| Notification « ta micro-revue est prête » | le meilleur moment pour répondre est juste après la partie | faible | notifications existantes |
| Raccourcis clavier du QCM (1, 2, 3, 4) | répondre sans souris, en 10 s par moment | faible | carte QCM |
| Clip automatique à chaque erreur grave | une bibliothèque « à ne plus refaire » qui se remplit seule | moyen | signets t − 15 s, découpe de clips |
| Contrôle automatique des timers à chaque patch | les apparitions du Dragon et des Larves sont vérifiées sur les parties en cache (15.20 à 16.22) ; un test qui alerte si un patch les change | faible | parties en cache |
| Temps de réapparition fiable | débloquerait M15 et « mort pendant un objectif » | moyen (recherche) | une source officielle par patch |
| Connaissances par champion | pics de puissance, niveaux clés, objets clés par champion, au-delà des classes actuelles (distance ou mêlée, mage de contrôle) | élevé (contenu) | Codex, détecteurs de lane |
| Carnet de matchups | une note par duel (niveaux clés, plan de lane, ce qui m'a tué), proposée avant la partie | moyen à élevé | à valider avec les règles Riot pour l'affichage en sélection des champions |
| Seuils réglables par le coach | le Codex d'équipe existe déjà ; laisser le coach ajuster aussi certains seuils (par exemple l'or en poche) pour son équipe | moyen | `DETECTOR_SPEC`, règles d'équipe |
| Comparer son Labo à celui de l'équipe | « tes morts isolées : 2 fois la moyenne de l'équipe », avec consentement | moyen | partage par groupe |
| Export CSV / JSON des reviews et des stats | pour les staffs qui ont déjà leurs outils | faible | données locales |
| Bilan hebdo partageable par lien | un lien public lisible sans compte | faible | rapports E9 |
| Repères anonymes par rôle et par rang | « ton CS à 15:00 contre les supports de ton niveau », sans IA, calculé côté serveur | élevé | agrégats opt-in |
| Reformulation des conseils par un modèle local (option) | des conseils moins répétitifs, sans jamais décider à la place des règles | moyen | moteur de règles inchangé |
| Bibliothèque de référence | clips et signets classés par fondamental, « exemple à suivre » / « à ne plus faire », proposés avant une session | faible | clips, reviews externes |
| Revue croisée entre joueurs d'un groupe | apprendre en diagnostiquant les parties des autres avec les mêmes grilles | faible à moyen | reviews externes, groupes |
