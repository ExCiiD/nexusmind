-- Team Lobby cards (20 November 2026): the champion a player shows on their card, picked among their top champions
-- on the back of the card, and one of its skins that has a hosted cut-out (ascend-cutouts manifest). Their
-- teammates see it on desktop and on the web.
--
-- Stored next to the profile look (profile_icon, profile_banner, 20261119034003_member_profile_look) and, like it,
-- copied on each of the member's memberships by the app.
--   - card_champion: the Data Dragon id of the champion (letters and digits, as in "MonkeyKing" or "Kaisa"), the
--     prefix of the cut-out's file name. Never a name, a URL or an image.
--   - card_skin_num: the Data Dragon skin number (0 is the base skin).
--   - both are set together or both are empty (empty: the card shows its default champion).
-- Written by the member themself only: the policy members_update_self_profile (own row, role unchanged) and a column
-- grant, as for the other profile columns. Read by the members of the same group (members_read_same_group).
-- Whether the champion is in the player's top and whether the skin has a cut-out is checked by the app, which reads
-- both lists. The database only keeps the format.
-- Re-runnable: if not exists, drop ... if exists. No semicolon inside a comment.

alter table public.group_members add column if not exists card_champion text;
alter table public.group_members add column if not exists card_skin_num smallint;
alter table public.group_members drop constraint if exists group_members_card_champion_check;
alter table public.group_members add constraint group_members_card_champion_check check (
  (card_champion is null and card_skin_num is null)
  or coalesce(card_champion ~ '^[A-Za-z0-9]{1,40}$' and card_skin_num between 0 and 999, false)
);

grant update (card_champion, card_skin_num) on public.group_members to authenticated;
