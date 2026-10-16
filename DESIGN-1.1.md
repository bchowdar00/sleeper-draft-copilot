# v1.1 delta — "best possible pick" upgrade (extends DESIGN.md; where they conflict, THIS file wins)

Goals: Monte Carlo availability sim, close-call council (3 lenses + synthesis), smart call
scheduling for a 60s clock, richer payload. All conventions from DESIGN.md §1 still apply.
League context to optimize for: snake redraft, up to 16 teams, 60s pick timer.

FABLE-ONLY MANDATE (user decision, overrides DESIGN.md §3.6 default): `claude-fable-5-1` is the
DEFAULT model and the intended model for every advisor call — precompute, on-clock refresh, all
council lens calls, and synthesis. W2 reorders MODELS with fable first, label
'Fable 5.1 (default — deepest reasoning)', opus-5 second as 'fallback option'; keep all four
selectable. Latency is managed by effort (effort-low ≈ 17s on this payload, measured on the
predecessor `claude-fable-5`), the
precompute-at-2-picks schedule, and the 25s provisional guardrail — not by downgrading models.

## File ownership this round

| Builder | Files (ONLY these) |
|---|---|
| W1 engine | `extension/shared/engine.js` (add MC + integration), `test/engine.test.mjs` (add tests) |
| W2 ai | `extension/shared/anthropic-client.js`, `extension/shared/prompt-builder.js`, `extension/shared/strategy-prompt.js` |
| W3 panel | `extension/sidepanel/panel.js`, `extension/sidepanel/panel.html`, `extension/sidepanel/panel.css` |
| W4 harness+docs | `test/dry-run.mjs`, `README.md`, `docs/USAGE.md` |

## W1 — Monte Carlo simulation (engine.js)

New export:
```js
export function simulateToNextPick({ undrafted, draftState, league, opponentStates, iterations = 250, rng = Math.random })
// → { pAvail: Map<playerId, number>,            // P(still available at my next relevant pick)
//     expBestVbdByPos: { [pos]: {p25,p50,p75} },// distribution of best remaining vbd at pos at my pick
//     pTierSurvives: { [pos]: number } }        // P(≥1 player of the current best remaining tier left)
```
Mechanics (implement exactly):
- The picks to simulate: from `draftState.currentPickNo` up to (exclusive) the target pick —
  `myNextPickNo` when not my turn, else `myFollowingPickNo`; if target null → return neutral
  result (pAvail 1.0 for all, expBest = current best, pTierSurvives 1.0).
- `opponentStates`: array (aligned with the picking order of the simulated picks) of
  `{ slot, unfilledStarters: {pos: count} }` — W1 derives it inside `evaluate` from
  `slotPlayerIds` + roster_positions greedy fill (reuse the existing fill logic).
- Each simulated opponent pick: consider the top 12 remaining players by adp (null-adp players
  sorted last); weight for the i-th (0-based) = `exp(-i / 3)`, then multiply by need:
  ×2.0 if that pos has an unfilled dedicated starter for that team, ×1.2 if flex-fillable,
  ×0.45 if that team's pos starters are full, ×0.02 for K/DEF before the final 2 rounds.
  Draw one player by normalized weights using `rng()`; mark taken for this iteration; decrement
  that team's need.
- After the intervening picks in each iteration, record: availability of every current
  candidate-universe player (use all undrafted — cheap with a Set), best remaining vbd per pos,
  and whether the pre-sim best remaining tier at each pos still has a member.
- p25/p50/p75 = quantiles over iterations (sort once). 250 iterations × ≤31 picks must run
  < 100ms for a 500-player pool — keep the inner loop allocation-free (reuse arrays).
- `rng` is injectable for deterministic tests (tests use a seeded mulberry32).

Integration in `evaluate`: after computing candidates as today, run the sim once and
overwrite for each candidate: `survival = pAvail.get(id) ?? closedFormValue` and
`bestAtPosAtNextPick = expBestVbdByPos[pos].p50 ?? old value`. Add to EngineResult:
`mc: { pTierSurvives, expBestVbdByPos, iterations }`. Keep the closed-form path as automatic
fallback when the sim returns neutral. Score formula unchanged (now uses MC survival).
New tests: seeded-rng determinism (same seed → same pAvail); a player with adp far below the
window → pAvail ≈ 0; adp far beyond → ≈ 1; need-bias sanity (opponent with RB hole drains RBs
faster than a no-need baseline); performance guard (250 iters over a 400-player synthetic pool
< 250ms); quantile ordering p25 ≤ p50 ≤ p75. All existing 13 tests must still pass unchanged.

## W2 — council + payload v2 + prompt

### anthropic-client.js
Keep `getRecommendation` exactly as-is. Add:
```js
export const LENSES = [
  { key: 'floor',   title: 'FLOOR & STRUCTURE',  directive: '...' },
  { key: 'ceiling', title: 'CEILING & LEVERAGE', directive: '...' },
  { key: 'game',    title: 'GAME THEORY',        directive: '...' }
];
export async function getCouncilRecommendation({ apiKey, model, system, userPayload, signal, onProgress })
// → { recommendations, strategyNote, model, usage,           // final synthesized result (same shape)
//     lensResults: [{lens, recommendations, strategyNote}] } // the three lens outputs
```
- Fire the 3 lens calls IN PARALLEL: each is `getRecommendation` with effort 'medium' and
  `system` = base system + '\n\nLENS DIRECTIVE — ' + title + ': ' + directive. Directives
  (write them, 3-5 sentences each): floor = roster-construction integrity, starter floors,
  risk flags weigh double, bust avoidance; ceiling = league-winning upside, market-disagreement
  smash values, tier-break exploitation, accept variance; game = opponent needs, runs, MC
  survival/pTierSurvives math, value-of-waiting across the next two turns.
- `onProgress(k)` called as each lens resolves (panel shows 1/3, 2/3…). A lens that rejects is
  dropped (council proceeds with ≥2; if ≤1 survives, throw the first error).
- Synthesis call: effort 'low', same REC_SCHEMA, system = base system + a synthesis directive;
  user message = original payload + '\n\nCOUNCIL OUTPUTS (three independent advisors):\n' +
  JSON of lens results + instruction: where advisors disagree, resolve the disagreement
  explicitly in `why` (name the trade-off, not the advisors); output the final 3.
- `usage` = summed tokens across all calls (input_tokens/output_tokens totals) so
  estimateCostUsd prices the whole council.

### prompt-builder.js — payload v2 (extend, do not rename existing fields)
Add to the payload object:
- `myUpcomingPicks`: next 3 of my pick numbers (from draft-math myPickNos ∩ > currentPickNo).
- `tiersRemaining`: { pos: [{tier, left}] } for QB/RB/WR/TE — counts of UNDRAFTED dataset-tiered
  players, lowest (best) 3 tier numbers per pos only.
- `mc`: { pTierSurvives, note: 'survival & bestAtPosAtNextPick come from a ' + iterations + '-run opponent-need-biased draft simulation' } from engineResult.mc when present.
- per candidate: `byeOverlap` (count of my current starters sharing the candidate's bye week,
  omit when 0), `handcuff: true` (candidate is an RB on the same NFL team as one of my RBs,
  omit otherwise), `stacksWithMyQB: true` (candidate WR/TE on same team as my QB, omit
  otherwise), `trendingAdds: <count>` when the caller supplies a trending map (new optional
  arg `{ trending }`: Map<player_id, add_count>; omit field when absent).
- Size target now < 10KB; keep 0-indent JSON.

### strategy-prompt.js — append two short paragraphs
(1) DATA VINTAGE: `note`/`tier`/`risk`/`marketDisagreement` were compiled 2026-08-30;
`injuryStatus` and `trendingAdds` are LIVE from Sleeper at draft time — when they conflict with
a note (e.g. a player cut or hurt after Aug 30), the live fields win. NFL final roster cuts
land Sept 1: treat a healthy-looking note as stale if injuryStatus/trending says otherwise.
(2) PLAN THE NEXT TWO PICKS: `strategyNote` must, in addition to the current-pick context, name
what to target at the user's next one or two picks (`myUpcomingPicks`) given `tiersRemaining`
and `mc.pTierSurvives` — one sentence, concrete positions/names.

## W3 — panel scheduling, council UI, guardrail

- Settings additions (chrome.storage.local): `precomputeEffort` ('high' default; select
  low/medium/high), `councilOnCloseCalls` (bool, default true), keep `model` as-is.
- Call scheduling (replace the current single trigger):
  * `picksUntilMine === 2` → fire PRECOMPUTE: getRecommendation effort = precomputeEffort,
    AbortSignal.timeout(120000). Cache {pickNo: myNextPickNo, boardCount, rec}.
  * `picksUntilMine <= 1`: precompute still current (boardCount unchanged) → render it.
    Else → REFRESH: effort 'low', timeout 45s.
  * COUNCIL auto-trigger: when `isMyTurn && councilOnCloseCalls && !councilCache[pickNo]` and
    the engine's top-2 candidate scores are within 8% (`(s0-s1)/s0 < 0.08`) →
    getCouncilRecommendation (show progress '2/3 advisors…'). Render the synthesized result
    with a 'COUNCIL' chip; collapsible section shows each lens's #1 + one-line why.
  * Manual buttons: 'Advise now' (single, low), 'Council' (always available, replaces the old
    Deep analysis button; tooltip: '3 advisor lenses + synthesis, ~4 calls').
  * GUARDRAIL: whenever isMyTurn and no rec rendered within 25s (timer from turn start), render
    the engine's top-3 as a provisional card labeled 'engine provisional — Claude still
    thinking' (name, pos, vbd, survival, tierStatus, one-line from note); replace when Claude lands.
- Trending: fetch `/v1/players/nfl/trending/add?limit=50` at connect + every 10 min (add a thin
  wrapper INLINE in panel.js via fetch to the sleeper base — do NOT edit sleeper-client.js, it
  is not yours this round); build Map<player_id, count>, pass as `trending` to buildUserPayload.
- Keep every existing behavior (poll cadence, cost ticker — council cost must accumulate too,
  degraded mode, slot fallback) working.

## W4 — harness + docs

- dry-run.mjs: add `--council` (runs getCouncilRecommendation, prints the 3 lens #1s + final),
  `--effort <low|medium|high>` (single-call path), and print new payload fields + an 'MC' block
  (pTierSurvives per pos, iterations) in the report. Also print per-run wall-clock ms for the
  engine evaluate and for each Claude call.
- README/USAGE: document precompute-at-2-picks scheduling, council (what it is, when it fires,
  ~4× cost), the 25s provisional guardrail, new settings, updated per-draft cost table adding a
  'Fable + council on close calls' row (~$3-5/draft, 16-team), and a note: dataset compiled
  Aug 30 — if drafting after Sept 1 roster cuts, live injuryStatus/trending cover it, and the
  dataset can be refreshed by re-running the research pipeline.

## Verification (auditor, after all four)
Same bar as v1.0: integration trace on every new/changed contract (LENSES/council shapes,
payload v2 fields, engine.mc, panel scheduling state machine), `node --test` (old 13 + new all
green), real dry-run + a seeded-MC determinism check, formulas vs THIS file (weights exp(-i/3),
need ×2.0/×1.2/×0.45/×0.02, 8% council threshold, timers 120s/45s/25s), security regression
grep (key handling unchanged), no file touched outside ownership.
