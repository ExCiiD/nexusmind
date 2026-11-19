-- Player cards (Équipe → Roster): the profile icon and banner a member picked
-- on their Profile page, copied on each of their memberships so the rosters
-- of their teammates show the same card. Ids of the app's own artwork
-- (src/lib/profile.ts), never a URL or an uploaded image.
--
-- Written by the member themself (policy members_update_self_profile: own row,
-- role unchanged), read by the members of the same group
-- (members_read_same_group). Both nullable: a member who never opened the
-- app since this change simply has no look yet.

alter table public.group_members
  add column if not exists profile_icon text
    check (profile_icon is null or profile_icon ~ '^[a-z0-9_-]{1,32}$'),
  add column if not exists profile_banner text
    check (profile_banner is null or profile_banner ~ '^[a-z0-9_-]{1,32}$');
