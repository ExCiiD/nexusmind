-- Rollback of 20261120140000_member_card_champion (Team Lobby card champion and skin). Run it as one transaction.
-- What the members picked is lost: their cards go back to their default champion. Nothing else changes.

revoke update (card_champion, card_skin_num) on public.group_members from authenticated;
alter table public.group_members drop constraint if exists group_members_card_champion_check;
alter table public.group_members drop column if exists card_skin_num;
alter table public.group_members drop column if exists card_champion;
