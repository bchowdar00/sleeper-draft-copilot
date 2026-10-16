# Sleeper API — Technical Contract for Sleeper Draft Copilot

Compiled 2026-08-30. Base API host: `https://api.sleeper.app` (documented, `/v1/...`) — note one
undocumented projections host observed as `https://api.sleeper.app/projections/...` (no `/v1`, see §4).
Primary docs: https://docs.sleeper.com/ (redirects from the older https://docs.sleeper.app/).

Confidence key: **[LIVE]** = fetched and verified in this session (2026-08-30). **[DOCS]** = stated on
docs.sleeper.com. **[COMMUNITY]** = corroborated only by third-party wrappers/blogs, not fetched live or
confirmed in official docs — treat as probably-correct but unverified.

---

## 1. Documented read endpoints (docs.sleeper.com)

### 1.1 User
`GET /v1/user/<username_or_user_id>` **[DOCS]**
Fields: `username`, `user_id`, `display_name`, `avatar`.
Note: usernames are mutable; persist `user_id`.

### 1.2 Leagues for a user (season 2026)
`GET /v1/user/<user_id>/leagues/nfl/2026` **[DOCS]**
Returns an array of League objects (see 1.3).

### 1.3 League by id
`GET /v1/league/<league_id>` **[DOCS + COMMUNITY field list from lum8rjack/sleeper-go Go struct tags]**
Top-level fields observed/documented: `league_id`, `name`, `avatar`, `season`, `season_type`, `sport`,
`status`, `total_rosters`, `draft_id`, `previous_league_id`, `settings`, `scoring_settings`,
`roster_positions`, `metadata`, `group_id`, `shard`, plus messaging-related fields
(`last_message_id`, `last_message_time`, `last_author_id`, etc. — irrelevant to draft copilot).

**`scoring_settings` keys** — the official docs show this only as a placeholder
`{ scoring_settings object }` with no exhaustive key list **[gap — see below]**. The most complete
key list found is reverse-engineered in the community Go client (`lum8rjack/sleeper-go`,
pkg.go.dev) **[COMMUNITY]**:
`blk_kick, def_st_ff, def_st_fum_rec, def_st_td, def_td, ff, fgm_0_19, fgm_20_29, fgm_30_39,
fgm_40_49, fgm_50p, fgmiss, fum, fum_lost, fum_rec, fum_rec_td, int, pass_2pt, pass_int, pass_td,
pass_yd, pts_allow_0, pts_allow_1_6, pts_allow_7_13, pts_allow_14_20, pts_allow_21_27,
pts_allow_28_34, pts_allow_35p, rec, rec_2pt, rec_td, rec_yd, rush_2pt, rush_td, rush_yd, sack,
safe, st_ff, st_fum_rec, st_td, xpm, xpmiss`.
Meanings: `rec` = points per reception, `pass_td`/`rush_td`/`rec_td` = TD points by category,
`pass_int` = points (usually negative) per interception thrown, `fum_lost` = points per fumble
lost, `bonus_rec_*` / distance-bonus keys exist per Sleeper's scoring UI (Sleeper support article
"What scoring options are available" **[DOCS-adjacent, support.sleeper.com]** confirms the UI
concepts: per-position reception bonuses "Reception Bonus – RB/WR/TE", yardage-threshold bonuses,
distance-based FG scoring, IDP categories) — but the exact JSON key names for the TE/RB/WR
reception-bonus fields (commonly guessed as `bonus_rec_te`, `bonus_rec_wr`, `bonus_rec_rb`) could
**not be independently confirmed** in any fetched source this session. **Treat these three bonus
keys as unverified inference; read them defensively (`settings[key] ?? 0`) rather than assuming
presence.**

**`roster_positions`** — array of position slot strings, one entry per roster slot, e.g.
`["QB","RB","RB","WR","WR","TE","FLEX","FLEX","K","DEF","BN","BN",...]`. Community-confirmed slot
vocabulary: `QB, RB, WR, TE, FLEX (RB/WR/TE), SUPER_FLEX (QB/RB/WR/TE), WRRB_FLEX, REC_FLEX, K, DEF,
BN (bench), IDP_FLEX, DL, LB, DB` **[COMMUNITY — not exhaustively confirmed live]**.

**`settings`** object (league-level, distinct from draft `settings`) includes at least:
`num_teams`/`total_rosters` equivalents, `playoff_week_start`, `waiver_type`, `waiver_budget`,
`trade_deadline`, `reserve_slots`, `taxi_slots` (dynasty) — full enumeration not returned by docs
fetch; **gap**, would require pulling a real live league (see §6 gap note).

### 1.4 League users
`GET /v1/league/<league_id>/users` **[DOCS]**
Array of `{user_id, display_name, avatar, is_owner, metadata (team_name, avatar overrides), league_id}`.

### 1.5 League rosters
`GET /v1/league/<league_id>/rosters` **[DOCS + lum8rjack field tags, COMMUNITY]**
Array of `{roster_id, owner_id, co_owners, league_id, players, starters, reserve, taxi, keepers,
player_map, settings (wins/losses/ties/fpts...), metadata}`.
**owner_id ↔ roster_id mapping**: join `rosters[].owner_id` to `users[].user_id` to get display
name per roster_id; this is the standard pattern to label draft picks with team names.

### 1.6 League drafts list
`GET /v1/league/<league_id>/drafts` **[DOCS]** — array of Draft objects (1.7), most recent first.

### 1.7 Draft by id
`GET /v1/draft/<draft_id>` **[LIVE-VERIFIED — see §6 for actual JSON]**
Confirmed top-level fields (live): `created, creators, draft_id, draft_order, last_message_id,
last_message_time, last_picked, league_id, metadata{description,name,scoring_type,show_team_names},
season, season_type, settings{alpha_sort,autopause_enabled,autopause_end_time,autopause_start_time,
autostart,cpu_autopick,nomination_timer,pick_timer,player_type,reversal_round,rounds,slots_def,
slots_flex,slots_k,slots_qb,slots_rb,slots_te,slots_wr,teams}, slot_to_roster_id, sport, start_time,
status, type`.
- `type`: `"snake"` confirmed live; `"linear"` and `"auction"` are documented/community-cited
  values **[COMMUNITY]** — not live-verified this session (Sleeper support confirms auction drafts
  exist as a feature: https://support.sleeper.com/en/articles/4056268-do-you-support-auction-drafts).
- `status`: `"complete"` confirmed live. `"pre_draft"`, `"drafting"`, `"paused"` are the commonly
  cited other values in community wrappers **[COMMUNITY, unverified live — a live in-progress draft
  was not available to fetch this session]**.
- `draft_order`: map of `user_id -> draft_slot` (1-indexed pick position).
- `slot_to_roster_id`: map of `draft_slot -> roster_id`; combine with `draft_order` and league
  `rosters`/`users` to fully resolve "who picks in slot N" to a human display name.
- `settings.pick_timer`: seconds per pick (10 in the fetched mock — real leagues typically set
  60–120s; use this to size poll cadence, see CONTRACT section).
- `settings.rounds`, `settings.teams`: needed to compute total picks and snake order.

### 1.8 Draft picks
`GET /v1/draft/<draft_id>/picks` **[LIVE-VERIFIED]**
Array, one element per pick made so far (in a live/in-progress draft this array only contains
completed picks — poll it to detect new picks). Confirmed live fields per pick:
`draft_id, draft_slot, is_keeper, metadata{first_name,injury_status,last_name,news_updated,number,
player_id,position,sport,status,team,team_abbr,team_changed_at,years_exp}, pick_no, picked_by,
player_id, reactions, roster_id, round`.
Note: in the fetched **mock draft** example, `picked_by` and `roster_id` were empty/null even
though `player_id` was populated — mock drafts using bots do not attach a real user/roster.
In a real league draft, `picked_by` = `user_id` of the picker, `roster_id` = their roster.

### 1.9 Traded draft picks (draft-scoped)
`GET /v1/draft/<draft_id>/traded_picks` **[DOCS]**
Fields (per docs summary): `season`, `round`, original/current `roster_id` owner mapping — used to
know which roster_id actually controls a given future pick slot when trades occurred.

### 1.10 Traded draft picks (league-scoped)
`GET /v1/league/<league_id>/traded_picks` **[DOCS]** — same shape, league-wide across drafts/seasons.

### 1.11 Players — full NFL player catalog
`GET /v1/players/nfl` **[DOCS — NOT fetched live per instructions, ~5MB]**
Docs explicitly warn: cache locally, call at most once per day. Fields relevant to a draft copilot
(confirmed via community Go struct field tags, cross-checked against fields observed inline in the
live draft-picks `metadata` block, which is a subset of the same schema) **[DOCS + COMMUNITY]**:
`player_id, first_name, last_name, full_name, position, fantasy_positions (array, e.g. ["RB"] or
["RB","FLEX"]), team, team_abbr, status (Active/Inactive/etc), injury_status, injury_body_part,
injury_notes, injury_start_date, depth_chart_position, depth_chart_order, search_rank, years_exp,
age, number, height, weight, college, birth_date, sportradar_id, gsis_id, espn_id, yahoo_id,
rotowire_id, rotoworld_id, stats_id, fantasy_data_id, news_updated`.
`player_id` is the join key used everywhere else (draft picks, rosters, projections, trending).

### 1.12 Trending players
`GET /v1/players/nfl/trending/<add|drop>` **[LIVE-VERIFIED]**
Optional query params: `?lookback_hours=24&limit=25` **[DOCS]**.
Live response shape (fetched `add`, default params): array of
`{player_id: "<string>", count: <int>}`, sorted descending by count. Example live values (2026-08-30):
`player_id "11581"` count 195885, `"13264"` count 173034, `"13411"` count 110907 — these are
add-count volumes over the default lookback window, useful as a "hot waiver/roster-add" signal but
**not directly an in-draft ranking signal** (drops/adds reflect waiver activity, not draft ADP).

### 1.13 NFL state
`GET /v1/state/nfl` **[LIVE-VERIFIED]**
Live response (2026-08-30):
```json
{
  "week": 1, "leg": 1, "season": "2026", "season_type": "regular",
  "league_season": "2026", "previous_season": "2025",
  "season_start_date": "2026-09-09", "display_week": 1,
  "league_create_season": "2026", "season_has_scores": true
}
```
Confirms 2026 NFL regular season kicks off 2026-09-09, consistent with the task's "kickoff in ~2
weeks" framing (today 2026-08-30). Use `season` from this endpoint to parameterize all other
season-scoped calls (leagues, drafts, projections) instead of hardcoding "2026".

---

## 2. Web-app URL encoding

- **Draft room**: `https://sleeper.com/draft/nfl/<draft_id>` — confirmed real example found via
  search: `https://sleeper.com/draft/nfl/1350281828241514496` **[verified live: this exact
  draft_id resolves via `GET /v1/draft/1350281828241514496` to a real 2026 mock draft, see §6]**.
- **League home**: `https://sleeper.com/leagues/<league_id>` — pattern confirmed by Sleeper's own
  support docs ("Your League ID is located at the end of your URL... 18-digit numeric string")
  https://support.sleeper.com/en/articles/4121798-how-do-i-find-my-league-id **[DOCS, support
  article]**. Exact full path not independently screenshotted; format `sleeper.com/leagues/<id>`
  is corroborated by multiple third-party guides **[COMMUNITY]**.
- **League → draft id**: the League object returned by `GET /v1/league/<league_id>` includes
  `draft_id` directly **[DOCS]** — no need to scrape the web UI; this is the reliable path for the
  extension (read `league.draft_id`, or call `GET /v1/league/<league_id>/drafts` for historical/
  multiple drafts in dynasty leagues).
- A content script running in the draft-room tab can also just read `draft_id` out of
  `location.pathname` (`/draft/nfl/<draft_id>`) directly — this is the simplest zero-API way for
  the extension to bootstrap which draft it's watching.

---

## 3. Mock drafts

**[LIVE-VERIFIED]** Mock drafts use the exact same endpoints as real drafts:
`GET /v1/draft/<draft_id>` and `GET /v1/draft/<draft_id>/picks` both worked against the mock draft
id `1350281828241514496` and returned normal Draft/DraftPick objects (see §6 for the full observed
JSON). The only structural differences observed:
- `league_id` is `null` for the mock (no league backs it).
- `picked_by` and `roster_id` were empty/null on individual picks (bot-filled picks, no real user
  attached) — the copilot should treat missing `picked_by` as "not a real roster" and fall back to
  `draft_slot` for turn-order logic in mock mode.
- `draft_order` contained only one real user_id (the mock's creator) mapped to their chosen slot;
  other slots are bots.

**Finding a mock draft id**: Sleeper's mock draft flow is reached via `sleeper.com/mockdraft`
(confirmed URL from search results: https://sleeper.com/mockdraft) — Sleeper's own support article
"How to conduct a Mock Draft" (https://support.sleeper.com/en/articles/4662857-how-to-conduct-a-mock-draft)
describes starting one from the Fantasy tab. Once started, the mock gets a normal
`sleeper.com/draft/nfl/<draft_id>` URL, so the same content-script URL-scraping approach in §2
applies unchanged — the extension does not need special-case mock-draft logic beyond the
null-`picked_by` handling above.

---

## 4. Undocumented endpoints (community-sourced + live-verified)

### 4.1 Projections — **[LIVE-VERIFIED, host differs from documented API]**
URL template confirmed live:
`GET https://api.sleeper.app/projections/nfl/<season>/<week>?season_type=regular&position[]=<POS>&order_by=pts_ppr`
(note: **no `/v1/` prefix** — this is a separate path family from the documented `/v1/...` routes).
Live test: `GET https://api.sleeper.app/projections/nfl/2026/1?season_type=regular&position[]=RB&order_by=pts_ppr`
returned a real JSON array of 2026 Week 1 RB projections, e.g. (verbatim as reported):
Jahmyr Gibbs — pts_ppr 22.3, rush_att 17.04, rush_yd 89.43, rec 4.0, rec_yd 26.69, adp 1.0;
Jonathan/Bijan Robinson — pts_ppr 21.52, rush_att 19.13, rush_yd 91.72, rec 4.26, rec_yd 32.76,
adp 2.0. Data is attributed to Rotowire per the fetch summary. An `adp` field is embedded directly
in the projections payload — this may be usable as a lightweight ADP signal without a separate
ADP call, but the exact `order_by` vocabulary (`pts_std`, `pts_half_ppr`, `pts_ppr`, etc.) and full
field list were not exhaustively enumerated; only the fields surfaced in this one live call are
confirmed.
Also documented by a third-party client library (sleeper-api-client readthedocs,
https://sleeper-api-client.readthedocs.io/en/latest/endpoints/projections.html) **[COMMUNITY]**,
which additionally describes:
- Player-scoped: `GET https://api.sleeper.com/projections/nfl/player/<player_id>?season=<season>&season_type=<type>&grouping=season|week`
  (note this community doc uses host `api.sleeper.com`, not `api.sleeper.app` — **unverified
  live**, treat with caution; the `api.sleeper.app` host is the one confirmed working in this
  session).
- Stats (actuals, not projections), same shape: `GET /v1/stats/nfl/<season_type>/<season>/<week>`
  and `GET /v1/stats/nfl/player/<player_id>?season_type=...&season=...` **[COMMUNITY, not live-verified]**.

Confidence: the projections endpoint is real and working (directly confirmed), widely referenced
by the fantasy-dev community, but is unofficial/undocumented — Sleeper could change or remove it
without notice. Do not treat field names beyond what was directly observed as guaranteed stable.

### 4.2 No separate standalone ADP endpoint found
No dedicated `/adp` endpoint was found in searches; the `adp` field embedded in the projections
response (§4.1) appears to be Sleeper's exposed ADP surface. **Gap**: could not confirm whether
this ADP is Sleeper-platform-specific ADP (drawn from actual Sleeper drafts) vs. a third-party
(Rotowire) ADP feed — the "Rotowire" attribution on the projections numbers suggests the
projections themselves are licensed content, but the `adp` field's source was not confirmed.

---

## 5. Rate limits, auth, CORS

- **Auth**: none required for any read endpoint; API is read-only **[DOCS]**.
- **Rate limit**: docs.sleeper.com states "stay under 1000 API calls per minute, otherwise you risk
  being IP-blocked" **[DOCS, verbatim]**. No documented per-endpoint limit distinct from this
  global guidance.
- **Commercial use**: docs note the API is free for non-commercial use only and that commercial use
  requires licensing **[DOCS]** — flag for the user/PM: a shipped Chrome extension recommending
  picks could be read as commercial use depending on monetization; worth a legal check before
  distribution, not resolved here.
- **CORS**: **could not be directly verified** in this session — WebFetch does not expose response
  headers, and no live browser fetch-from-extension-origin test was possible with available tools.
  Circumstantial evidence it works fine from browser JS/extensions: (a) numerous community
  React/JS frontend projects (e.g. `frontend-sleeper-sheets` on GitHub) fetch `api.sleeper.app`
  directly from browser code without a backend proxy; (b) Sleeper's own web app calls this same API
  from the browser. Chrome MV3 extensions additionally have the option to bypass page-level CORS
  restrictions by declaring `host_permissions` for `https://api.sleeper.app/*` in the manifest and
  fetching from the background/service-worker context, which is same-origin-policy-exempt for
  extensions with the right permission grant (general Chrome extension behavior, not
  Sleeper-specific) — this is the recommended implementation path regardless of what
  Access-Control-Allow-Origin api.sleeper.app actually sends. **Action item for builders**: verify
  with one real `fetch()` call from an unpacked extension before relying on this.

---

## 6. Live-verify results (raw, this session, 2026-08-30)

**`GET https://api.sleeper.app/v1/state/nfl`** — full response reproduced in §1.13.

**`GET https://api.sleeper.app/v1/players/nfl/trending/add`** (default params) — first 5 of array:
`[{"count":195885,"player_id":"11581"},{"count":173034,"player_id":"13264"},
{"count":110907,"player_id":"13411"},{"count":66717,"player_id":"8800"},
{"count":40775,"player_id":"11237"}]`

**`GET https://api.sleeper.app/v1/draft/1350281828241514496`** — full response:
```json
{
  "created": 1776294784173,
  "creators": ["203585990520999936"],
  "draft_id": "1350281828241514496",
  "draft_order": {"203585990520999936": 9},
  "last_message_id": "1398386254587932672",
  "last_message_time": 1787763773155,
  "last_picked": 1787763773143,
  "league_id": null,
  "metadata": {"description": "", "name": "", "scoring_type": "std", "show_team_names": "0"},
  "season": "2026",
  "season_type": "regular",
  "settings": {
    "alpha_sort": 0, "autopause_enabled": 0, "autopause_end_time": 840,
    "autopause_start_time": 120, "autostart": 0, "cpu_autopick": 1,
    "nomination_timer": 60, "pick_timer": 10, "player_type": 0,
    "reversal_round": 0, "rounds": 15, "slots_def": 1, "slots_flex": 2,
    "slots_k": 1, "slots_qb": 1, "slots_rb": 2, "slots_te": 1, "slots_wr": 2, "teams": 10
  },
  "slot_to_roster_id": {"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10},
  "sport": "nfl", "start_time": 1787763596594, "status": "complete", "type": "snake"
}
```
(This draft is `status: "complete"`, i.e. already-finished — not a live in-progress draft. It was
found via web search as an example URL, not hand-picked for freshness; it is useful for schema
verification but its picks reflect whatever point in time it was drafted, not necessarily current
ADP. Round-1 picks were Bijan Robinson, Jonathan Taylor, Jahmyr Gibbs at 1/2/3, which is at least
directionally consistent with 2026 RB-heavy early-round consensus.)

**`GET https://api.sleeper.app/v1/draft/1350281828241514496/picks`** — first 3 of array reproduced
in §1.8's field list (Bijan Robinson pick 1, Jonathan Taylor pick 2, Jahmyr Gibbs pick 3), each with
`picked_by: ""` and `roster_id: null` (mock-draft characteristic, see §3).

---

## CONTRACT FOR BUILDERS

| # | Method/URL | Poll cadence during live draft | Fields consumed |
|---|---|---|---|
| 1 | `GET /v1/state/nfl` | Once at extension load / daily | `season`, `week`, `season_type` — parameterize all other calls |
| 2 | `GET /v1/user/<username>` | Once, on user setup/login | `user_id` (persist this, not username) |
| 3 | `GET /v1/user/<user_id>/leagues/nfl/<season>` | On demand (user picks which league to watch) | `league_id`, `name`, `draft_id` |
| 4 | `GET /v1/league/<league_id>` | Once per draft session (cache) | `scoring_settings` (all keys, §1.3), `roster_positions`, `settings`, `draft_id` |
| 5 | `GET /v1/league/<league_id>/users` | Once per draft session (cache) | `user_id`, `display_name`, `metadata.team_name` |
| 6 | `GET /v1/league/<league_id>/rosters` | Once per draft session, refresh every ~60s during draft | `roster_id`, `owner_id`, `players` (to know what's already on each team) |
| 7 | `GET /v1/draft/<draft_id>` | Once at draft start; re-fetch on reconnect | `type`, `status`, `settings.rounds`, `settings.teams`, `settings.pick_timer`, `draft_order`, `slot_to_roster_id` |
| 8 | `GET /v1/draft/<draft_id>/picks` | **Poll every 2-5s while "on the clock" / draft active**; back off to 15-30s when not user's turn soon | `pick_no`, `round`, `draft_slot`, `player_id`, `roster_id`, `picked_by`, `metadata.position`, `metadata.team` — diff against previous poll to detect new picks and drive recommendation refresh |
| 9 | `GET /v1/draft/<draft_id>/traded_picks` | Once at draft start (rare to change mid-draft) | owner mapping for future-pick trades |
| 10 | `GET /v1/players/nfl` | **Once per day max**, cache to `chrome.storage.local` | `player_id`, `full_name`, `position`, `fantasy_positions`, `team`, `status`, `injury_status`, `injury_body_part`, `depth_chart_position`, `depth_chart_order`, `search_rank`, `years_exp`, `age`, `number` |
| 11 | `GET /v1/players/nfl/trending/add` (and `/drop`) | Every few minutes, low priority (waiver signal, not core draft signal) | `player_id`, `count` |
| 12 | `GET https://api.sleeper.app/projections/nfl/<season>/<week>?season_type=regular&position[]=<POS>&order_by=pts_ppr` (**undocumented, unofficial host path — build a fallback if it 404s**) | Once per draft session (projections don't change second-to-second) | `player_id`/name, `pts_ppr`/`pts_std`, `adp`, rushing/receiving/passing rate stats |

Notes for builders:
- Pick detection (#8) is the only endpoint that needs tight polling; everything else is
  cache-once-per-session or once-per-day. This keeps well under the 1000 calls/min ceiling even
  with dozens of concurrent extension users.
- Resolve "who is on the clock" purely from `draft.draft_order` + `draft.slot_to_roster_id` +
  `picks.length` + `draft.settings.rounds/teams` (standard snake math) — do not depend on any
  push/websocket mechanism; Sleeper's own draft room likely uses a websocket for live picks
  (`last_message_id`/`last_message_time` fields hint at a pubsub layer) but that is undocumented
  and out of scope — polling `/picks` is the supported, documented approach.
- Treat scoring-settings bonus-reception keys (`bonus_rec_te` etc.) as optionally-present; do not
  assume presence or exact key names without a defensive read (see §1.3 gap).
