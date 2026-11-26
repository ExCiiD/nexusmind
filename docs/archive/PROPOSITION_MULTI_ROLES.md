> **ARCHIVÉ le 26/11/2026** : document livré ou remplacé, gardé pour l'historique. Ne pas suivre comme instruction.

# Proposition #39 — Plusieurs rôles par membre d'un groupe

Back-end Dev, 19/11/2026. Analyse seulement, sans code. À valider par le Chief, puis à faire revoir par
CyberSecurity avant toute écriture.

**Demande de l'utilisateur :** un joueur peut aussi être coach, manager ou analyste dans un groupe, un seul de ces
rôles ou plusieurs à la fois.

## 1. État actuel

- `group_members.role` : un seul rôle par membre, parmi `owner`, `coach`, `manager`, `analyst` et `player`. Un
  `is_captain` booléen s'y ajoute : c'est déjà un droit *additionnel*, qui sert de précédent.
- Les droits passent presque tous par quelques fonctions SQL : `private.group_role` (58 appels dans les migrations
  du dépôt), `private.is_group_staff` (84), `can_edit_calendar`, `can_manage_session`, `can_read_player_table`,
  `can_read_wellbeing`, `is_discord_manager`, `can_edit_group_logo` et `hand_over_groups_of`. On trouve aussi
  environ 42 tests `role in (...)` ou `role = ...` écrits en dur, surtout à l'intérieur de ces fonctions.
- Côté application : `src/lib/permissions.ts` (`isLegacyStaff`, `canEditCalendar`, `canManageSession`,
  `canChangeRoles`), `group.myRole` lu à environ 30 endroits dans l'interface, et `role === 'player'` à 11
  endroits (le roster de l'équipe est construit à partir des joueurs, #19/11).
- Le bot Discord passe par `getGroupMemberRole` puis `DISCORD_MANAGER_ROLES`.

## 2. Modèle proposé : un rôle principal et des rôles staff additionnels (recommandé)

| | A. Tableau `roles text[]` à la place de `role` | **B. Garder `role` et ajouter `staff_roles text[]`** |
|---|---|---|
| Schéma | `role` disparaît, chaque test devient « contient » | `role` reste le « siège » (`owner` ou `player`, ou un rôle staff pour un staff qui ne joue pas). `staff_roles` ⊆ {coach, manager, analyst} |
| Owner | à traiter à part, pour éviter « owner + owner » | inchangé : un seul owner, porté par `role` |
| Roster et équipe | « contient player » | inchangé : un joueur, c'est `role = 'player'` |
| Travail SQL | réécrire environ 180 appels et tests | réécrire le *corps* de 6 à 8 fonctions `private.*` ; les politiques qui les appellent ne bougent pas |
| Anciennes versions de l'app | cassées (la colonne `role` change de sens) | compatibles : elles ignorent `staff_roles` (voir § 6) |

**Recommandation : B.** C'est le modèle d'`is_captain`, étendu. Le rôle *effectif* d'un membre vaut `{role} ∪
staff_roles`, et chaque contrôle de droit se fait sur ce rôle effectif, en un seul endroit :

```
private.has_group_role(p_group uuid, p_roles text[], p_user uuid default auth.uid()) returns boolean
  -- vrai si role = any(p_roles) ou si staff_roles && p_roles, pour ce membre de ce groupe
```

Exemple : un joueur qui est aussi coach a `role = 'player'` et `staff_roles = '{coach}'`. Il apparaît dans le
roster comme joueur et il a les droits d'un coach.

## 3. RLS et fonctions `private.is_*`

- `is_group_staff` : son corps devient `has_group_role(p_group, '{owner,coach,analyst}', p_user)`. Les 84 appels
  restent identiques.
- `can_edit_calendar` et `can_manage_session` : `has_group_role(..., '{owner,coach,manager}') or is_captain`.
- `is_discord_manager` : `has_group_role(..., '{owner,coach,manager}')`. Il faut garder la liste égale à
  `DISCORD_MANAGER_ROLES`, le test existant le vérifie. Le bot doit lire le rôle effectif (§ 5).
- `can_read_player_table` et `can_read_wellbeing` (le lecteur doit être staff) : remplacer `viewer.role in (...)`
  par le rôle effectif. **Point à faire trancher par CyberSecurity et l'utilisateur :** un joueur-coach lira alors
  les données partagées de ses coéquipiers, y compris le bien-être quand il est partagé. C'est cohérent avec son
  rôle de coach, mais c'est un camarade de jeu : faut-il l'exclure du bien-être, ou le signaler aux joueurs dans le
  texte de partage ?
- `group_role()` (58 appels) continue de renvoyer le rôle principal. Il faut auditer ses usages un par un : ceux
  qui testent un rôle staff (`= 'coach'`, `in ('owner','coach')`…) passent par `has_group_role`. Ceux qui ne
  testent que `owner`, ou seulement l'appartenance (`is not null`), ne changent pas.
- Les notifications réparties « vers le staff » (e8) sont à aligner sur le rôle effectif. Un joueur-coach recevra
  à la fois les notifications de joueur et celles de staff : il faut éviter les doublons.
- **Écriture :** `staff_roles` n'est jamais modifiable par le membre lui-même, puisque la colonne n'entre pas dans
  le `grant update (...)` de `group_members`. Une nouvelle RPC `set_member_staff_roles(p_group, p_user, p_roles)`,
  réservée à l'owner, valide que `p_roles ⊆ {coach, manager, analyst}` et refuse de toucher l'owner lui-même,
  comme `set_member_role`.

## 4. Passation d'owner (#29)

`private.hand_over_groups_of` classe aujourd'hui sur `role` (coach, manager, analyste, capitaine, puis joueur le
plus ancien). Il faudra classer sur le rôle effectif : un joueur-coach compte comme coach. Proposition d'ordre :
coach (principal ou additionnel), manager, analyste, capitaine, joueur le plus ancien. À égalité, un staff qui ne
joue pas passe avant un joueur-staff, pour garder un responsable hors du roster. C'est un choix à faire valider.
Le test PGlite de #29 serait étendu à ce cas.

## 5. Cores, bot et interface

- `collabCore.listMyGroups` lit `staff_roles` en plus, avec un repli quand la colonne manque (même mécanisme que
  `puuid` en #38). `GroupMember` gagne `staffRoles: GroupRole[]`, et `Group` gagne `myStaffRoles`.
- `src/lib/permissions.ts` : les fonctions prennent le membre (`role`, `staffRoles`, `isCaptain`) au lieu du seul
  `role`, avec un `effectiveRoles(member)` partagé. Les environ 30 lectures de `myRole` dans l'interface passent
  par ces fonctions, ce qui supprime aussi les copies locales de listes de rôles.
- Bot : `getGroupMemberRole` renvoie le rôle effectif (`role` et `staff_roles`), et `isChannelStaffRole` teste
  une intersection.
- Interface (Front-end, maquette d'abord) : dans Management, l'owner coche les rôles staff d'un membre en plus de
  son rôle principal. Badges multiples sur les cartes. Les invitations ne changent pas : un rôle principal, les
  rôles staff s'ajoutent après l'arrivée.
- Équipe et roster : rien à changer, ils restent basés sur `role = 'player'`.

## 6. Migration et compatibilité

1. Migration Supabase (accord de l'utilisateur pour la production) :
   - `alter table group_members add column staff_roles text[] not null default '{}'`, avec un `check` sur les
     valeurs permises et sans doublon ;
   - `has_group_role`, puis la réécriture des corps de fonctions du § 3 et la RPC `set_member_staff_roles`.
   - Aucune donnée à reprendre : tout le monde démarre avec `{}`, donc les droits restent identiques au jour J.
2. Ordre de déploiement : la migration d'abord (sans effet tant que personne n'a de rôle additionnel), puis la
   version de l'app qui sait les afficher et les attribuer.
3. Anciennes versions de l'app : elles ne voient que `role`. Un joueur-coach y apparaît comme simple joueur et n'y
   a pas les écrans staff, mais le serveur lui accorde déjà les droits. Il n'y a pas de faille : c'est
   l'interface qui en montre moins. Rien ne casse.
4. Tests :
   - PGlite : `has_group_role`, chaque fonction `private.*` réécrite (joueur-coach autorisé, joueur simple
     refusé), `set_member_staff_roles` réservée à l'owner, passation d'owner ;
   - unitaires : `effectiveRoles`, les permissions, `planGroupTeamSync` inchangé ;
   - bot : `/set-channel` accepté pour un joueur-manager.

## 7. Estimation et décisions demandées

- **Taille :** moyenne. Côté back : 1 migration (environ 8 fonctions réécrites, 1 RPC), le Core, le bot et les
  tests. Côté front : Management, les permissions et les badges.
- **À décider :**
  1. Modèle B (recommandé) ou A.
  2. Le joueur-coach peut-il lire le bien-être partagé de ses coéquipiers (§ 3) ?
  3. L'ordre de passation d'owner (§ 4).
  4. Un rôle additionnel est-il possible pour un membre dont le rôle principal est déjà staff (un analyste qui est
     aussi manager) ? Je le propose : oui, c'est le même mécanisme.
