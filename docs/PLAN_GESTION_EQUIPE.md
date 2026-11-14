# Plan — gestion & management d'équipe (staff ↔ joueurs)

> Objectif : faire de Ascend **l'outil de travail quotidien d'une équipe** (joueurs, coach, analyste, manager), avec le **site web comme poste de travail du staff** et l'app desktop comme poste de travail du joueur.
> État de départ (13/11/2026) : groupes + rôles + partage (W3), commentaires de review et objectifs assignés (W3), scrims + disponibilités (W4), page Équipe **locale** (roster, pools, drafts, scouting, synergies, customs) — visible par les autres uniquement en lecture via la synchro.

---

## 1. Le problème aujourd'hui

1. **Les données d'équipe vivent sur le PC d'une seule personne** (celui qui a créé l'équipe localement). Les autres ne peuvent ni modifier un pool, ni une draft, ni le roster.
2. **Le site web ne sert au staff qu'à lire** : pas de vue d'ensemble de l'équipe, pas de planning, pas de suivi des joueurs dans le temps, pas de tâches.
3. **Pas de circuit de travail** : un coach commente une review, mais rien ne suit (le joueur a-t-il lu ? corrigé ? l'erreur revient-elle ?).
4. **Pas de notifications** (W5) : tout repose sur le fait d'ouvrir l'app.

## 2. Principes

- **Une équipe = un espace de travail partagé côté serveur** (Supabase), éditable selon le rôle. Le local reste la source pour les données *personnelles* du joueur (games, reviews, VOD).
- **Le web est la tour de contrôle du staff**, le desktop l'atelier du joueur ; tout ce qui concerne l'équipe existe sur les deux.
- **Rien sans consentement** : le partage par joueur (W3) s'applique à toutes les nouvelles vues.
- **Règles métier partout** (voir `AUDIT_REGLES_METIER.md` §3.5–3.6) pour que le staff passe son temps à coacher, pas à collecter.

## 3. Rôles et permissions (extension de W3)

| Action | Owner / manager | Coach | Analyste | Joueur |
|---|---|---|---|---|
| Gérer membres, rôles, invitations | ✅ | invite joueurs/analystes | — | — |
| Planning (scrims, tournois, reviews d'équipe, 1:1) | ✅ | ✅ | ✅ | lecture + dispo |
| Roster, rôles en jeu, statut (titulaire, remplaçant, essai) | ✅ | ✅ | lecture | lecture |
| Pools de champions | ✅ | ✅ | ✅ | **son propre pool** |
| Drafts / game plans / scouting | ✅ | ✅ | ✅ | lecture + commentaires |
| Données perso des joueurs (reviews, stats, erreurs) | selon partage | selon partage | selon partage | les siennes |
| Plans de développement, objectifs | ✅ | ✅ | proposer | lecture + avancement |
| Notes privées staff | ✅ | ✅ | ✅ | — |

Nouveau rôle proposé : **manager** (logistique, planning, sans accès aux notes de coaching privées).

## 4. Features, par lots

### E1 — Espace d'équipe partagé (fondation) 🟡 (v1 livré : publication + lecture ; édition partagée restante)
- ✅ Tables serveur `team_rosters`, `team_pool_entries`, `team_drafts`, `team_scouting` liées au **groupe** (W3), RLS par rôle (staff = tout ; joueur = lecture + **son propre pool**, via `team_rosters.user_id`).
- ✅ Desktop : bouton « Publier vers un groupe… » sur la page Équipe — prend un instantané de l'équipe locale (roster, pools, drafts du joueur actif, équipes adverses scoutées) et remplace ce qui était déjà publié pour ce groupe (« dernier qui écrit gagne », pas d'édition concurrente pour l'instant — historique des modifications non fait).
- ✅ Web **et** desktop : nouvel « Espace d'équipe » sur la page Coaching (visible du staff), lecture du roster/pools/drafts/scouting publiés.
- ⏳ Restant : édition partagée directement depuis le web (aujourd'hui lecture seule), lien automatique équipe↔groupe (aujourd'hui : publication ponctuelle, à refaire après chaque changement), verrou doux sur une draft en cours d'édition, réutilisation des onglets desktop complets (`ChampPoolTab`, `DraftTab`, `ScoutingTab`) côté web plutôt qu'une vue condensée.

### E2 — Tableau de bord staff (web d'abord) 🟡 (v1 livré, voir ce qui reste ci-dessous)
- ✅ Une ligne par joueur, agrégée côté client depuis `sync_records` (même RLS par consentement que le reste) : forme récente (winrate sur les 10 dernières), volume de jeu de la semaine, reviews faites/en retard, erreur dominante (Mistake Library, 10 dernières games), objectif en cours et son verdict (lit directement `CoachingExperiment`, le moteur de coaching — nouvelle règle d'accès ajoutée à `private.can_read_player_table`).
- ✅ Alertes : **C1** joueur inactif (≥ 5 j), **review en retard** (> 3 games non reviewées), **objectif en échec** — simplifié : verdict `no_effect` sur la dernière expérience, pas encore « 2 fois sur le même objectif » (**C2** complet).
- ✅ *(ajouté le 14/11/2026, après la v1)* humeur (moyenne des 3 derniers check-ins E6, uniquement pour les joueurs ayant partagé), comparaison vs moyenne d'équipe (écart du winrate du joueur par rapport à la moyenne du groupe sur les joueurs ayant un winrate), et perf index de l'assistant — moyenne du dernier auto-diagnostic (`Assessment`/`AssessmentScore`, 1-10 par fondamental) mise à l'échelle ~0-100 ; null si le joueur n'en a jamais fait.
- ⏳ Restant : historique perso (tendance dans le temps, pas juste l'instantané courant), **C3–C6** (review en attente, disponibilités, scrim terminé, rapport pré-scrim).

### E3 — Plans de développement individuels 🟡 (v1 livré : plan + avancement + 1:1 ; verdicts auto restants)
- ✅ Tables serveur `dev_plans`, `dev_plan_axes`, `dev_plan_checkins`, `dev_plan_progress`, RLS par groupe (staff écrit le plan/axes/1:1 ; **le joueur écrit uniquement sa propre ligne de progression**, via une table séparée pour éviter un garde colonne par colonne).
- ✅ Web **et** desktop : le staff crée un plan par joueur (titre + 2-3 axes liés à un fondamental, texte d'objectif libre) depuis la fiche joueur (page Coaching) ; le joueur voit son plan et coche « je considère ceci comme fait » + une note visible du coach ; historique des 1:1 (note staff horodatée) partagé en lecture.
- ✅ *(ajouté le 14/11/2026, après la v1)* jalons/périodes exposés en UI — le staff fixe `period_start`/`period_end` à la création du plan, affichés dans l'en-tête du plan pour le staff et le joueur.
- ⏳ Restant : lier les axes aux objectifs assignés (W3) et aux expériences de coaching (B1) plutôt qu'un texte libre, verdict automatique (ex. progression mesurée sur les KPI liés), rappel/notification à l'approche de la fin de période.

### E4 — Planning & présence 🟡 (v1 livré : calendrier + dispo récurrente + créneaux communs + export .ics ; présence réelle restante)
- ✅ Tables serveur `calendar_events` (tournoi, review d'équipe, 1:1, soloQ block, repos, autre — les scrims gardent leur propre workflow W4, non dupliqué ici), `availability_rules` (créneaux hebdo récurrents) et `availability_exceptions` (jour précis indisponible), RLS par groupe (staff gère les événements ; chaque joueur gère sa propre disponibilité, le staff peut aussi la gérer pour un joueur pas encore inscrit).
- ✅ Web **et** desktop : vue semaine sur la page Coaching (tous les membres), formulaire d'ajout d'événement (staff), éditeur de disponibilité récurrente + exceptions (chaque membre, pour soi), détection des créneaux où tous les titulaires liés à un compte sont dispo (staff), export `.ics` ponctuel (tous les événements des 60 prochains jours).
- ✅ *(ajouté le 14/11/2026, après la v1)* scrims (W4) fusionnés dans la même vue calendrier (lecture seule, via `scrimsCore.ts` ajouté pour E5) et dans l'export `.ics`.
- ⏳ Restant : présence réelle par rattachement automatique des customs jouées au créneau (T5 — mis de côté pour une future clé API), abonnement iCal **live** (URL stable signée côté Edge Function, le v1 n'offre qu'un téléchargement ponctuel), export Google/Apple Calendar en un clic (webhook/handshake), vue mensuelle.

### E5 — Review collaborative de VOD 🟡 (v1 livré : session + commentaires + actions + assignations ; résumé auto restant)
- ✅ Tables serveur `vod_review_sessions` (liée à un groupe et, optionnellement, à un scrim W4), `vod_review_comments` (horodatés, avec tag d'erreur d'équipe rotation/setup objectif/communication/autre), `vod_review_action_items` (à cocher), `vod_review_assignments` (joueur + créneau à revoir + statut), RLS par groupe (staff gère les sessions et assignations ; tout membre commente/coche une action ; chaque joueur marque sa propre assignation comme faite).
- ✅ Web **et** desktop : nouvelle section « Review VOD » sur la page Coaching — le staff crée une session (titre + lien VOD), tout le monde ajoute des commentaires horodatés avec tag d'équipe, actions à retenir cochables, le staff assigne un créneau à un joueur qui voit son « à faire » et le marque fait depuis son app.
- ✅ *(ajouté le 14/11/2026, après la v1)* lier une session à un scrim existant depuis l'UI — nouvelle lecture partagée en lecture seule de `scrims` (`scrimsCore.ts`), le desktop n'avait jusqu'ici aucun accès à cette table (gérée seulement côté web) ; affiché comme référence dans la session.
- ✅ *(ajouté le 14/11/2026, après la v1)* lecteur vidéo synchronisé pour les liens YouTube — la CSP autorisait déjà `frame-src` vers YouTube (prévu dès le départ, jamais câblé) ; l'iframe s'affiche automatiquement et cliquer l'horodatage d'un commentaire fait sauter la lecture à ce moment (`postMessage` `seekTo`, même technique que `RecordPlayerPage.tsx`). Les liens non-YouTube gardent le simple lien externe.
- ⏳ Restant : résumé auto du scrim (customs importées + stats par joueur + erreurs auto détectées — dépend de T5, mis de côté pour une future clé API), notification à l'assignation (l'infra existe depuis E8 mais n'est pas câblée ici).

### E6 — Bien-être & charge 🟡 (v1 livré : check-in + consentement + alerte humeur + corrélation joueur ; charge hebdo restante)
- ✅ Table serveur `wellbeing_checkins` (énergie/humeur/sommeil 1-5 + note libre), privée par défaut : nouveau flag de partage **opt-in** `share_wellbeing` (contrairement aux trois autres flags de partage, actifs par défaut) sur `group_sharing`, visible du staff uniquement une fois accepté — vérifié par un test RLS end-to-end (0 ligne visible avant consentement, 1 après).
- ✅ Web **et** desktop : check-in rapide sur la page Coaching (tout le monde), historique perso, corrélation « tes games un jour de basse énergie (≤2) : X % de victoires » calculée à partir de ses propres games (aucun souci de consentement, ce sont ses données) ; côté staff, vue « Bien-être de l'équipe » (uniquement les joueurs ayant partagé) avec alerte si l'humeur baisse strictement sur les 3 derniers jours avec check-in.
- ⏳ Restant : la règle complète « charge de jeu hebdo > X h + humeur en baisse » (demande de croiser avec les stats de jeu sous un **second** consentement, `share_stats` — volontairement non fait dans cette v1 pour ne pas mélanger deux consentements dans une seule alerte), alerte poussée au staff (dépend de E8), réglage du seuil X par le staff.

### E7 — Communication & tâches 🟡 (v1 livré : annonces + tâches + notes privées ; fils par scrim/draft et mentions restants)
- ✅ Tables serveur `announcements` (épinglables), `tasks` (assignable, échéance, statut ouvert/fait), `staff_notes` (jamais lisibles par le joueur concerné — aucune policy de lecture pour lui), RLS par groupe (staff gère annonces/tâches/notes ; un joueur peut aussi basculer le statut de **sa propre** tâche assignée).
- ✅ Web **et** desktop : nouvelle section « Annonces & tâches » sur la page Coaching (tout le monde lit, le staff publie/épingle/assigne) ; carte « Notes privées du staff » ajoutée à la fiche joueur existante (visible uniquement du staff qui consulte ce joueur).
- ✅ *(ajouté le 14/11/2026, après la v1)* mentions `@DisplayName` dans les annonces — correspondance insensible à la casse sur les membres du groupe, notification `mention` envoyée via le même garde `private.notify` (donc respecte les mutes/heures calmes), vérifiée en base (une mention déclenche, une annonce sans mention ne déclenche rien).
- ⏳ Restant : fil de discussion par scrim / par draft (le système de commentaires horodatés par review existe déjà pour les games individuelles ; un fil dédié scrim/draft est un suivi séparé), étendre les mentions aux commentaires VOD (E5) et au texte des tâches si utile en pratique.

### E8 — Notifications (W5 recentré équipe) 🟡 (v1 livré : 3 nouveaux événements + préférences/heures calmes appliquées à TOUS les types ; canaux et dispo manquante restants)
- ✅ Table `notification_prefs` (types coupés + créneau d'heures calmes par utilisateur) et un nouveau garde unique `private.should_notify` / `private.notify`, par lequel passent désormais **tous** les points de création de notification — y compris les 7 types W5 existants (`review_comment`, `objectif assigné`, scrims, rappels, joueur inactif), pas seulement les nouveaux, pour que les préférences soient réellement valables pour tout.
- ✅ 3 nouveaux événements : tâche assignée (E7, déclenché par trigger), objectif échu (nouveau check quotidien), alerte bien-être au staff (E6 — humeur en baisse sur les 3 derniers check-ins partagés, calculée côté serveur, dédupliquée sur 3 jours).
- ✅ Web **et** desktop : nouvelle carte « Préférences de notification » (page Coaching) — couper un type en un clic, définir un créneau d'heures calmes (UTC) ; vérifié par un test RLS/trigger end-to-end (mute bloque bien l'insertion, les événements existants passent toujours par le même garde).
- ⏳ Restant : Web Push, Discord (le webhook actuel est local au joueur, pas un canal d'équipe côté serveur — refonte nécessaire), e-mail digest, notification « dispo manquante » (nécessite de croiser calendrier/disponibilités E4 avec les événements à venir), rapport hebdo (bloqué sur E9, pas construit), Realtime (toujours en polling, choix déjà assumé pour W5).

### E9 — Rapports 🟡 (v1 livré : rapport hebdo joueur + équipe, export texte ; rapport post-tournoi restant)
- ✅ Aucune nouvelle table : un rapport est calculé à la demande côté client depuis les données déjà partagées (`sync_records`, `assigned_objectives`), même principe que le tableau de bord staff (E2). Par semaine (lundi→dimanche, navigable) et par groupe : volume de jeu, winrate, reviews faites/en retard, tendance des erreurs (cette semaine vs la précédente, avec direction ↑/↓/→), objectifs assignés/complétés, verdicts d'expérience de coaching.
- ✅ Web **et** desktop : nouvelle section « Rapport hebdomadaire » sur la page Coaching (staff), agrégat équipe + tableau par joueur, bouton « Copier en texte » (résumé brut à coller dans Discord ou un message — pas de lien live, ça demanderait une Edge Function).
- ✅ *(ajouté le 14/11/2026, après la v1)* rapport post-tournoi — l'agrégation a été généralisée (`computeTeamReportForRange`) pour accepter n'importe quelle fenêtre de dates au lieu d'une semaine fixe ; un tournoi est un `calendar_event` de type `tournament` (E4), sa propre `starts_at`/`ends_at` définit la fenêtre, comparée à la période de même durée juste avant pour les tendances d'erreur. Sélecteur « Hebdomadaire / Post-tournoi » ajouté à la section rapport.
- ⏳ Restant : lien partageable persistant, notification « rapport prêt » (maintenant déclenchable via E8 mais pas câblée — un rapport n'étant pas stocké, il n'y a rien à « finir » à notifier sans d'abord snapshotter le calcul).

### E10 — Recrutement / essais (optionnel) 🟡 (v1 livré : candidats + grille d'évaluation + référence titulaire + décision)
- ✅ Tables `trial_candidates` (nom, rôle, période, statut trialing/kept/rejected) et `trial_evaluations` (critère libre + note 1-5), **volontairement indépendantes de `team_rosters`** : publier l'équipe (E1) supprime et réinsère tout le roster, donc une évaluation liée à un `roster_id` aurait été effacée au prochain « Publier vers un groupe… ». RLS 100% staff (le candidat, pas forcément inscrit, n'a jamais besoin d'y accéder).
- ✅ Web **et** desktop : nouvelle section « Essais » sur la page Coaching (staff) — ajout d'un candidat (nom, rôle, période), grille d'évaluation libre avec note moyenne, rappel du ou des titulaires actuels du rôle (tirés du roster publié) comme référence de comparaison, changement de statut (à l'essai / retenu / refusé).
- ⏳ Restant : promotion automatique vers le roster live (il n'y a pas encore d'édition de roster en direct, voir le reste d'E1), vrai diff de performance contre le titulaire (demanderait les stats partagées du titulaire sous consentement, pas juste son nom/pool).

## 7. État d'ensemble (14/11/2026)

**E1 à E10 sont tous livrés en v1**, chacun avec un périmètre volontairement réduit et les manques documentés dans leur section ci-dessus plutôt que silencieusement laissés de côté. Résumé des plus gros points en suspens, communs à plusieurs lots :
- **T5** (auto-import des customs + rattachement à un créneau) bloque la présence réelle (E4) et le résumé auto de scrim (E5) — mis de côté volontairement (décision du 14/11/2026) jusqu'à une montée en gamme de la clé API Riot (la clé de développement actuelle ne permet pas un import fiable à l'échelle d'une équipe).
- **Canaux de notification externes** (Web Push, Discord serveur, e-mail) — zéro infrastructure, seul l'in-app (polling) existe (E8).
- **Édition de roster en direct** — E1 reste en mode « publier un instantané » ; E10 (promotion) et une partie d'E5/E7 (fils par scrim/draft) en dépendent indirectement.
- Deux actions manuelles toujours en attente côté Supabase Auth (voir `ROADMAP.md`) : désactiver les inscriptions libres, activer la protection mots de passe compromis.

## 8. Prochain chantier — scouting avancé, bot Discord, UX (ajouté 14/11/2026, demandé par l'utilisateur)

**E1 à E10 ne sont pas "terminés" à 100 %** — chaque lot a son ⏳ documenté ci-dessus (édition de roster en direct, canaux de notif externes, fils par scrim/draft, etc., voir aussi §7). Ce qui suit est un nouveau chantier demandé le 14/11/2026, centré sur le scouting/draft (page Équipe locale) et la communication d'équipe. Rien n'est commencé.

### E11 — Bot Discord d'équipe ⏳ planifié
- **But** : porter une partie de la coordination d'équipe (aujourd'hui dans l'app) sur Discord, là où les joueurs sont déjà. S'appuie sur des tables qui existent déjà (`calendar_events`, `availability_rules`/`availability_exceptions` de E4, `scrims`/`scrim_availability` de W4) — le bot est surtout une nouvelle **surface de lecture/écriture + un canal de notification**, pas un nouveau modèle de données.
- **Fonctions demandées** : afficher le calendrier d'équipe ; modifier sa disponibilité (« absent » / « plus de créneaux dispo ») — si absence sur un scrim prévu, chercher un remplaçant ; fusionner les disponibilités communes et notifier quand plusieurs personnes sont libres en même temps (pour caler un scrim ou une session de coaching) ; notifier les événements à venir ; afficher les infos d'un scrim (date/heure, format Bo, liens OP.GG de l'équipe adverse, rôle de chaque joueur : top/jgl/mid/adc/sup).
- **Technique** : nécessite un service bot (Cloudflare Worker avec les Discord Interactions API, ou process Node `discord.js`) + OAuth d'installation sur le serveur Discord de l'équipe. Reprend/refond le canal « Discord » déjà identifié comme manquant en E8/W5 (webhook actuel = local au joueur, pas un canal d'équipe côté serveur). La détection de créneau commun existe déjà côté staff (E4) — à exposer en commande bot plutôt qu'à recoder.

### E12 — Détection de tier & de menaces plus précise (Champion Pool + Scouting) 🟡 v1 livré (14/11/2026)
- **Constat (code d'avant)** : `team:auto-fill-pool` et `team:scout-member` classaient un champion uniquement par seuils de games OU de mastery, sans winrate ni KDA — le scouting réutilisait les mêmes seuils que le pool propre, d'où l'aspect « aléatoire ».
- **Livré** : logique combinée, extraite dans un module partagé pur `src/lib/threatCore.ts` (importé par `team.ipc.ts` **et** `DraftTab.tsx` — une seule règle, pas une par écran) :
  - Menace réelle (`red`/`orange`) = gros volume de games **OU** gros mastery **OU** winrate/KDA élevé **avec un minimum de 20 games** sur ce signal (`MIN_GAMES_FOR_RATE_SIGNAL`) pour éviter qu'un 2-games chanceux fasse illusion.
  - Nouveau niveau **« played »** (a été joué) : champion vu mais sous le seuil de menace — visible, non alarmant (pas de surbrillance).
  - Nouveau niveau **« prioPick »** : champion qui dépasse individuellement le seuil de menace **des deux côtés** (mon équipe ET l'adverse) — `buildPrioPickMap`/`withPrioPicks`.
  - « Flex threat » (jaune) exige maintenant que **2+ membres dépassent chacun individuellement** le seuil — plus de déclenchement juste parce que 2 joueurs ont le champion dans leur pool.
  - Garde-fou role-swap : `buildMemberThreatMap` ne regarde que les entrées du pool dans le rôle **actuel** du membre — une mastery figée sur un ancien rôle ne compte plus.
  - KDA ajouté au modèle (`ChampionPoolEntry.kda`, migration `20261114000000_add_champion_pool_kda`) — calculé gratuitement depuis les kills/deaths/assists déjà récupérés pendant scout/auto-fill, aucun appel Riot supplémentaire.
  - Tiering du pool propre (`main`/`comfort`/`flex`/`learning`) passé sur le même signal combiné (`computeAutoTier`) ; `learning` est enfin auto-assigné aux entrées mastery-only faibles au lieu de retomber sur `flex` par défaut.
  - UI : les couleurs de menace ont été retirées de la barre latérale « pool de champions » du Draft Sim (ne restent que les couleurs de tier) — elles n'apparaissent plus que dans la grille centrale de draft, suite au retour sur la capture d'écran.
  - Tests : `tests/unit/threatCore.test.ts` (21 cas — seuils red/orange/played, garde-fou role-swap, gate par-personne du flex, prioPick, tiering).
- **⏳ restant** : *(mis à jour par E14)* le KDA est maintenant propagé au web (`team_pool_entries.kda`, migration `e14_team_scouting_rosters`) — seul le tuning fin des seuils (65% WR, 4.0 KDA, 300k mastery) reste à ajuster sur retour terrain plutôt que théorique.

### E13 — Réagencement de la page Coaching 🟡 v1 livré (14/11/2026)
- **Livré** : `CoachingPage.tsx` passe d'une pile verticale de 13 sections (une empilée par épopée E2–E10) à un layout en onglets, même pattern que la page Équipe (barre d'onglets horizontale) :
  - **Vue d'ensemble** (par défaut) : tableau d'alertes par joueur (`StaffDashboardSection`), objectifs assignés et plans de dev du joueur — ce qu'on vient chercher en ouvrant la page.
  - **Onglets secondaires** : Planning, Review VOD, Bien-être, Annonces & tâches, Rapport hebdo, Essais, Joueurs, Espace d'équipe, Groupes.
  - Un onglet est masqué (pas affiché vide) quand sa section n'a rien à montrer pour le rôle/les groupes actuels de l'utilisateur — reprend exactement les gardes déjà présentes dans chaque section (`staffGroups.length === 0`, etc.), aucun comportement interne aux sections n'a changé.
- **⏳ limite connue** : aucune infrastructure e2e existante ne simule un utilisateur connecté avec des groupes/rôles staff (le backend collab est basé sur Supabase réel, pas mocké) — la bascule d'onglets n'a donc pu être vérifiée que par relecture du code (gardes de visibilité reproduites fidèlement) et par le test de fumée existant (`/coaching renders without crashing`, état "cloud désactivé"), pas par un test automatisé bout-en-bout avec données réelles. À couvrir si une infra de mock collab est construite plus tard.

### E14 — Page Équipe accessible sur le web, lecture **et écriture** 🟡 v1 livré (14/11/2026)
- Portée choisie par l'utilisateur sur 3 options (lecture seule / + pool perso éditable / parité complète lecture+écriture) : **parité complète**.
- **Livré** :
  - Réutilise les vrais composants desktop (`RosterTab`/`ChampPoolTab`/`DraftTab`/`ScoutingTab`, `src/pages/Team/*.tsx`) sur le web, inchangés — seule la source de données change (tables Supabase du groupe au lieu du SQLite local), exactement le point resté ouvert depuis **E1**.
  - Schéma : `team_rosters.scouting_id` relie une ligne de roster à un adversaire scouté (`team_scouting`) au lieu du roster du groupe — avant E14, un adversaire scouté n'avait qu'un nom/des notes, aucun roster. `team_pool_entries.kda` en parité avec la colonne desktop d'E12. **Aucun changement RLS nécessaire** : les policies d'écriture existantes (staff = tout sur le groupe, joueur = son propre pool) sont déjà indexées sur `group_id`/`roster_id`, pas sur le fait qu'une ligne soit un adversaire ou non.
  - `teamCore.ts` : CRUD complet (roster add/update/remove/dedupe, création/suppression d'équipe adverse, pool upsert/remove, draft create/update/duplicate/delete), qui renvoie exactement les mêmes formes `Team`/`TeamMember`/`ChampionPoolEntry`/`DraftPrep` que l'IPC desktop — c'est ce qui permet aux composants partagés de tourner sans modification.
  - La publication desktop (« Publier vers un groupe ») envoie maintenant aussi les rosters + pools des équipes adverses scoutées (avant : seulement nom/tag/notes — les adversaires remontaient vides sur le web).
  - Extraction de `src/lib/teamIdentity.ts` (matching d'identité + normalisation des slots de draft) et ajout de `src/lib/scoutingCore.ts` (agrégation des games) comme logique pure partagée ; `team.ipc.ts` refactoré dessus sans changement de comportement (vérifié par les tests existants).
  - Client Riot web dédié (`web/src/riotWeb.ts`) + scouting/auto-fill web (`web/src/scoutingWeb.ts`) : appellent le proxy Cloudflare existant (`cloudflare/riot-proxy`) directement depuis le navigateur avec le token Supabase de l'utilisateur. Volontairement plus simple que le client desktop (pas de cache persistant, pas de rate-limiter multi-fenêtre) — voir les commentaires de `riotWeb.ts`. CORS ajouté au proxy (OPTIONS + `Access-Control-Allow-Origin`) pour permettre l'appel navigateur, déployé.
  - Nouvelle page Équipe web + entrée de nav, un roster par groupe (groupes de type « team » uniquement).
- **⏳ hors périmètre pour cette passe** (voir discussion ci-dessus) : onglets Stats/Dashboard, import CSV de parties personnalisées, `computeTeamSynergyStats` — toutes des fonctionnalités qui reposent sur l'historique de matches local et dépassent le périmètre choisi (roster/pool/draft/scouting). Tuning du client Riot web (pas de cache, concurrence fixe à 8) à revoir avec **E15**.

### E15 — Performance des actions de fetch Riot 🟡 v1 livré (14/11/2026)
- **Constat réel (pas juste supposé)** : les corps de match sont déjà mis en cache (`MatchCache`, un fetch par match pour toute la durée de vie de l'install) — le vrai coût répété à chaque scout/auto-fill n'était pas le re-fetch des matches mais le **re-listing** de tous les ids de la saison à chaque appel (`getSeasonMatchIds` : jusqu'à ~25 requêtes paginées par membre, solo+flex+clash), même quand rien n'avait changé.
- **Livré** :
  - Nouvelles colonnes `TeamMember.lastScoutedAt`/`seasonMatchIdsJson` : un scout/auto-fill « quick » répété ne redemande à Riot que les games postérieures au dernier scan (`getSeasonMatchIdsIncremental`) et fusionne avec la liste déjà connue (`mergeMatchIdsByRecency`, partagé + testé) — typiquement 1 à 3 requêtes au lieu de ~25. Le scope « Complete » continue de tout relister depuis zéro (c'est son but). Le cache est partagé entre scout-member/auto-fill-pool/**opponent-dashboard** : peu importe lequel a tourné en dernier pour un membre, les autres en profitent.
  - `team:compute-synergy-stats`, `team:compute-combined-stats`, `team:compute-opponent-dashboard` : la résolution de puuid et le listing des ids par membre étaient des boucles séquentielles malgré un travail indépendant par membre — parallélisées (`Promise.all`). `compute-combined-stats` avait en plus sa propre boucle de fetch de match un par un (cache-check puis fetch) qui n'utilisait jamais le fetcher concurrent déjà existant (`getMatchesBulkCached`) — corrigé.
  - Concurrence de fetch des corps de match (10) et rate-limiter **non touchés** — déjà bien réglés d'après les commentaires existants dans le code ; le vrai goulot était le listing d'ids, pas la concurrence de fetch.
- **⏳ non fait, décision justifiée** : étendre la barre de progression par membre (`useBackgroundJobsStore`, déjà présente sur auto-fill/scout-all/scout-one) aux calculs de synergie/stats demanderait un nouveau canal IPC de streaming de progression pour un appel aujourd'hui monolithique — hors périmètre de cette passe ; ces actions devraient de toute façon finir sensiblement plus vite maintenant, ce qui réduit le besoin.

### E16 — Vérification/consolidation des statistiques d'équipe + préparation clé Product Riot ⏳ planifié
- Auditer `StatsFlexTab`/`StatsScrimTab`/`StatsTournoiTab` pour des trous ou incohérences de calcul.
- **Contrainte transverse à tout ce chantier** : coder pour la clé de développement actuelle (quotas/endpoints limités), mais sans fermer la porte à une **clé Product** (plus de requêtes, plus de données par requête — ex. historique de match plus profond, endpoints supplémentaires). Concrètement : centraliser les limites/quotas dans un seul endroit (pas de magic numbers dispersés), pour qu'une montée en gamme de clé soit un changement de config, pas une réécriture (cohérent avec la note déjà présente dans `ROADMAP.md` W1 « Bonus Riot »).

### E17 — Refonte UI/UX de la page Statistiques ⏳ planifié
- Lisibilité et design graphique de la page Statistiques à revoir (capture fournie en référence par l'utilisateur).

### Idée transverse — nourrir le moteur de règles avec du contenu externe 💡 (exploratoire, pas cadrée)
- Idée formulée par l'utilisateur : alimenter occasionnellement le moteur de règles métier (voir [`MOTEUR_REGLES.md`](MOTEUR_REGLES.md)) avec des informations trouvées à droite à gauche (transcriptions de vidéos YouTube, analyses de pro games sur les réseaux…), pour qu'il se comporte davantage comme un assistant qui apprend de contenu externe — et à terme, un bot plus proche de l'IA.
- Tension à trancler avant de cadrer : tout le moteur actuel (Phase A de `ROADMAP.md`) est **déterministe et 100 % local**, décision explicite pour ne pas payer d'IA (A5). Extraire des faits utiles d'une transcription ou d'un tweet non structuré est un problème de compréhension de texte libre — difficilement faisable en règles pures. Deux voies possibles, à décider plus tard : (a) un LLM **local** (Ollama, déjà noté comme piste 💡 en A4) uniquement pour transformer le texte libre en faits structurés, jamais pour décider ; ou (b) rester 100 % règles et faire saisir les faits par le staff via un formulaire structuré (pas de texte libre). Volontairement laissé en idée (pas en épic chiffré) tant que ce choix n'est pas fait.

## 5. Ordre recommandé

```
E1 (fondation partagée) → E2 (tableau de bord staff) → E8 (notifications)
   → E3 (plans de dev) → E5 (review collaborative) → E4 (planning/présence)
   → E7 (comm & tâches) → E6 (bien-être) → E9 (rapports) → E10

Chantier §8 (14/11/2026) :
E12 ✅ (tiers/menaces précis) → E14 ✅ (portage web, parité complète) ↘
                                                                        E13 ✅ (UX Coaching)
E15 ✅ (perf fetch) + E16 (stats + prépa clé Product) → E17 (UX Stats)
E11 (bot Discord) — indépendant, peut démarrer en parallèle (s'appuie sur E4/W4 déjà livrés)
```
E1 conditionne tout ; E2 + E8 rendent le web immédiatement utile au staff. Pour le chantier §8 : E12, E13, E14 et E15 sont livrés (14/11/2026) ; restent E11, E16, E17.

## 6. Impacts techniques

- **Supabase** : ~12 nouvelles tables (rosters, pools, drafts, scouting, plans, milestones, events calendrier, availability_rules, review_sessions, review_annotations, tasks, announcements, wellbeing_checkins, notifications, notification_prefs), toutes en RLS par groupe/rôle comme W3 ; Realtime pour les fils et notifications.
- **Edge Functions** : envoi Web Push / Discord / e-mail digest (cron), import auto des customs (T5) via le proxy Riot.
- **Offre gratuite** : reste dans les quotas pour quelques équipes ; à surveiller : Realtime (200 connexions) et e-mails (SMTP obligatoire).
- **Code partagé** : continuer le modèle `src/lib/*Core.ts` (logique) + composants partagés desktop/web.
