# Contrat — Organisation du manager, Scouting d'un joueur, LFT solo (§ 18)

Back-end, 20/11/2026. Écrans du § 18 validés (`DESIGN_STATE.md`, `docs/DECISIONS.md`).

Fichiers :
- types : `src/lib/organisation.ts` ; calculs : `src/lib/organisationCore.ts` (partagés desktop / web) ;
- desktop : IPC `organisation:*` et `lft:my-solo`, preload ;
- web : `web/src/organisationWeb.ts`. Le Front ajoute `...organisationWebApi` à `web/src/api.ts`.

## 1. « Relancer » (§ 18.1, Présence à surveiller)

```ts
calendarRemindResponses(eventId: string, userIds?: string[]): Promise<{
  reminded: string[]                                   // relancés maintenant
  skipped: Array<{ userId: string; nextAt: string }>  // relancés il y a moins de 6 h : quand on pourra relancer
}>
calendarListReminders(eventIds: string[]): Promise<Array<{ eventId: string; userId: string; sentBy: string | null; sentAt: string }>>
```

- **Qui relance** : les gestionnaires du calendrier du groupe (owner, coach, manager, capitaine).
- **Qui est relancé** :
  - les personnes concernées par l'événement (sa portée ou ses invités) qui n'ont pas encore répondu ;
  - jamais l'appelant ;
  - `userIds` restreint la liste (50 personnes au plus) ;
  - seulement pour un événement à venir.
- **Ce qu'ils reçoivent** :
  - une notification dans l'app (type `event_response_reminder`, lien `/planning`, `data` : `eventTitle`, `scheduledAt`,
    `eventKind`, `eventId`, `groupId`) ;
  - un DM Discord par le bot s'ils ont lié Discord (`/link-me`). Il part avec le passage du bot, toutes les 15 minutes au
    plus.
- **Anti-spam** : une relance par événement et par personne toutes les **6 h**. Les personnes relancées trop récemment
  sont dans `skipped`, avec `nextAt`. `calendarListReminders` donne la dernière relance par personne (« relancé il y a
  2 h ») aux gestionnaires ; les autres reçoivent une liste vide.
- **Erreurs** : `FORBIDDEN`, `NOT_FOUND`, `EVENT_PAST`, `NOT_AVAILABLE` (avant la migration).
- **Front** : un libellé pour la notification `event_response_reminder` (FR « Réponds à {eventTitle} », EN « Reply to
  {eventTitle} »).

## 2. Dossiers adverses publiés (§ 18.4, Scouting d'un joueur)

```ts
opponentDossierListPublished(groupId: string): Promise<Array<{
  opponentKey: string; name: string
  tag: string | null                   // celui de l'équipe scoutée, s'il existe
  publishedAt: string
  publishedBy: string | null           // dernier à avoir modifié le dossier (pas de champ « publié par » dédié)
  publishedByName: string | null       // son nom dans le groupe (« par Coach Sora »)
  record: { wins: number; losses: number }   // nos games de session d'équipe contre eux
}>>
```

Les plus récents en haut ; liste légère, sans le contenu. Clic : le dossier en lecture seule avec l'existant
`opponentDossierGet`. Un joueur ne lit déjà que les dossiers publiés (RLS).

## 3. Export LFT solo (§ 18.2, joueur sans groupe) — desktop seulement

```ts
lftMySolo?(opts?: { force?: boolean }): Promise<{ member: SoloLftMember; rank: MemberRankResult } | null>
```

- **`member`** : de même forme qu'un membre de roster (`TeamMember`), donc il passe tel quel à
  `playerView(member, role, ctx)` de `src/components/lft/useLftData.ts`, avec `rank` en `ctx.rank` :
  - `id: 'me'` ;
  - Riot ID et région du compte actif ;
  - rôle principal du profil, sinon le rôle le plus joué ;
  - `champPool` tiré de **ses 100 dernières games enregistrées** : une entrée par champion et rôle, `playRate` = nombre
    de games, `winRate` en %, la plus jouée d'abord.
- **`rank`** : lu chez Riot comme celui d'un membre de roster (cache de 5 min, `force` pour relire), ou `no-riot-id` /
  `error`.
- `null` : aucun compte configuré.
- **Proposition au Front** :
  - le mode `solo` existant de l'export avec ce seul joueur ;
  - « Je cherche une équipe » préremplit `lookingFor` avec le rôle ;
  - le web n'a pas l'export (pas de games locales) : il garde le lien vers l'app.

## Mise en production

Migration `20261120115200_event_response_reminders` (non appliquée) et déploiement du bot (DM). Pas-à-pas :
`docs/archive/MISE_EN_PROD_ORGANISATION.md`. Les points 2 et 3 n'ont besoin d'aucune migration.
