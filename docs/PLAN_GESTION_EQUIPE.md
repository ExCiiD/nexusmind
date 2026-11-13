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

### E1 — Espace d'équipe partagé (fondation) ⭐⭐⭐
- Tables serveur `team_rosters`, `team_pool_entries`, `team_drafts`, `team_scouting` liées au **groupe** (W3) au lieu du PC local ; migration « publier mon équipe locale dans le groupe ».
- Édition concurrente simple (dernier qui écrit gagne + historique des modifications), verrou doux sur une draft en cours d'édition.
- Desktop : la page Équipe lit/écrit l'espace partagé quand l'équipe est liée à un groupe ; reste locale sinon.
- Web : mêmes onglets que le desktop (roster, pools, drafts, scouting) — réutilisation des composants comme pour Coaching.

### E2 — Tableau de bord staff (web d'abord) ⭐⭐⭐
- Une ligne par joueur : forme récente (winrate 10 dernières, perf index de l'assistant), volume de jeu de la semaine, reviews faites / à faire, erreurs dominantes (Mistake Library), objectif en cours et son verdict (B1), humeur (E6).
- Alertes du jour (règles C1–C6) : joueur inactif, review en retard, objectif en échec, disponibilités manquantes.
- Comparaison joueur vs moyenne de l'équipe et vs son propre historique.

### E3 — Plans de développement individuels ⭐⭐⭐
- Par joueur : 2-3 axes du trimestre (fondamentaux), objectifs liés (W3 assignés + B1 expériences), jalons, verdicts automatiques, historique des 1:1.
- Le joueur voit son plan dans l'app, marque son avancement ; le coach voit l'effet mesuré.

### E4 — Planning & présence ⭐⭐
- Calendrier d'équipe : scrims (W4), tournois, review d'équipe, 1:1, soloQ block, repos ; vue semaine.
- Disponibilités récurrentes de chaque joueur (créneaux habituels) + exceptions ; détection des créneaux où les 5 titulaires sont dispo.
- Présence réelle : rattachement automatique des customs jouées au créneau (T5) → taux de présence.
- Export iCal (abonnement Google/Apple Calendar).

### E5 — Review collaborative de VOD ⭐⭐⭐
- Session de review d'équipe sur un scrim : la VOD (lien YouTube/clip partagé), commentaires horodatés de chacun, tags d'erreur d'équipe (rotation, setup objectif, comm), actions à retenir.
- Assignation : « Joueur X : revoir 14:30–15:10 » → apparaît dans son app, statut fait/non fait.
- Résumé auto du scrim : customs importées (T5), stats par joueur, erreurs auto détectées.

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
