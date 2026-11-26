# Mise en production : données d'équipe limitées au groupe lié (26/11/2026) — APPLIQUÉE le 26/11, reste à contrôler l'étape 3

Migration `supabase/migrations/20261126090000_team_data_scoped_to_linked_group.sql`, retour arrière
`supabase/rollback/20261126090000_rollback.sql`. Contexte : S19-17 résiduel, décision « drafts de groupe unique aux
groupes liés ».

**Effet :** une ligne Team, TeamMember, ChampionPoolEntry, DraftPrep ou CustomGame de `sync_records` n'est lisible
par le staff d'un groupe que si l'équipe est liée à CE groupe (`Team.groupId`). Une équipe non liée n'est partagée
avec personne. Les lignes du joueur lui-même ne changent pas (`sync_records_select_own`).

**Vérifié (26/11) :** `node scripts/test-team-data-linked-group.mjs <dossier avec @electric-sql/pglite@0.3.16>` : 16/16
sur PGlite en mémoire (fuite avant, isolement après, lecture des revues inchangée, `share_team` coupé, migration
rejouable, retour arrière appliqué deux fois). La fonction `can_read_player_table` du test est celle de la production,
lue le 26/11.

**Déroulé (sur accord, base de production) :**
1. Sauvegarde : le bouton « Sauvegarder maintenant » n'est pas nécessaire (aucune donnée n'est modifiée, seulement une
   règle de lecture) ; le retour arrière suffit.
2. Appliquer le fichier de migration (MCP Supabase `apply_migration`, nom `team_data_scoped_to_linked_group`).
3. Contrôler : un analyste du groupe A ne voit plus que les équipes liées à A ; le tableau staff et le Scouting
   fonctionnent.
4. Retour arrière si besoin : appliquer `20261126090000_rollback.sql`.

**À savoir :** une équipe locale non liée à un groupe n'est plus visible du staff. Le client doit donc écrire
`groupId` dans `Team` à la liaison (à vérifier côté app avant d'appliquer : non contrôlé ici).
