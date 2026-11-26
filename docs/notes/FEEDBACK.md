# Signalements et demandes des joueurs

Les boutons **« Signaler un bug / proposer »** (sidebar de l'app desktop, sidebar et page Compte du site web) écrivent dans la table Supabase `public.feedback_reports` du projet `Ascend` (`zwubyzrfpelhxjjezvrh`).

- Chaque joueur ne voit que ses propres envois, et leur **statut** + ta **note** (`dev_note`) s'affichent dans sa fenêtre de signalement.
- Limite : 20 envois par joueur et par 24 h.
- Les infos techniques (`diagnostics`) ne sont jointes que si le joueur coche la case ; e-mails, chemins utilisateur, clés et jetons sont masqués avant l'envoi.

## Lire les nouveaux signalements

Dans Supabase → SQL Editor (ou en demandant à Claude, qui a l'accès via le MCP Supabase) :

```sql
select created_at, kind, title, description, expected, source, app_version, route, id
from public.feedback_reports
where status = 'new'
order by kind, created_at;
```

Détail technique d'un bug :

```sql
select diagnostics from public.feedback_reports where id = '<id>';
```

## Répondre / trier

Le joueur voit le statut et la note dans l'app :

```sql
update public.feedback_reports
set status = 'planned',            -- seen | planned | in_progress | done | wont_do | duplicate
    dev_note = 'Prévu pour la beta.62'
where id = '<id>';
```
