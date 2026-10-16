# Sleeper Draft Copilot — DESIGN (ground truth for all builders)

Chrome MV3 extension. Watches a live Sleeper fantasy draft via the Sleeper read-only API,
computes a value-based shortlist locally, and asks the Claude API for the final ranked
recommendation when the user is on (or near) the clock. Personal use, load-unpacked.

Verified facts this design relies on (see research/ for sources):
- All Sleeper read endpoints are no-auth. Draft room URL: `https://sleeper.com/draft/nfl/<draft_id>`.
- `GET https://api.sleeper.app/v1/draft/<id>` and `/v1/draft/<id>/picks` work for real AND mock
  drafts (mock: `league_id` null, picks may have empty `picked_by`/`roster_id`).
- SEASON-LONG projections endpoint (live-verified 2026-08-30):
  `GET https://api.sleeper.app/projections/nfl/2026?season_type=regular&position[]=RB&order_by=adp`
  returns array of objects: `{player_id, player:{...}, stats:{...}}` where `stats` holds season
  stat projections (`rush_yd`, `rush_td`, `rec`, `rec_yd`, `rec_td`, `pass_yd`, `pass_td`,
  `pass_int`, `fum_lost`, `gp`, bonus cols…) AND format ADPs (`adp_ppr`, `adp_half_ppr`,
  `adp_std`, `adp_2qb`, `adp_dynasty*`, `adp_idp`). **ADP 999.0 = undrafted sentinel → null.**
  Undocumented endpoint: every consumer wraps it in try/catch with graceful degradation.
- MV3: fetch() from the service worker OR any extension page (side panel) with matching
  `host_permissions` bypasses CORS. Content scripts do NOT get this — content script never fetches.
- Claude Messages API: `POST https://api.anthropic.com/v1/messages`, headers
  `content-type: application/json`, `x-api-key`, `anthropic-version: 2023-06-01`.
  Structured outputs: `output_config: {format: {type: "json_schema", schema: {...}}}` — no beta
  header. Effort: `output_config.effort` (`low|medium|high`). Default model `claude-opus-5`
  (thinking on by default; do NOT send a `thinking` param, do NOT send temperature).
  For `claude-opus-5` ONLY, also send header `anthropic-beta: server-side-fallback-2026-07-01`
  and body field `"fallbacks": "default"` (refusal fallback). Check `stop_reason === "refusal"`.

## 0. Architecture decision (differs from research/extension-architecture.md — this doc wins)

The SIDE PANEL owns the fast poll loop, engine, and Claude calls. It is a full extension page
(CORS-exempt), it is open during the draft by definition, and an open panel keeps the extension
alive — this eliminates every service-worker-lifetime problem. chrome.alarms is NOT used.
The service worker is a thin relay: opens the panel on toolbar click, receives draft-id
detections from the content script, stores them, sets badge text.

```
content/content.js ──(draft_id via sendMessage)──▶ background/service-worker.js
                                                        │ chrome.storage.local: lastDetectedDraft
sidepanel/panel.js ◀──(storage read + onChanged)────────┘
     │  poll loop (3s): sleeper-client → draft-math → engine → render
     └─ on/near the clock: prompt-builder → anthropic-client → render recommendations
shared/*  = pure ES modules, NO chrome.* references (must run in node for tests)
```

## 1. File ownership (each builder touches ONLY its files; `shared/` shapes are contracts)

| Builder | Files |
|---|---|
| B1 plumbing | `extension/manifest.json`, `extension/background/service-worker.js`, `extension/content/content.js`, `extension/shared/sleeper-client.js` |
| B2 engine | `extension/shared/draft-math.js`, `extension/shared/engine.js`, `test/engine.test.mjs` |
| B3 ui+ai | `extension/sidepanel/panel.html`, `extension/sidepanel/panel.js`, `extension/sidepanel/panel.css`, `extension/shared/anthropic-client.js`, `extension/shared/prompt-builder.js`, `extension/shared/strategy-prompt.js` |
| B4 harness+docs | `test/dry-run.mjs`, `README.md`, `docs/USAGE.md` |

`extension/data/players-2026.json` already exists (255 players; shape:
`{season, compiledAt, scoringBasis, byeWeeks: {TEAM: week}, players: [{name, team, pos, tier,
posRank, adp, note, risk[]}]}` — tier/adp may be null). Nobody edits it.

Conventions: vanilla JS, ES modules (`export`/`import` with explicit `.js` extensions), no npm
deps, no build step, 2-space indent. `shared/` files: zero `chrome.*`, zero DOM — they must
import cleanly in node ≥18. Never log or persist the API key anywhere except
`chrome.storage.local.anthropicApiKey`. All Sleeper fetches: 10s timeout via AbortController,
throw `new Error("sleeper:<what>")` on non-OK.

## 2. Shared data shapes (exact — all builders conform)

```js
// PlayerRecord — the merged runtime player object (built by engine.buildPlayerPool)
{ id: string,            // Sleeper player_id ("DEF" players: team code e.g. "SF")
  name: string, pos: 'QB'|'RB'|'WR'|'TE'|'K'|'DEF', team: string|null,
  byeWeek: number|null,
  projPts: number|null,  // season points under THIS league's scoring (see §4.1)
  adp: number|null,      // format-matched ADP, 999→null
  tier: number|null, posRank: number|null, note: string, risk: string[],  // from dataset
  injuryStatus: string|null,   // from players/nfl ("Questionable","IR","Out",null…)
  marketDisagreement: string|null }  // from dataset notes when risk/note flags it, else null

// LeagueContext (built by draft-math.buildLeagueContext)
{ teams: number, rounds: number,
  scoring: object,               // raw scoring_settings (league) or preset (mock, see §3.3)
  rosterPositions: string[],     // e.g. ['QB','RB','RB','WR','WR','TE','FLEX','BN',...]
  recPoints: number,             // scoring.rec ?? 0
  isSuperflex: boolean,          // rosterPositions has 'SUPER_FLEX' or ≥2 'QB'
  scoringLabel: string }         // 'PPR' | 'Half-PPR' | 'Standard' (+' Superflex')

// DraftState (built by draft-math.buildDraftState)
{ draftId: string, status: string, type: string,
  picks: array,                  // raw Sleeper picks
  currentPickNo: number,         // picks.length + 1 (1-based next pick)
  currentRound: number, onTheClockSlot: number,
  mySlot: number, isMyTurn: boolean,
  picksUntilMine: number,        // 0 when my turn
  myNextPickNo: number,          // my current/next pick number
  myFollowingPickNo: number|null,// the one after that (null past end)
  draftedIds: Set<string>,       // player_ids picked
  myPlayerIds: string[],         // in pick order
  slotPlayerIds: Map<number, string[]>,  // slot → player_ids
  slotsBetween: number[] }       // slots picking after now, before my next pick (excl. me)

// EngineResult (engine.evaluate)
{ candidates: [ { player: PlayerRecord, score, vbd, replacementPts, survival,  // 0..1 P(available at my next pick)
    needFactor, tierStatus: 'LAST_IN_TIER'|'TIER_THIN'|null, runBoost: bool,
    bestAtPosAtNextPick: number|null } ],   // expected best VBD at this pos if I wait (VONA input)
  positionSummary: { [pos]: { remainingStarters: number, topTierLeft: number, bestName: string } },
  runs: { [pos]: number } }      // count in last 8 picks, only entries ≥ 4

// Recommendation (anthropic-client.getRecommendation resolves to)
{ recommendations: [{player: string, why: string, confidence: 'high'|'medium'|'low'} ×3],
  strategyNote: string, model: string, usage: {input_tokens, output_tokens} }
```

## 3. Module contracts

### 3.1 `shared/sleeper-client.js` (B1) — thin fetch wrappers, all `async`, all no-auth
```js
export async function getNflState()                      // GET /v1/state/nfl
export async function getDraft(draftId)                  // GET /v1/draft/<id>
export async function getDraftPicks(draftId)             // GET /v1/draft/<id>/picks
export async function getLeague(leagueId)                // GET /v1/league/<id>
export async function getUser(usernameOrId)              // GET /v1/user/<x>
export async function getSeasonProjections(season, positions) // undocumented endpoint above;
  // one fetch per position, merged; returns Map<player_id, {stats, player}>; throws 'sleeper:projections' on failure
export async function getPlayersSlim()
  // GET /v1/players/nfl (~5MB). Filter to fantasy positions QB/RB/WR/TE/K/DEF with team!=null
  // OR search_rank < 600; keep ONLY {player_id, full_name, position, team, injury_status, bye:null}.
  // Return {fetchedAt: <caller stamps>, players: {id: slim}}. Caller caches in chrome.storage.local
  // 24h ('playersCache'). This module does NOT touch chrome.storage (pure fetch).
export function parseDraftIdFromUrl(url)  // sleeper.com/draft/nfl/<digits> or bare digits → string|null
```
Base `https://api.sleeper.app`. Export `const SLEEPER_BASE` for tests.

### 3.2 `shared/draft-math.js` (B2) — pure functions
```js
export function pickNoFor(slot, round, teams)        // snake: odd r: (r-1)*teams+slot ; even: r*teams-slot+1
export function slotForPickNo(pickNo, teams)
export function roundForPickNo(pickNo, teams)
export function myPickNos(slot, teams, rounds)       // ascending array
export function buildLeagueContext({league, draft})
  // league may be null (mock). Then derive from draft.settings.slots_* (slots_qb, slots_rb,
  // slots_wr, slots_te, slots_flex, slots_super_flex, slots_k, slots_def, slots_bn) and
  // draft.metadata.scoring_type ('ppr'|'half_ppr'|'std'|'2qb'|…) → preset scoring:
  // PRESETS = std {rec:0}, half {rec:0.5}, ppr {rec:1}; all with pass_td:4, pass_yd:0.04,
  // pass_int:-1, rush_yd:0.1, rush_td:6, rec_yd:0.1, rec_td:6, fum_lost:-2. 2qb → ppr + superflex.
  // When league present: scoring_settings + roster_positions + settings verbatim. DEFENSIVE READS
  // everywhere — any missing key falls back to preset value.
export function resolveMySlot({draft, myUserId})     // draft.draft_order[myUserId] ?? null
export function buildDraftState({draft, picks, mySlot})
```

### 3.3 `shared/engine.js` (B2) — the local math. Exports:
```js
export function buildPlayerPool({projections, playersSlim, dataset, league})  // → PlayerRecord[]
export function evaluate({pool, league, draftState})                          // → EngineResult
export function normalizeName(name)  // lowercase, strip diacritics/punct/'jr|sr|ii|iii|iv' suffixes
```
Formulas — implement EXACTLY:
1. **projPts** = Σ over keys k present in BOTH proj.stats and league.scoring of
   `stats[k] × scoring[k]`. If result ≤ 0 or no overlapping keys, fallback to
   `stats.pts_ppr` when recPoints ≥ 1, `stats.pts_half_ppr` when 0 < recPoints < 1, else `stats.pts_std`.
   Exclude ADP keys (`adp_*`), `gp`, `pos_adp*` from the summation.
2. **adp**: `adp_2qb` if superflex else recPoints≥1→`adp_ppr`, >0→`adp_half_ppr`, else `adp_std`;
   999 or missing → null.
3. **Dataset merge**: match dataset players to pool via `normalizeName(name)+pos`, fallback
   normalized last name + first initial + pos. Unmatched dataset rows are dropped silently;
   unmatched pool players keep tier/note null. DEF: match dataset team code.
4. **Starter slots per position** (league-wide): count roster_positions occurrences; FLEX adds
   0.35 RB / 0.55 WR / 0.10 TE per FLEX slot; SUPER_FLEX adds 0.75 QB / 0.10 RB / 0.15 WR.
   `starterSlots[pos] = teams × thatSum`.
5. **Dynamic replacement**: for each pos, `draftedAtPos` = count of drafted players at pos;
   `unfilled = max(round(starterSlots[pos]) − draftedAtPos, 1)`. Sort UNDRAFTED at pos by projPts
   desc; `replacementPts[pos]` = projPts of index `min(unfilled, len−1)`. **vbd = projPts − replacementPts[pos]**.
6. **survival** = 1 − Φ((myNextPickNo − adp) / σ), σ = max(adp/4, 3), Φ = normal CDF (use the
   Abramowitz-Stegun erf approximation, comment the constant source). adp null → 0.95.
   If isMyTurn, survival is w.r.t. myFollowingPickNo instead (survival of THIS pick is 1).
7. **needFactor** (my roster): fill my drafted players greedily into my roster_positions
   (dedicated slots first, then FLEX/SUPER_FLEX, then BN). For candidate pos:
   unfilled dedicated slot → 1.0; flex-eligible (RB/WR/TE→FLEX, +QB→SUPER_FLEX) and flex open
   → 0.9; else bench: 0.7, except QB/TE when I already have ≥2 at pos → 0.4, K/DEF → see 8.
8. **K/DEF suppression**: if `currentRound < rounds − 1` → needFactor 0.05 (hard suppress).
9. **tierStatus** (dataset tiers among undrafted at pos): candidate in the best remaining tier
   and that tier has ≤1 OTHER player left → 'LAST_IN_TIER' (mult 1.15); ≤2 others → 'TIER_THIN'
   (1.08); else null (1.0).
10. **runs**: per pos, count in the last 8 picks; report entries ≥4. runBoost (mult 1.05) when
    candidate's pos is running AND candidate tierStatus ≠ null.
11. **score** = `vbd × needFactor × tierMult × runMult × (0.6 + 0.4 × (1 − survival))`, where
    vbd floor for scoring purposes = max(vbd, 1).
12. **bestAtPosAtNextPick**: max vbd among undrafted at pos with survival ≥ 0.5, excluding the
    candidate itself; null if none. (Claude uses this as the "what if I wait" VONA signal.)
13. **candidates** = top 8 by score; then ensure the top player by raw vbd and the top player at
    each of QB/RB/WR/TE by score are present (append, cap 10, no duplicates). Sorted by score desc.

`test/engine.test.mjs` (B2): `node --test` suite with synthetic fixtures (build a fake 12-team
PPR league + mid-draft state; no network). MUST cover: snake pick math round-trips; replacement
drops as pool drains; K/DEF suppressed before final 2 rounds; rec=0 vs rec=1 flips a
RB-vs-possession-WR ordering; superflex boosts QB via adp_2qb + starter share; survival is
monotonic in adp and in pick distance; LAST_IN_TIER fires when a tier is nearly drained;
buildLeagueContext works from a mock draft's slots_* with league null.

### 3.4 `shared/strategy-prompt.js` (B3)
`export const SYSTEM_PROMPT = \`...\`` — start from research/strategy-playbook.md §"SYSTEM PROMPT v1"
verbatim, then append three short paragraphs: (a) the exact meaning of each payload field
(vbd, survival, needFactor, tierStatus, bestAtPosAtNextPick, runs, marketDisagreement, note, risk,
injuryStatus) and that these numbers are already league-scoring-adjusted; (b) instruction that
`note`/`risk`/`marketDisagreement` carry late-Aug-2026 expert context that may outrank stale
priors from training data — trust the payload over memory for player situations; (c) recommend
ONLY players present in the candidates list, `player` must be the exact `name` string given.
Do NOT restate the JSON output format beyond what v1 has (structured outputs enforces it).

### 3.5 `shared/prompt-builder.js` (B3)
```js
export function buildUserPayload({league, draftState, engineResult, pool}) // → string (the user message)
```
Compact human-readable JSON (JSON.stringify, 0 indent) with: `league` {teams, scoringLabel,
recPoints, isSuperflex, notable scoring keys where |value| differs from preset (bonuses, TE
premium `bonus_rec_te`)}, `draft` {round, pickNo, myslot, picksUntilMine, myNextPickNo,
myFollowingPickNo}, `myRoster` [{name,pos,slotFilled}] via same greedy fill as needFactor,
`openStarters` (my unfilled roster_positions), `opponentsBeforeMyNextPick`
[{slot, needs: unfilled starter positions}] from slotsBetween + slotPlayerIds, `runs`,
`positionSummary`, `candidates` — each: {name, pos, team, bye, projPts, vbd, adp, survival
(2dp), needFactor, tierStatus, bestAtPosAtNextPick, note, risk, injuryStatus,
marketDisagreement}. Target < 4KB. No player ids, no nulls-noise (omit null fields).

### 3.6 `shared/anthropic-client.js` (B3)
```js
export const MODELS = [
  {id: 'claude-opus-5',   label: 'Opus 5 (default — smartest)'},
  {id: 'claude-sonnet-5', label: 'Sonnet 5 (faster, cheaper)'},
  {id: 'claude-haiku-4-5',label: 'Haiku 4.5 (cheapest)'}]
export async function getRecommendation({apiKey, model, effort, system, userPayload, signal})
export function estimateCostUsd(model, usage)  // per-MTok: opus-5 5/25, sonnet-5 3/15, haiku 1/5
```
Request (non-streaming fetch, 60s AbortSignal.timeout unless caller passes signal):
- URL `https://api.anthropic.com/v1/messages`; headers: `content-type: application/json`,
  `x-api-key: <apiKey>`, `anthropic-version: 2023-06-01`,
  `anthropic-dangerous-direct-browser-access: true` (harmless belt-and-braces in extension ctx),
  plus for opus-5 only `anthropic-beta: server-side-fallback-2026-07-01`.
- Body: `{model, max_tokens: 2000, system: [{type:'text', text: system, cache_control:
  {type:'ephemeral'}}], messages: [{role:'user', content: userPayload}], output_config:
  {effort, format: {type:'json_schema', schema: REC_SCHEMA}}}` + for opus-5 only
  `fallbacks: 'default'`. NO thinking param, NO temperature.
- REC_SCHEMA: object {recommendations: array minItems 3 maxItems 3 of object {player: string,
  why: string, confidence: enum[high,medium,low]} (required all, additionalProperties false),
  strategyNote: string}, required both, additionalProperties false.
- Handle: !res.ok → typed errors — 401 `auth` (message: check your API key), 429 `rate` (read
  retry-after, single retry), 400/other `api:<status>` with response error message; ok but
  `stop_reason === 'refusal'` → error `refusal`; else JSON.parse the first content block of
  type 'text' → validate recommendations.length === 3 → resolve Recommendation.

### 3.7 B1: `manifest.json`, `service-worker.js`, `content.js`
manifest: mv3; name "Sleeper Draft Copilot"; version 1.0.0; permissions `["storage","sidePanel"]`;
host_permissions `["https://api.sleeper.app/*","https://api.anthropic.com/*"]` (NOT sleeper.com —
content script gets access via content_scripts matches); content_scripts on
`https://sleeper.com/draft/*` run_at document_idle; background service_worker type module;
side_panel default_path `sidepanel/panel.html`; action `{default_title: "Open Draft Copilot"}`.
No icons (Chrome default is fine; README notes it).
- `content.js` (NOT a module): read `location.href`, extract `/draft/nfl/(\d+)`; also re-check on
  SPA URL changes (setInterval 2s comparing href — Sleeper is an SPA). On new id:
  `chrome.runtime.sendMessage({type:'draftDetected', draftId, url: location.href})`. No DOM
  manipulation, no fetch, wrap all in try/catch (extension context can invalidate on reload).
- `service-worker.js`: `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})` on
  install + top-level; onMessage 'draftDetected' → `chrome.storage.local.set({lastDetectedDraft:
  {draftId, url, at: Date.now()}})` + `chrome.action.setBadgeText({text:'●'})` /
  setBadgeBackgroundColor green; clear badge when panel connects (message 'panelOpen').

### 3.8 B3: side panel
`panel.html/js/css` — dark UI, no frameworks. panel.js imports shared modules + chrome APIs.
Views: **Setup** (API key masked input w/ save/clear — storage key `anthropicApiKey`; model
select from MODELS, storage `model`; Sleeper username, storage `sleeperUsername`; draft
connect: shows `lastDetectedDraft` if present w/ Connect button + manual URL/id input via
`parseDraftIdFromUrl`) and **Draft** (main). Draft view sections:
1. Header: draft id, status chip, Round X Pick Y, scoringLabel, poll heartbeat dot,
   "ON THE CLOCK" banner (bright, when isMyTurn) / "N picks until yours".
2. Claude card: 3 ranked recs (name big, confidence chip, why), strategyNote italic below,
   model + cost so far (estimateCostUsd accumulated in storage `spendSession`), buttons:
   "Advise now" (manual), "Deep analysis" (same call, effort 'high').
3. Shortlist table (engine): name, pos, team, VBD (0dp), ADP, survive% , tier badge
   (LAST IN TIER red / THIN amber), risk icons, injury tag. Top 10.
4. My roster: roster_positions list with filled player names (greedy fill), open slots hollow.
5. Position runs strip when runs non-empty.
Flow: connect → `getDraft`, mySlot = resolveMySlot(username→getUser→user_id) with manual slot
dropdown fallback (1..teams) → league = draft.league_id ? getLeague : null → buildLeagueContext →
load dataset via `fetch(chrome.runtime.getURL('data/players-2026.json'))` → playersSlim from
storage cache (24h) else getPlayersSlim → getSeasonProjections(state.season, [QB,RB,WR,TE,K,DEF])
→ buildPlayerPool once. Poll `getDraftPicks` every 3s (status pre_draft: 10s; complete: stop):
diff pick count → rebuild DraftState + evaluate (re-run buildPlayerPool only if projections
refetched; drafted filtering happens in evaluate via draftedIds).
Claude trigger: auto when `picksUntilMine ≤ 1 && !recCache[currentPickNo]` and on manual click;
effort setting 'low' default for auto (latency), 'high' for Deep analysis. Cache recs by
`draftState.currentPickNo` + pick count so a new pick invalidates. Errors render inline
(auth → link text to Setup). Persist nothing sensitive beyond the key. If projections fetch
fails: continue with dataset-only pool (projPts null → vbd from ADP-rank curve: vbd =
max(180 − 1.4×overallAdpRank, 5) — comment this as the degraded mode) and show an amber
"projections unavailable — running on ADP + tiers" notice.

### 3.9 B4: `test/dry-run.mjs`, `README.md`, `docs/USAGE.md`
dry-run: node ≥18 CLI: `node test/dry-run.mjs <draftIdOrUrl> --slot N [--pick K] [--claude]`.
Imports shared modules from `extension/shared/`, dataset from `extension/data/`. Fetches real
draft + picks, truncates picks to K (default: all), buildLeagueContext (league fetch when
league_id), buildPlayerPool (live projections), evaluate, prints: league summary, board last-10
picks, my roster, candidates table (console.table), and the exact prompt payload size. With
`--claude` + env `ANTHROPIC_API_KEY`: calls getRecommendation (model env `COPILOT_MODEL` ??
claude-opus-5) and pretty-prints the 3 recs. Exit non-zero with readable message on failure.
README: what it is, install (chrome://extensions → dev mode → Load unpacked → `extension/`),
setup (get API key at console.anthropic.com → paste in panel; rotate keys that were ever
shared; set a spend limit), usage during a draft, mock-draft rehearsal instructions (start a
Sleeper mock, panel auto-detects), the architecture in 10 lines, cost estimate table per model,
troubleshooting (projections 404 degraded mode, "wrong slot" → manual dropdown, key errors),
and disclaimers (personal use; Sleeper API etiquette; not affiliated).
USAGE.md: a draft-day runbook: pre-draft checklist (test with mock, verify slot, prefund API
key), what each panel section means, how to read VBD/survival/tier badges, when to trust
`Deep analysis`, and how the advisor weighs league scoring.

## 4. Later phases
Auditor verifies against THIS file (contracts, formulas, security, MV3 validity) and runs
`node --test test/engine.test.mjs` plus a no-Claude dry-run against a real completed mock draft.
