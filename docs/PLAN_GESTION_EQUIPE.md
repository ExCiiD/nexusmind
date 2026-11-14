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
- ✅ *(ajouté le 14/11/2026, après la v1)* humeur (moyenne des 3 derniers check-ins E6, uniquement pour les joueurs ayant partagé) et comparaison vs moyenne d'équipe (écart du winrate du joueur par rapport à la moyenne du groupe sur les joueurs ayant un winrate).
- ⏳ Restant : perf index de l'assistant (colonne séparée), historique perso (tendance dans le temps, pas juste l'instantané courant), **C3–C6** (review en attente, disponibilités, scrim terminé, rapport pré-scrim).

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
- ⏳ Restant : résumé auto du scrim (customs importées + stats par joueur + erreurs auto détectées — dépend de T5, mis de côté pour une future clé API), lecteur vidéo synchronisé (aujourd'hui un simple lien externe), notification à l'assignation (l'infra existe depuis E8 mais n'est pas câblée ici).

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
- ⏳ Restant : rapport post-tournoi (nécessite de rattacher des games/scrims à un `calendar_event` de type tournoi, E4), lien partageable persistant, notification « rapport prêt » (maintenant déclenchable via E8 mais pas câblée — un rapport n'étant pas stocké, il n'y a rien à « finir » à notifier sans d'abord snapshotter le calcul).

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

## 5. Ordre recommandé

```
E1 (fondation partagée) → E2 (tableau de bord staff) → E8 (notifications)
   → E3 (plans de dev) → E5 (review collaborative) → E4 (planning/présence)
   → E7 (comm & tâches) → E6 (bien-être) → E9 (rapports) → E10
```
E1 conditionne tout ; E2 + E8 rendent le web immédiatement utile au staff.

## 6. Impacts techniques

- **Supabase** : ~12 nouvelles tables (rosters, pools, drafts, scouting, plans, milestones, events calendrier, availability_rules, review_sessions, review_annotations, tasks, announcements, wellbeing_checkins, notifications, notification_prefs), toutes en RLS par groupe/rôle comme W3 ; Realtime pour les fils et notifications.
- **Edge Functions** : envoi Web Push / Discord / e-mail digest (cron), import auto des customs (T5) via le proxy Riot.
- **Offre gratuite** : reste dans les quotas pour quelques équipes ; à surveiller : Realtime (200 connexions) et e-mails (SMTP obligatoire).
- **Code partagé** : continuer le modèle `src/lib/*Core.ts` (logique) + composants partagés desktop/web.
