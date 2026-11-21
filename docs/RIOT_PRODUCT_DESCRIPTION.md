# Riot production key — product description (21/11/2026)

To paste into the Riot Developer Portal (product registration → description). Product name: **Ascend** (formerly
NexusMind). Website: https://asc3nd.app · Web companion: https://app.asc3nd.app · Privacy: https://asc3nd.app/en/privacy ·
Terms: https://asc3nd.app/en/terms.

---

Ascend is a free Windows desktop application (with a web companion) for League of Legends players and teams who want to
improve through structured post-game review rather than rank or LP alone.

**For players.** The player links their Riot account (Riot ID). Ascend detects the end of each game, records it locally on
the player's PC, and opens a guided review: a short "micro-review" of the two or three key moments of the game (deaths,
lost objectives, late rotations), each answered by the player, who can add their own reasons, extra mistake tags and
notes at the exact time in the replay. Mistakes are collected in a Mistake Lab that shows recurring patterns over time;
the player can correct or dismiss any mistake the app detected, and can choose to rely on their own judgement only.
Sessions let the player set objectives before playing (League fundamentals, written goals, or goals assigned by their
coach) and score them after each game. Statistics show role-specific trends (CS, gold, damage, vision, kill participation,
laning-phase differentials at 15 minutes), a laning phase analysis per game, stat snapshots over time and champion pool
progression. Players can cut clips from their recordings, keep them locally, and optionally share them (Discord, a
temporary link, or their own YouTube channel when they connect it).

**For teams and coaches.** Teams create a group, invite players (each player links their own Riot account), and get
collective statistics computed from games the members played together (flex, scrims, tournaments), team sessions with
shared reviews, a planning calendar with availability, champion pools per player, draft preparation (pick/ban
simulation, champion options by role) and opponent scouting: champion pools, recent picks and role tendencies of an
opposing team estimated from public ranked match history.

**Riot data used.** account-v1 (Riot ID ↔ PUUID, active region), summoner-v4, match-v5 (match list, match details and
timelines), league-v4 (rank, LP) and champion-mastery-v4. We do not display or estimate hidden MMR, do not expose data of
players who are not part of a user's own games, groups or a scouting request, and do not offer any feature that alters
or automates gameplay. The app reads the game's end from the local client only to know when to start the review; it
does not interact with the game while it is running.

**How we call the API.** The API key is never shipped in the app: every request goes through our own server-side proxy
(Cloudflare Worker), which enforces a single global rate-limit budget for all users (with a reserve for post-game
requests), caches finished matches and timelines (immutable data) so the same match is never requested twice across
users and teammates, and fetches match lists incrementally. Typical usage: 3 to 5 calls after each game per user; a full
opponent scout is spread over time within the budget.

**Data and accounts.** Recordings stay on the player's PC. An optional Ascend account syncs the player's own review data
between their devices and shares, with their consent, selected data with their group (coach, team). Users can delete
their data and their account at any time. Ascend is not endorsed by Riot Games and complies with Riot's developer
policies and the Legal Jibber Jabber notice shown on our website and in the app.

**Stage and audience.** Public beta, distributed through GitHub releases and our website, currently a small community of
players and amateur teams; we expect growth through teams adopting it together, which is why we are requesting a
production key and an appropriate rate limit.
