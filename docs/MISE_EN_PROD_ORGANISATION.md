# Mise en production — « Relancer » (§ 18, Back-end)

Back-end, 20/11/2026. Une migration écrite, testée sur PGlite et **non appliquée**, plus un déploiement du bot Discord.
Chaque étape demande l'accord direct de l'utilisateur. On s'arrête à la première erreur et on applique le retour arrière
de l'étape. On part d'un export du commit de la release (`git archive`), comme pour les précédentes.

## 0. Avant de commencer (local, sans accord)

```
node scripts/test-event-response-reminders.mjs <dossier PGlite 0.3.16>
node scripts/test-schema-baseline.mjs          <dossier PGlite 0.3.16>
```

En lecture seule sur la prod : la dernière migration doit être `20261120110540 team_sessions_hardening`.

## 1. Migration `20261120190000_event_response_reminders`

- **Ce qu'elle fait** :
  - ajoute le type de notification `event_response_reminder` à la liste complète ;
  - crée la table `event_response_reminders` (dernière relance par événement et par personne, lue par les gestionnaires
    du calendrier, écrite seulement par la RPC) ;
  - crée la RPC `remind_event_responses(p_event, p_user_ids)`, réservée à authenticated.
- **Contrôles** :
  - `get_advisors` : aucun avertissement « anon peut exécuter » ;
  - `has_function_privilege('anon', 'public.remind_event_responses(uuid,uuid[])', 'execute')` vaut false ;
  - test de fumée dans une transaction annulée : relancer un événement à venir en tant qu'owner, puis lire la
    notification créée.
- **Retour arrière** : `supabase/rollback/20261120190000_rollback.sql`. Il supprime aussi les notifications de relance déjà
  envoyées, sans quoi la liste des types ne pourrait pas revenir à l'ancienne.

## 2. Bot Discord (DM des relances)

`DIRECT_MESSAGE_TYPES` (`src/lib/discordBotCore.ts`) contient maintenant `event_response_reminder`.
- Déployer après l'étape 1 : `cd cloudflare/discord-bot` puis `wrangler deploy`, depuis l'export.
- Contrôle : relancer un membre qui a lié Discord ; le DM « ⏰ Will you be at … » arrive au passage suivant du bot (15 min
  au plus).
- Retour arrière : `wrangler rollback` vers la version précédente. Les relances restent dans l'app.
- Coût : aucun changement.

## 3. Baseline

Comme pour la beta.13 :
- `git mv` du fichier et du retour arrière vers la version de prod ;
- références à jour dans `scripts/` ;
- nouveaux `prod_migrations_*` et `prod_schema_*` (md5 du schéma identique entre la prod et le dépôt reconstruit) ;
- puis `test-schema-baseline`.

## Sans migration

- `opponentDossierListPublished` : dossiers publiés pour le Scouting d'un joueur.
- `lftMySolo` : LFT solo sur desktop.

Les deux lisent des tables existantes et des données locales.
