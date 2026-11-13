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
- ⏳ Restant : perf index de l'assistant (colonne séparée), humeur (E6, pas construit), comparaison joueur vs moyenne d'équipe / historique perso, **C3–C6** (review en attente, disponibilités, scrim terminé, rapport pré-scrim).

### E3 — Plans de développement individuels 🟡 (v1 livré : plan + avancement + 1:1 ; verdicts auto restants)
- ✅ Tables serveur `dev_plans`, `dev_plan_axes`, `dev_plan_checkins`, `dev_plan_progress`, RLS par groupe (staff écrit le plan/axes/1:1 ; **le joueur écrit uniquement sa propre ligne de progression**, via une table séparée pour éviter un garde colonne par colonne).
- ✅ Web **et** desktop : le staff crée un plan par joueur (titre + 2-3 axes liés à un fondamental, texte d'objectif libre) depuis la fiche joueur (page Coaching) ; le joueur voit son plan et coche « je considère ceci comme fait » + une note visible du coach ; historique des 1:1 (note staff horodatée) partagé en lecture.
- ⏳ Restant : lier les axes aux objectifs assignés (W3) et aux expériences de coaching (B1) plutôt qu'un texte libre, jalons/périodes (`period_start`/`period_end` déjà en base, non exposés en UI), verdict automatique (ex. progression mesurée sur les KPI liés), rappel/notification à l'approche de la fin de période.

### E4 — Planning & présence 🟡 (v1 livré : calendrier + dispo récurrente + créneaux communs + export .ics ; présence réelle restante)
- ✅ Tables serveur `calendar_events` (tournoi, review d'équipe, 1:1, soloQ block, repos, autre — les scrims gardent leur propre workflow W4, non dupliqué ici), `availability_rules` (créneaux hebdo récurrents) et `availability_exceptions` (jour précis indisponible), RLS par groupe (staff gère les événements ; chaque joueur gère sa propre disponibilité, le staff peut aussi la gérer pour un joueur pas encore inscrit).
- ✅ Web **et** desktop : vue semaine sur la page Coaching (tous les membres), formulaire d'ajout d'événement (staff), éditeur de disponibilité récurrente + exceptions (chaque membre, pour soi), détection des créneaux où tous les titulaires liés à un compte sont dispo (staff), export `.ics` ponctuel (tous les événements des 60 prochains jours).
- ⏳ Restant : fusionner les scrims (W4) dans cette même vue calendrier, présence réelle par rattachement automatique des customs jouées au créneau (T5 — dépend d'un auto-import des customs pas encore construit), abonnement iCal **live** (URL stable signée côté Edge Function, le v1 n'offre qu'un téléchargement ponctuel), export Google/Apple Calendar en un clic (webhook/handshake), vue mensuelle.

### E5 — Review collaborative de VOD 🟡 (v1 livré : session + commentaires + actions + assignations ; résumé auto restant)
- ✅ Tables serveur `vod_review_sessions` (liée à un groupe et, optionnellement, à un scrim W4), `vod_review_comments` (horodatés, avec tag d'erreur d'équipe rotation/setup objectif/communication/autre), `vod_review_action_items` (à cocher), `vod_review_assignments` (joueur + créneau à revoir + statut), RLS par groupe (staff gère les sessions et assignations ; tout membre commente/coche une action ; chaque joueur marque sa propre assignation comme faite).
- ✅ Web **et** desktop : nouvelle section « Review VOD » sur la page Coaching — le staff crée une session (titre + lien VOD), tout le monde ajoute des commentaires horodatés avec tag d'équipe, actions à retenir cochables, le staff assigne un créneau à un joueur qui voit son « à faire » et le marque fait depuis son app.
- ⏳ Restant : lier explicitement une session à un scrim existant depuis l'UI (le champ `scrim_id` existe en base), résumé auto du scrim (customs importées + stats par joueur + erreurs auto détectées — dépend de T5, pas construit), lecteur vidéo synchronisé (aujourd'hui un simple lien externe), notification à l'assignation (dépend de E8).

### E6 — Bien-être & charge ⭐⭐
- Check-in rapide avant session (énergie, humeur, sommeil, 1-5) — optionnel, visible du staff seulement si le joueur l'accepte.
- Règle : charge de jeu hebdo > X h + humeur en baisse 3 jours → alerte staff (pas au joueur).
- Corrélation affichée au joueur : « tes games avec énergie ≤ 2 : 38 % de victoires ».

### E7 — Communication & tâches ⭐⭐
- Annonces d'équipe (épinglées), fil par scrim / par draft, mentions.
- Tâches (to-do) assignables : « préparer le scouting de X », « revoir la draft 2 » ; échéance ; statut.
- Notes privées du staff par joueur (jamais visibles du joueur).

### E8 — Notifications (W5 recentré équipe) ⭐⭐⭐
- In-app (temps réel), Web Push (PWA), Discord (webhook d'équipe), e-mail digest quotidien.
- Événements : commentaire coach, objectif assigné/échu, scrim créé/modifié, rappel J-1 / H-1, dispo manquante, tâche assignée, alerte bien-être (staff), rapport hebdo prêt.
- Préférences par utilisateur et heures calmes.

### E9 — Rapports ⭐⭐
- Rapport hebdo par joueur et par équipe (auto, partageable Discord / lien) : volume, forme, objectifs, verdicts, erreurs en hausse/baisse.
- Rapport post-tournoi.

### E10 — Recrutement / essais (optionnel) ⭐
- Profils « en essai » avec période et grille d'évaluation, comparaison avec le titulaire du rôle, décision.

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
