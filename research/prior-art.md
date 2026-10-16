# Prior Art Survey — Draft Assistants, Optimizers, Datasets

Researched 2026-08-30 for Sleeper Draft Copilot. All time-sensitive claims (pricing, data
freshness, 2026-season availability) are flagged with source + fetch date; anything not
independently confirmed by a fetched page/date is marked accordingly.

---

## 1. Open-source projects

### ffanalytics (R package) — projection aggregation + averaging
- Repo: https://github.com/FantasyFootballAnalytics/ffanalytics (also mirrored under
  isaactpetersen/ffanalytics; a stale fork dadrivr/ffanalytics v0.2.2 also exists).
- What it does: scrapes weekly/seasonal **projections** from CBS, ESPN, FantasyPros,
  FantasySharks, FFToday, NumberFire, FantasyFootballNerd, NFL.com, RTSports, Walterfootball,
  then aggregates them per player via `projections_table()`.
- Algorithm worth stealing: the **averaging method choice** — `average` (simple mean),
  `robust` (median/trimmed, resistant to one source's outlier projection), or `weighted`
  (weight each source, e.g. by historical accuracy). This is a clean pattern for combining
  multiple projection sources into one number before computing VBD — directly reusable even
  if our extension pulls fewer raw sources (e.g. FantasyPros consensus + Sleeper's own
  projections).
- Gets right: source-diversity reduces single-site bias; tidyverse-based, well structured.
- Gets wrong / limits: R-only, scraping-based (fragile, ToS risk for some sources), not
  designed for live in-draft use — it's a pre-draft cheat-sheet generator, not a pick-clock
  recommender.
- License: not confirmed in this pass (GPL is typical for FFA-related repos but I did not
  independently verify the LICENSE file — **gap**, check before reuse).

### VBD-Package / Fantasy-Football-VBD (famendola1)
- Repos: https://github.com/famendola1/VBD-Package (Python package) and
  https://github.com/famendola1/Fantasy-Football-VBD (CLI wrapper, takes projection CSV +
  league_size + team_size args).
- Algorithm (confirmed via README fetch): implements three classic VBD baselines —
  **VORP** (value over the best waiver-available replacement), **VOLS** (value over last
  starter, i.e. the last player in the starting lineup at that position league-wide), and
  **VONA** (value over next available — the best player at that position likely still there
  at your *next* pick). Baseline rank is picked from consensus ADP: for a 12-team/180-pick
  league, it counts how many players at each position land in the top 180 by ADP, and the
  next player at that position becomes the replacement baseline.
- Gets right: clean three-baseline abstraction (VORP/VOLS/VONA) is exactly the vocabulary our
  engine should use.
- Gets wrong: static baseline computed once pre-draft; does not update baselines live as
  players get drafted (no "dynamic" re-baselining — see Draft Sharks below for that idea).
- License: **MIT** (confirmed via fetch). Last updated **Aug 25, 2018** — unmaintained, no
  2026 data, but the algorithm itself is timeless and safe to port.

### AI NFL Fantasy Draft (zacharykirby/ai-nfl-fantasy-draft)
- Repo: https://github.com/zacharykirby/ai-nfl-fantasy-draft
- Most directly relevant open repo found: a "data-driven fantasy football draft engine with
  live session tracking and VORP-based recommendations," CLI + planned mobile web cockpit,
  optional AI reasoning via OpenRouter (i.e. it already tried the "LLM makes the final call"
  pattern we're building).
- Algorithm (confirmed via fetch): VORP combining weighted historical performance +
  availability, position-aware features (age, consistency, usage, team, risk, news), three
  recommendation modes — **safe** (heavier risk penalty), **balanced** (blends value + VORP +
  need + scarcity), **upside** (weights VORP/upside more). Explicitly factors "round-sensitive
  roster needs, tier cliffs, recent position runs, and disclosed player/tier survival
  estimates" — i.e. it already implements position-run detection and survival estimates
  conceptually, worth studying for the exact feature list even without reading its code.
- Gets right: deterministic/auditable scoring breakdown (score is explainable, not a black
  box) — good pattern for us since we want the Claude call to reason over transparent
  intermediate numbers, not raw stats.
- Gets wrong / gaps: **no Sleeper (or ESPN/Yahoo) live sync** — projections sourced from ESPN
  Mike Clay + FantasyPros DraftWizard ADP, manual player matching during live drafts. This is
  the gap our extension fills.
- License: **MIT** (confirmed). Exact last-commit date not resolved via fetch — **gap**.

### fantasy-football-drafter (kjford)
- Repo: https://github.com/kjford/fantasy-football-drafter
- VOR-based ranking with a "fitweight" parameter blending preseason-rank predictability vs.
  postseason-performance predictability per position, plus a simulated-snake-draft harness.
  License **GPL-2.0** (confirmed). Data references 2009-2013 seasons — dead project, algorithm
  ideas only (the fitweight-blend concept is reusable; the code/data is not).

### Sleeper-specific tools
- **SleeperPlus** (nkasco/SleeperPlus) — Chrome extension, but it's a UI/UX overlay
  (sparklines, layout, chat) for the desktop Sleeper app in general, **not a draft-pick
  recommender**. https://github.com/nkasco/SleeperPlus
- **FFRankExtension** (tyleralgigi/FFRankExtension) — Chrome extension injecting ADP and "vFP"
  (variance vs. Sleeper's own ranking) columns into the Sleeper draft board.
  https://github.com/tyleralgigi/FFRankExtension — Confirmed via fetch: data source is a
  **bundled CSV, not a live feed**, PPR-only, MIT license, and — important freshness flag —
  the README as of this fetch (Aug 2026) still says *"The data in this project currently is
  from 2023. It will be updated for the 2025 season"* — i.e. it is stale two seasons over and
  effectively abandoned. Useful as a UX reference (column-injection into Sleeper's DOM) but
  not as a data or algorithm source.
- **Subvertadown Sleeper Draft Sync** (Chrome Web Store listing) — reads public Sleeper draft
  data, syncs to Subvertadown's own board, shows guidance in a side panel. This is a
  commercial tool, covered in section 2.
- **fantasy-draft-tool** (aguerraochoa) and one other listing returned 404 on direct fetch —
  **gap**, could not verify contents/license/last-update; only know it "combines FantasyPros
  rankings with live Sleeper data" per search snippet, unconfirmed firsthand.

### nflverse / nfl_data_py
- Repos: https://github.com/nflverse/nfl_data_py, https://github.com/nflverse/nflverse-data,
  https://github.com/nflverse/nfldata, R equivalent https://nflreadr.nflverse.com/.
- Confirmed (search-snippet level, not deep-fetched): nfl_data_py pulls from nflfastR,
  nfldata, dynastyprocess, and Draft Scout — play-by-play, weekly/seasonal stats, rosters,
  **NFL Draft** picks & pick values (real NFL draft, not fantasy — since 2000, via Pro
  Football Reference), combine results, cross-site ID mapping (crucial for reconciling
  Sleeper player IDs with other sources).
- Gap: could not confirm whether nflverse ships **fantasy ADP** data or real-time-updated 2026
  rosters/depth-charts inside this pass — treat nflverse as a *historical/reference stats +
  ID-crosswalk* source, not a live draft-day feed. The ID crosswalk (`ffverse`/`dynastyprocess`
  ID files) is likely the most valuable single artifact for reconciling Sleeper's internal
  player IDs against FantasyPros/ESPN IDs — worth a dedicated follow-up read of
  https://github.com/nflverse/nflverse-data before build.

---

## 2. Commercial tools' methodology (feature-level, not code)

### FantasyPros Draft Wizard / Draft Assistant
- Pages: https://draftwizard.fantasypros.com/football/draft-assistant/,
  https://support.fantasypros.com/hc/en-us/articles/115001308567-What-is-the-Draft-Assistant
  (support-article direct fetch returned 403 — confirmed only via search snippets, not
  primary-source read — **flag**).
- Per search snippets: **Draft Sync** auto-crosses off drafted players from your cheat sheet
  as picks happen live; **suggestions** are generated from (a) your personal/custom cheat
  sheet or expert consensus rankings, (b) tracked team needs, and (c) position scarcity; it
  also shows what "the experts" (a panel of simulated/expert drafters) would pick from your
  queue. If tiers are defined, it surfaces a live color-coded count of players remaining per
  tier. This is essentially: ECR ranking + team-need filter + tier-depletion display + a
  simple "what would an expert do" nudge — no evidence of Monte Carlo or VBD-style baseline
  math specifically, just tiered-ECR-plus-needs.
- Commercial/API: FantasyPros has a formal developer API at
  https://api.fantasypros.com/public/v2/json with x-api-key auth; **free tier** for
  prototyping, **premium** (bundled with an $8.99/mo-annual "HOF" subscription, confirmed via
  search snippet from fantasypros.com/api-data) unlocks personal/non-commercial production
  keys covering rankings, projections, players, news, injuries; **commercial** tier required
  for redistribution or high-volume/bulk use. A `consensus-rankings` endpoint gives
  rankings/ADP by position, scoring format, and week, redraft or dynasty. This is a real
  licensing constraint: a shipped Chrome extension distributed to other users would likely
  need the commercial tier, not personal HOF key — **flag for legal/ToS review before
  depending on FantasyPros API**.

### Draft Sharks — "Dynamic VBD"
- https://www.draftsharks.com/adp (ADP page, current for 2026 per page title/search snippet).
- Methodology, per search snippets (Footballguys/FantasySharks forum discussion of "Dynamic
  VBD" — could not reach a Draft Sharks primary explainer page directly in this pass, so this
  is second-hand — **flag**): standard VBD is "value regardless of position" computed once;
  **Dynamic VBD** instead continuously compares **consecutive same-position ranked players'**
  point gaps and re-scores as the board changes, i.e. the baseline/replacement level shifts
  live during the draft as players are actually taken (not fixed pre-draft). This is the
  single most directly useful commercial concept for us: a **live-recomputed VBD baseline**
  keyed off which players have actually been drafted, not a static pre-draft baseline. Could
  not verify the exact formula (only the concept) — treat as a design direction, not a
  spec to copy verbatim.

### Subvertadown — K/DST streaming models
- https://subvertadown.com/article/subvertadown-overview,
  https://subvertadown.com/article/analysis-of-holding-vs-streaming-kickers,
  2026 D/ST page: https://subvertadown.com/weekly/defense (confirmed live/current per title).
- Methodology per search snippets: computes a position "**Baseline**" (expected points from
  replacement-level players at that spot), then a weekly "**matchup bonus**" = deviation from
  that baseline driven by opponent strength, with an "AVG" column representing rest-of-season
  strength of schedule. Core finding they publish: **matchup-based streaming beats holding** a
  single K/DST for the season, on average, across their tracked accuracy history. Relevant to
  us mainly for **in-season streaming logic**, not draft-day (K/DST are typically last-two-picks
  afterthoughts in redraft drafts) — lower priority than the skill-position algorithms below,
  but the Baseline+matchup-bonus decomposition is a clean pattern if we ever add
  streaming advice post-draft.

### Boris Chen — tier clustering off ECR
- Site: http://www.borischen.co/ , tiers page: http://www.borischen.co/p/ppr-draft-tiers.html
  (fetched directly), code repo: https://github.com/borisachen/fftiers (fetched directly).
- Algorithm: README references R's `mclust` package → **Gaussian mixture model clustering**
  applied to FantasyPros expert-consensus rankings (ECR) + their standard deviation, grouping
  players into tiers where within-tier players are statistically indistinguishable and
  between-tier there's a real gap. This is a well-known, cheap, explainable clustering
  approach (1-D GMM on ECR mean±stdev) — very portable to JS (e.g. simple k-means or GMM over
  a 1-D array is trivial to implement client-side, no ML library needed).
- **Machine-readable files**: confirmed the tiers page (as fetched) only links **PNG images**
  (`https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-PPR-adjust{0,1,2}.png`) on that
  specific page. The GitHub README (fetched) says the pipeline pushes
  `out/current/{png,csv,txt}/` to `s3://fftiers/out/` on a Mon/Thu (pre-draft) and
  Tue/Thu/Sun (in-season) cadence, implying **txt/csv tier files likely exist in that bucket**,
  but I could not enumerate an actual working object URL (e.g. a confirmed `QB.txt`) in this
  pass, and the tiers *webpage* itself only surfaces the PNGs — **flag/gap**: before building
  a fetch integration, someone needs to hit `s3://fftiers/out/` listing or try guessed paths
  (e.g. `.../out/current/txt/QB.txt`) directly, since bucket contents weren't confirmed
  live/current for the 2026 season and no explicit LICENSE file was found in the repo (README
  has no license section — treat data as "publicly linked but not explicitly licensed for
  redistribution," and the site itself states data is sourced from FantasyPros, which has its
  own ToS).

---

## 3. Algorithms worth implementing (concrete enough to code)

1. **Dynamic VBD baseline** (from famendola1/VBD-Package + Draft Sharks concept): maintain
   VORP/VOLS/VONA baselines per position, **recomputed after every pick** using only players
   still undrafted (not a static pre-draft baseline). Formula sketch:
   - `replacement_rank[pos] = (starters_per_team[pos] * num_teams) + bench_buffer[pos]`,
     shrinking as picks at that position are made.
   - `VBD(player) = projected_points(player) - projected_points(replacement_rank_player_at_same_pos)`
   - VONA variant: instead of a fixed replacement rank, use the **projected points of the
     best player at that position expected to survive to your next pick** (needs the ADP
     survival model in #3 below).

2. **ADP-based survival probability**: per the Medium "Simulating the Snake" piece (search
   summary only — direct fetch was 403, so treat as secondary-source, not primary — **flag**)
   and the general pattern used by mock-draft simulators: model each other team's pick as
   **ADP ± noise** (commonly modeled as roughly log-normal or normal around consensus ADP with
   position/round-scaled variance — exact distribution/std-dev parameters were not confirmed
   from a primary source in this pass, only that "noise" is added — **gap**, worth a follow-up
   search for FantasyPros' or a stats-focused source's published ADP standard-deviation
   numbers, which do exist as a column on some ADP exports). A workable formula to implement
   without further research: treat each pick slot between now and your next turn as an
   independent Bernoulli draw where `P(player still available at pick N) = Φ((N - ADP) / σ)`
   using the normal CDF, with σ estimated from the ADP source's own reported standard
   deviation (FantasyPros' consensus-rankings endpoint reportedly includes ADP StdDev —
   confirm at build time) or a fallback heuristic (σ grows with round number / ADP variance
   across sources).

3. **Monte Carlo draft simulation** (from faverogian/nfl-fantasim, confirmed via fetch, and
   the Medium piece via search summary): simulate N (e.g. 500-1000) forward draft
   continuations where opponents pick "ADP + noise" or a simple best-player-available
   heuristic, compare **take-now vs. wait** for a candidate player by looking at expected
   roster value at your next pick under each choice, and rank choices by
   **`utility = mean(outcome) - λ * stdev(outcome)`** (risk-adjusted, λ tunable, e.g. 0.5-1.0
   per the search-summarized description). **Is it worth it in-browser?** — nfl-fantasim's own
   scale (1,000 sims comparing 5 whole-draft strategies offline in Python) is a different,
   heavier workload than what we need (one sim of "will this player survive to my next pick,"
   just for the handful of live candidates each turn). A cut-down version — a few hundred
   lightweight simulations of *only the picks between now and your next turn* (typically
   `2 * num_teams - 2` picks in a snake draft), each pick a cheap weighted-random draw — is
   plausibly cheap enough to run in a content-script/worker in well under a second; this
   should be prototyped and timed rather than assumed, but the shape of the problem (short
   horizon, not a full 15-round sim) makes it look feasible client-side.

4. **Roster-need weighting**: from ai-nfl-fantasy-draft's "balanced" mode and Draft
   Assistant's "team needs" filter — multiply/boost a player's value by a need factor derived
   from `(starting_slots_remaining_for_pos) / (starting_slots_total_for_pos)`, tapering to
   near-zero once starting slots are filled and only bench/flex value remains. Combine
   additively or multiplicatively with VBD score; both repos treat this as one blended term
   among several, not a hard filter.

5. **Tier-urgency triggers**: from Boris Chen's GMM tiers — recommend flagging "last player in
   tier X" as urgent, i.e. surface a warning when only 1 player remains before the next
   between-tier point-gap. Cheap to compute client-side once you have any 1-D tiering
   (even a simple gap-threshold heuristic on sorted projected points works if a full GMM is
   overkill).

6. **Position-run detection**: none of the repos found a documented formula (ai-nfl-fantasy-
   draft *lists* "recent position runs" as a factor but the algorithm itself wasn't visible
   via fetch — **gap**). A simple, implementable version: track the position of the last K
   picks (e.g. K=5) league-wide; if run-count for a position exceeds a threshold (e.g. 3 of
   last 5), boost that position's urgency score, since it signals other managers are pricing
   that position's scarcity in real time.

---

## 4. Runtime-fetchable data feeds (no-key / low-friction, for a browser extension)

(Sleeper's own endpoints are covered in depth by another researcher on this project — listed
here only for completeness/coordination.)

- **Sleeper API** (players, drafts, picks, and Sleeper's own ADP/projections) — public,
  documented at https://docs.sleeper.com — no key required for reads. Defer detail to the
  Sleeper-endpoint researcher.
- **FantasyPros API** — `https://api.fantasypros.com/public/v2/json`, requires an `x-api-key`
  (free/prototype tier available, but redistribution/commercial use requires the paid
  Commercial tier per https://www.fantasypros.com/api-data/ and
  https://support.fantasypros.com/hc/en-us/articles/49749297704475). Format: JSON. Update
  cadence not independently confirmed (typically daily during season per general FantasyPros
  practice, not verified this pass — **gap**). **Legal note**: distributing a Chrome extension
  to other users that calls FantasyPros data likely needs the Commercial license, not a
  personal HOF key — needs explicit resolution before shipping.
- **Boris Chen / fftiers S3 bucket** — `s3://fftiers/out/` per the repo's own push script;
  exact object keys/URLs for machine-readable txt/csv were **not confirmed live** in this pass
  (only PNG chart URLs were confirmed reachable from the tiers webpage). No explicit license
  in the repo. Treat as unverified/gap — do not build a hard dependency on this without first
  confirming a working object URL and checking FantasyPros' own ToS (since fftiers explicitly
  states "all data exclusively from FantasyPros.com," meaning any redistribution restrictions
  FantasyPros imposes likely apply transitively).
- **nflverse-data** — https://github.com/nflverse/nflverse-data — static CSV/parquet releases
  via GitHub Releases, no key needed, but this is historical/reference data (rosters, real NFL
  draft picks, ID crosswalks), not live fantasy ADP/projections — good for offline ID
  reconciliation, not live in-draft signal.
- **Draft Sharks ADP page** — https://www.draftsharks.com/adp — page-only, no documented public
  API found in this pass; would require scraping (ToS risk) — not recommended as a runtime
  feed without further legal check.

---

## RECOMMENDED ALGORITHM BLUEPRINT

**Inputs** (all fetched/refreshed live during the draft):
- Sleeper draft state (picks made, on-the-clock, roster slots) — from Sleeper API (detail
  owned by the other researcher).
- A projections/ranking source: Sleeper's own projections as primary (zero extra auth), with
  FantasyPros consensus rankings as an optional enrichment *if* the commercial-license
  question above gets resolved favorably; otherwise fall back to a bundled/periodically
  updated static projections file the extension author maintains (avoids the FantasyPros
  redistribution issue entirely for v1).
- League settings (roster slots, scoring) — from Sleeper API.
- ADP + ADP variance (source TBD — Sleeper ADP if available, else FantasyPros ADP StdDev if
  license permits, else a fixed heuristic σ by round).

**Formula sketch (local math, runs entirely client-side, no LLM call needed):**
1. `proj_pts(player)` — from projections source, adjusted to league scoring settings.
2. `VBD(player) = proj_pts(player) - proj_pts(replacement_player_at_same_pos)`, where the
   replacement rank is **recomputed live** (Dynamic-VBD style) from currently-undrafted
   players only.
3. `survival_prob(player, my_next_pick) = Φ((my_next_pick_slot - ADP(player)) / σ(player))`
   — a normal-CDF approximation, cheap, no simulation needed for the common case.
4. `VONA(player) ≈ VBD(player) adjusted by whether a comparable-or-better same-position player
   is likely to survive to your next pick` — computed either via the closed-form survival
   probability (fast path) or, for the top ~10-15 live candidates only, a short **Monte Carlo
   sim of just the picks between now and your next turn** (a few hundred iterations, ADP+noise
   opponent model) to get a more accurate "wait" value — this is the one piece worth
   prototyping/timing in-browser before committing to it for every pick.
5. `need_factor(player) = f(starting_slots_remaining[pos] / starting_slots_total[pos])`,
   blended multiplicatively with VBD/VONA.
6. `tier_urgency(player)` — cheap 1-D clustering (gap-threshold or lightweight GMM) over
   remaining players at that position; flag "last in tier."
7. `run_signal(pos)` — boost if that position dominates the last K picks league-wide.
8. Combine 2-7 into a single **local candidate score** per undrafted player, and shortlist the
   top N (e.g. 5-8) candidates — **all of this stays local math, no API cost, sub-second.**

**What goes to the Claude API call:** only the *shortlist* (top 5-8 candidates) plus their
computed scores/sub-scores (VBD, survival prob, need factor, tier-urgency, run signal),
current roster composition, and league context — framed as a structured summary, not raw
projections tables. Claude's job is the part none of the surveyed tools do well: **qualitative
judgment on top of the quantitative shortlist** — e.g. weighing a coach-speak/injury-cloud
signal, bye-week stacking conflicts, explaining the trade-off in plain language for the pick,
and breaking near-ties using context the local math can't encode (e.g. "this WR's role just
expanded after a teammate's injury reported Aug 28"). This keeps token cost low (small
structured payload, not full player pools) and keeps the deterministic, auditable math local —
mirroring what ai-nfl-fantasy-draft got right (explainable scoring) while adding the one thing
none of the open-source tools have: an LLM synthesizing the final call from clean, pre-reduced
signals rather than either (a) doing all reasoning itself over huge context or (b) being
absent entirely (pure-math tools) or (c) being a rigid rules engine (commercial "Draft
Assistant" tools).

---

## Sources used (with dates where available)

- https://github.com/FantasyFootballAnalytics/ffanalytics (fetched 2026-08-30, no date shown)
- https://github.com/famendola1/VBD-Package (fetched; last updated 2018-08-25 per README)
- https://github.com/famendola1/Fantasy-Football-VBD (search snippet only)
- https://github.com/zacharykirby/ai-nfl-fantasy-draft (fetched 2026-08-30)
- https://github.com/kjford/fantasy-football-drafter (fetched 2026-08-30)
- https://github.com/nkasco/SleeperPlus (search snippet)
- https://github.com/tyleralgigi/FFRankExtension (fetched 2026-08-30 — README still says
  "data from 2023, will be updated for 2025" — stale, flagged)
- https://github.com/aguerraochoa/fantasy-draft-tool (404 on fetch — unverified)
- https://github.com/nflverse/nfl_data_py, nflverse-data, nfldata, nflreadr.nflverse.com
  (search snippets only, not deep-fetched)
- https://draftwizard.fantasypros.com/football/draft-assistant/ and
  https://support.fantasypros.com/hc/en-us/articles/115001308567 (403 on direct fetch;
  search-snippet summary only)
- https://www.fantasypros.com/api-data/ and
  https://support.fantasypros.com/hc/en-us/articles/49749297704475 (search snippets)
- https://forums.footballguys.com/threads/anyone-out-there-use-dynamic-value-based-drafting.643813/
  and fantasysharks.com forum (search snippets, Dynamic VBD concept — secondary source)
- https://subvertadown.com/article/subvertadown-overview,
  /article/analysis-of-holding-vs-streaming-kickers, /weekly/defense (search snippets;
  defense page title confirms 2026 currency)
- http://www.borischen.co/p/ppr-draft-tiers.html (fetched 2026-08-30)
- https://github.com/borisachen/fftiers (fetched 2026-08-30, 149 commits, no LICENSE found)
- https://bcjense6.medium.com/simulating-the-snake-... (403 on direct fetch; search-snippet
  summary only, dated by search engine as published Aug 2025)
- https://github.com/faverogian/nfl-fantasim (fetched 2026-08-30; MIT license; author Gian
  Favero, 2024; uses 2023-season data)
- https://www.draftsharks.com/adp (search snippet only, title suggests 2026-current)
