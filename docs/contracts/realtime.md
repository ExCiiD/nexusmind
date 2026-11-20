# Contrat — Realtime à la place du polling (lot 1 de scalabilité)

Back-end, 20/11/2026. Validé par l'utilisateur (« lance-le »).

## Fichiers

- calculs partagés : `src/lib/realtimeCore.ts` (canaux, reconnexion, repli) ;
- desktop : `electron/main/cloud/realtime.ts` (le hub vit dans le process principal), avec IPC `cloud:realtime`,
  `cloud:realtime-status` et le preload ;
- web : `web/src/realtimeWeb.ts`. Le Front ajoute `...realtimeWebApi` à `web/src/api.ts` ;
- hook pour les écrans : `src/hooks/useRealtimeRefresh.ts` ;
- migration : `supabase/migrations/20261120130207_realtime_publication.sql`, avec son retour arrière et le test
  `scripts/test-realtime-publication.mjs` (16 contrôles). **Elle n'est pas appliquée.**

## API (desktop et web, mêmes noms)

```ts
onCloudRealtime?(cb: (e: RealtimeEvent) => void): () => void
onCloudRealtimeStatus?(cb: (s: RealtimeStatus) => void): () => void
cloudRealtimeStatus?(): Promise<RealtimeStatus>          // 'stopped' | 'connecting' | 'live' | 'fallback'

interface RealtimeEvent {
  topic: 'notifications' | 'team_sessions' | 'calendar' | 'announcements' | 'team_session_reviews'
  table: string                 // '' pour un POLL
  event: 'INSERT' | 'UPDATE' | 'POLL'
  groupId: string | null        // le groupe de la ligne quand la table en a un
  id: string | null             // l'id de la ligne (event_id pour une réponse au calendrier)
}
```

- **L'événement est léger** : il ne contient pas la ligne. L'écran recharge ce qu'il affiche avec les appels qui
  existent déjà, donc une requête par vrai changement au lieu d'une par tour de polling.
- **`POLL`** veut dire « recharge » :
  - toutes les 3 min, tant qu'un canal est tombé ;
  - une fois au retour du canal, pour rattraper ce qui a été manqué.
- **« live » seulement après confirmation** : un canal compte comme live quand le serveur a confirmé l'abonnement aux changements (message `system` `ok`). Une erreur `system` (« Unable to subscribe… », publication vide avant la migration ou après son retour arrière) est traitée comme une panne : polling de secours et nouvel essai avec un délai croissant. Sans confirmation, l'état reste `connecting`, et les écrans gardent leur polling normal.
- **Les suppressions n'arrivent pas** : Supabase ne filtre pas les DELETE, ni par colonne ni par RLS. Une suppression
  se voit au prochain rechargement : `POLL`, retour sur la fenêtre, ou le polling de secours.

## Pour le Front : remplacer `useVisiblePolling`

```ts
useRealtimeRefresh(topics, fn, intervalMs, { enabled?, groupId? }): RealtimeStatus
```

C'est la même signature que `useVisiblePolling`, avec les topics en premier :
- `fn` tourne environ 1 s après un changement de ces topics (une rafale ne donne qu'un appel) ;
- `groupId` limite aux changements de ce groupe ;
- tant que Realtime n'est pas `live`, le polling garde `intervalMs` ;
- quand Realtime est `live`, le polling passe à 15 min : ce n'est plus qu'un filet de sécurité.

| Écran | Aujourd'hui | Remplacer par |
|---|---|---|
| `NotificationBell` | `useVisiblePolling(refreshCount, 120_000)` | `useRealtimeRefresh(['notifications'], refreshCount, 120_000, …)` |
| `AnnouncementBubbleStack` | 10 min | `useRealtimeRefresh(['announcements'], load, 600_000, …)` |
| `TeamSessionBanner` | `REVIEWS_SAFETY_MS` | `useRealtimeRefresh(['team_session_reviews'], refreshReviews, …)` |
| `TeamSessionPage` | `setInterval(load, 15_000)` | `useRealtimeRefresh(['team_sessions', 'team_session_reviews'], load, 15_000, { groupId })` |
| Planning, calendrier | rechargement à l'ouverture | `['calendar']` si l'écran reste ouvert |

Le badge des sessions live (`team-session:live`) ne change pas pour le Front. Sur le desktop, c'est maintenant un
événement `team_sessions` qui le rafraîchit, au lieu d'un polling rapide.

## Web : lectures allégées (WSC-08)

- **Accueil** : `listUpcomingScrims(groupIds, 3)` (`web/src/scrims.ts`) remplace `listScrims(...)` suivi du filtrage
  et du `slice(0, 3)` dans `HomePage.tsx`. Le filtre se fait côté serveur, avec la même fenêtre (à partir de
  3 h avant maintenant).
- **Mes revues** : `getPlayerSessions` ne lit plus que les parties et les revues des 30 dernières sessions, au lieu de
  5 000 lignes.
  - `PlayerSessionView.offSession` est vrai pour le conteneur des parties hors session : badge « Hors session », pas
    d'objectif.
  - Ce conteneur est toujours listé, placé selon sa dernière partie.

## Ce que le serveur garantit

- **Tables publiées** : `notifications`, `team_sessions`, `calendar_events`, `calendar_event_responses`,
  `announcements`, `team_session_reviews`.
- **`sync_records` n'est pas publiée, c'est voulu** :
  - ses lignes contiennent un gros JSON ;
  - chaque envoi reviendrait à l'appareil qui l'a fait ;
  - la synchronisation entre appareils reste un polling, ralenti à 5 min (1 min pendant une session live) quand
    Realtime est `live`.
- **RLS** : chacune de ces tables a la RLS active. Realtime applique les politiques SELECT de l'abonné à chaque INSERT
  et UPDATE : on ne reçoit que ses notifications et les lignes de ses groupes (vérifié sur PGlite, voir le test). Le
  filtre de canal (`group_id=eq.…`, `user_id=eq.…`) réduit seulement ce que le serveur évalue, il n'élargit jamais.
- **Canaux** :
  - un canal par utilisateur : `user:<uid>` ;
  - un canal par groupe : `group:<gid>` ;
  - liste des groupes relue toutes les 15 min, ou après avoir créé, rejoint, quitté ou supprimé un groupe ;
  - les ids sont validés avant d'entrer dans un filtre.
- **Coût** : Realtime gratuit (200 connexions simultanées, 2 M messages par mois). Les tables publiées changent peu.

## Mise en production

1. **Migration**, avec l'accord de l'utilisateur.
   - Contrôle après application : `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`
     donne les 6 tables.
   - Puis deux comptes, chacun dans un groupe différent. Une annonce créée dans le groupe A n'arrive qu'aux membres de
     A, et une notification n'arrive qu'à son destinataire.
   - Retour arrière : `supabase/rollback/20261120130207_rollback.sql`. Les apps repassent d'elles-mêmes au polling.
2. **Desktop** : le client Supabase du process principal reçoit le transport `ws`, parce qu'Electron 33 tourne sur
   Node 20, qui n'a pas de WebSocket. `ws` arrive aujourd'hui avec `@supabase/realtime-js`. Vérifier le build
   (`electron-vite build`) et, au besoin, l'ajouter aux dépendances directes.
3. **Front** : l'adoption de `useRealtimeRefresh` et de `listUpcomingScrims`, et `...realtimeWebApi` dans
   `web/src/api.ts`.

## Mesures (production, 24 h jusqu'au 20/11 vers 12 h UTC, journaux de l'API)

- **Requêtes de polling** :

  | Table | Requêtes en 24 h |
  |---|---|
  | `team_sessions` | 7 382 (GET + HEAD) |
  | `sync_records` | 5 152 |
  | `announcements` et leurs masquages | 5 538 |
  | `notifications` (HEAD) | 2 800 |
  | `team_session_reviews` | 2 640 |

  Environ 23 500 au total, quasi toutes sur des tables de moins de 10 lignes.
- **Gain attendu**, une fois le Front branché : environ −75 %, soit autour de 5 000 par jour. Cela vient de la cloche
  (2 min → 15 min), des sessions d'équipe (15 s → 15 min, hors vrais changements) et de la synchronisation
  (1 min → 5 min).
- **`/auth/v1/user`** : 2 264 appels, venus d'une seule installation desktop (`supabase-js-node`, environ toutes les
  30 s), arrêtés depuis le 20/11 à 01 h UTC. Le correctif L15 (uid de la session locale) est déjà en place dans les
  Core. Il restait 3 appels web : `createScrim` passe à la session locale ; `webIdentity` et `cloudSetPassword` dans
  `web/src/api.ts` sont au Front, mais sont rares.
- **Index** : aucun ajouté.
  - Les requêtes les plus fréquentes (notifications non lues, sessions live, annonces, sync) utilisent déjà un index :
    l'historique compte 43 055 lectures par index sur `notifications`, contre 95 parcours complets.
  - Les tables comptent de 0 à 1 375 lignes, avec des temps moyens de 0,7 à 2,9 ms.
  - À refaire au-delà de quelques milliers de lignes par table.
