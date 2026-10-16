// Sleeper Draft Copilot — side panel controller.
// Owns the poll loop, engine calls, and Claude calls (this page is CORS-exempt and, while
// open, keeps the extension alive). Imports shared modules by their DESIGN.md contracts.

import {
  getNflState,
  getDraft,
  getDraftPicks,
  getLeague,
  getUser,
  getSeasonProjections,
  getPlayersSlim,
  parseDraftIdFromUrl,
  SLEEPER_BASE
} from '../shared/sleeper-client.js';
import { buildLeagueContext, resolveMySlot, buildDraftState } from '../shared/draft-math.js';
import { buildPlayerPool, evaluate } from '../shared/engine.js';
import { buildUserPayload } from '../shared/prompt-builder.js';
import {
  MODELS,
  LENSES,
  getRecommendation,
  getCouncilRecommendation,
  estimateCostUsd
} from '../shared/anthropic-client.js';
import { SYSTEM_PROMPT } from '../shared/strategy-prompt.js';

const PROJ_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const PLAYERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const POLL_ACTIVE_MS = 3000;
const POLL_PREDRAFT_MS = 10000;
const TRENDING_REFRESH_MS = 10 * 60 * 1000; // 10 min
// Call-scheduling timers (DESIGN-1.1 §W3).
const PRECOMPUTE_TIMEOUT_MS = 120000; // precompute at picksUntilMine === 2
const REFRESH_TIMEOUT_MS = 45000; // cheap on-clock refresh at picksUntilMine <= 1
const COUNCIL_TIMEOUT_MS = 120000; // whole-council budget (3 lenses + synthesis)
const GUARDRAIL_MS = 25000; // engine-provisional card if no rec by now
const COUNCIL_CLOSENESS = 0.08; // top-2 within 8% → auto-council

// ---- mutable session state ----
const S = {
  draftId: null,
  draft: null, // raw Sleeper draft
  league: null, // LeagueContext
  rawLeague: null, // raw Sleeper league or null (mock)
  mySlot: null,
  season: null,
  dataset: null,
  playersSlim: null,
  projections: null, // Map<player_id,{stats,player}> or null (degraded)
  projectionsFailed: false,
  pool: null,
  draftState: null,
  engineResult: null,
  lastPickCount: -1,
  recCache: {}, // key -> Recommendation
  councilCache: {}, // pickNo -> council Recommendation
  currentRecKey: null,
  pollTimer: null,
  heartbeatOn: false,
  claudeInFlight: false,
  councilInFlight: false,
  apiKey: '',
  model: MODELS[0].id, // default from MODELS[0] (W2 makes that Fable); never hardcoded
  // v1.1 settings + scheduling state
  precomputeEffort: 'xhigh', // latency measured on predecessor claude-fable-5: high ~31s, xhigh ~55s (fits the 2-3-picks-out window), max ~137s (doesn't reliably fit)
  councilOnCloseCalls: true, // auto-council on close calls (default true)
  trending: null, // Map<player_id, add_count>
  trendingTimer: null,
  precompute: null, // { pickNo, boardCount, rec } — primed at picksUntilMine === 2
  precomputeInFlight: false,
  clockStartAt: 0, // when we observed the current on-the-clock pick begin
  councilTimer: null, // armed "30s-left-on-predecessor" council trigger
  councilArmedFor: null,
  guardTimer: null, // 25s provisional guardrail timer
  turnStartPick: null // pickNo the guardrail timer is armed for
};

// ---------- storage helpers ----------
function sGet(keys) {
  return chrome.storage.local.get(keys);
}
function sSet(obj) {
  return chrome.storage.local.set(obj);
}
function sRemove(keys) {
  return chrome.storage.local.remove(keys);
}

// ---------- tiny DOM helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ============================================================
// SETUP VIEW
// ============================================================
async function initSetup() {
  // model select
  const sel = $('model-select');
  clear(sel);
  for (const m of MODELS) {
    const opt = el('option', null, m.label);
    opt.value = m.id;
    sel.appendChild(opt);
  }

  const stored = await sGet([
    'anthropicApiKey',
    'model',
    'sleeperUsername',
    'lastDetectedDraft',
    'precomputeEffort',
    'councilOnCloseCalls'
  ]);
  if (stored.anthropicApiKey) {
    // Never round-trip the key back into the DOM; empty save clicks are ignored above.
    $('api-key').placeholder = '•••••• (key saved — paste to replace)';
    $('key-status').textContent = 'Key saved.';
    S.apiKey = stored.anthropicApiKey;
  }
  if (stored.model) {
    sel.value = stored.model;
    S.model = stored.model;
  }
  // The user enters their own Sleeper username; any saved value is restored here.
  if (stored.sleeperUsername) {
    $('sleeper-username').value = stored.sleeperUsername;
  }

  // v1.1 settings: precompute effort + auto-council toggle.
  if (stored.precomputeEffort) S.precomputeEffort = stored.precomputeEffort;
  if (typeof stored.councilOnCloseCalls === 'boolean') {
    S.councilOnCloseCalls = stored.councilOnCloseCalls;
  }
  const effSel = $('precompute-effort');
  if (effSel) effSel.value = S.precomputeEffort;
  const councilToggle = $('council-toggle');
  if (councilToggle) councilToggle.checked = S.councilOnCloseCalls;

  renderDetectedDraft(stored.lastDetectedDraft);

  // key handlers
  $('save-key').addEventListener('click', async () => {
    const v = $('api-key').value.trim();
    if (!v) return;
    await sSet({ anthropicApiKey: v });
    S.apiKey = v;
    $('key-status').textContent = 'Key saved.';
  });
  $('clear-key').addEventListener('click', async () => {
    await sRemove('anthropicApiKey');
    S.apiKey = '';
    $('api-key').value = '';
    $('key-status').textContent = 'Key cleared.';
  });
  sel.addEventListener('change', async () => {
    S.model = sel.value;
    await sSet({ model: sel.value });
  });
  const effSelEl = $('precompute-effort');
  if (effSelEl) {
    effSelEl.addEventListener('change', async () => {
      S.precomputeEffort = effSelEl.value;
      await sSet({ precomputeEffort: effSelEl.value });
    });
  }
  const councilToggleEl = $('council-toggle');
  if (councilToggleEl) {
    councilToggleEl.addEventListener('change', async () => {
      S.councilOnCloseCalls = councilToggleEl.checked;
      await sSet({ councilOnCloseCalls: councilToggleEl.checked });
    });
  }
  $('save-username').addEventListener('click', async () => {
    await sSet({ sleeperUsername: $('sleeper-username').value.trim() });
    $('connect-status').textContent = 'Username saved.';
  });
  $('connect-manual').addEventListener('click', () => {
    const id = parseDraftIdFromUrl($('draft-input').value.trim());
    if (!id) {
      $('connect-status').textContent = 'Could not read a draft id from that.';
      return;
    }
    connect(id);
  });
  $('back-to-setup').addEventListener('click', showSetup);

  // react to newly-detected drafts while the panel is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lastDetectedDraft) {
      renderDetectedDraft(changes.lastDetectedDraft.newValue);
    }
  });

  // let the service worker clear its badge
  try {
    chrome.runtime.sendMessage({ type: 'panelOpen' });
  } catch (_) {
    /* SW may be asleep; harmless */
  }
}

function renderDetectedDraft(detected) {
  const box = $('detected-slot');
  clear(box);
  if (!detected || !detected.draftId) {
    box.appendChild(el('div', 'muted', 'No draft detected yet. Open a Sleeper draft room.'));
    return;
  }
  const wrap = el('div', 'detected');
  wrap.appendChild(el('div', null, 'Detected draft: ' + detected.draftId));
  const btn = el('button', 'primary', 'Connect');
  btn.style.marginTop = '6px';
  btn.addEventListener('click', () => connect(detected.draftId));
  wrap.appendChild(btn);
  box.appendChild(wrap);
}

function showSetup() {
  stopPoll();
  $('setup-view').classList.remove('hidden');
  $('draft-view').classList.add('hidden');
}
function showDraft() {
  $('setup-view').classList.add('hidden');
  $('draft-view').classList.remove('hidden');
}

// ============================================================
// CONNECT / LOAD
// ============================================================
async function connect(draftId) {
  $('connect-status').textContent = 'Connecting…';
  try {
    S.draftId = draftId;
    S.recCache = {};
    S.councilCache = {};
    S.precompute = null;
    S.precomputeInFlight = false;
    S.turnStartPick = null;
    if (S.guardTimer) {
      clearTimeout(S.guardTimer);
      S.guardTimer = null;
    }
    S.lastPickCount = -1;

    const state = await getNflState();
    S.season = state && state.season ? state.season : new Date().getFullYear();

    S.draft = await getDraft(draftId);

    // Resolve my slot from the saved username (fallback: manual dropdown).
    const { sleeperUsername } = await sGet('sleeperUsername');
    S.mySlot = null;
    if (sleeperUsername) {
      try {
        const user = await getUser(sleeperUsername);
        if (user && user.user_id) {
          S.mySlot = resolveMySlot({ draft: S.draft, myUserId: user.user_id });
        }
      } catch (_) {
        /* fall through to manual slot */
      }
    }

    // League context (mock drafts have no league_id).
    S.rawLeague = S.draft.league_id ? await getLeague(S.draft.league_id) : null;
    S.league = buildLeagueContext({ league: S.rawLeague, draft: S.draft });

    // Dataset (bundled).
    const dsRes = await fetch(chrome.runtime.getURL('data/players-2026.json'));
    S.dataset = await dsRes.json();
    // Optional per-team offensive context (identity/implication one-liners).
    try {
      const tcRes = await fetch(chrome.runtime.getURL('data/team-context-2026.json'));
      S.teamContext = tcRes.ok ? (await tcRes.json()).teams || null : null;
    } catch (_) {
      S.teamContext = null;
    }

    // Players slim (24h cache).
    S.playersSlim = await loadPlayersSlim();

    // Season projections (degrades gracefully).
    S.projectionsFailed = false;
    try {
      S.projections = await getSeasonProjections(S.season, PROJ_POSITIONS);
    } catch (_) {
      S.projections = new Map();
      S.projectionsFailed = true;
    }
    // Sleeper can also answer 200 with an empty/invalid body (no throw) — that is
    // equally a projections failure, and the engine builds a dataset-only pool for it.
    if (S.projections.size === 0) S.projectionsFailed = true;

    // Build the merged player pool once.
    S.pool = buildPlayerPool({
      projections: S.projections,
      playersSlim: S.playersSlim,
      dataset: S.dataset,
      league: S.league
    });

    // Degraded mode: projections unavailable → synthesize projPts from an ADP-rank curve so
    // the engine's replacement/survival/tier machinery still runs (DESIGN.md §3.8).
    if (S.projectionsFailed) applyDegradedProjPts(S.pool);

    // Trending adds (best-effort): prime once now, refresh every 10 min.
    startTrending();

    showDraft();
    $('conn-model').textContent = modelLabel(S.model);
    setupDraftButtons();
    if (S.projectionsFailed) {
      showNotice('amber', 'Projections unavailable — running on ADP + tiers.');
    }
    startPoll();
  } catch (err) {
    $('connect-status').textContent = 'Connect failed: ' + humanError(err);
  }
}

async function loadPlayersSlim() {
  const { playersCache } = await sGet('playersCache');
  if (
    playersCache &&
    playersCache.fetchedAt &&
    Date.now() - playersCache.fetchedAt < PLAYERS_CACHE_TTL &&
    playersCache.players
  ) {
    return playersCache;
  }
  const fresh = await getPlayersSlim();
  fresh.fetchedAt = Date.now(); // caller stamps (per §3.1)
  try {
    await sSet({ playersCache: fresh });
  } catch (_) {
    /* ~a few MB; if quota blocks it, keep in memory only */
  }
  return fresh;
}

// Degraded-mode value curve (DESIGN.md §3.8): vbd = max(180 − 1.4 × overallAdpRank, 5).
// See DEVIATION note in the build report: we feed this as a projPts proxy to the engine
// (which owns vbd per §3.3) rather than overwriting engine-computed vbd, so survival/need/
// tier/run scoring stay intact and cross-position ordering keeps proper VBD behavior.
function applyDegradedProjPts(pool) {
  const ranked = [...pool].sort((a, b) => {
    const aa = a.adp == null ? Infinity : a.adp;
    const bb = b.adp == null ? Infinity : b.adp;
    return aa - bb;
  });
  ranked.forEach((p, i) => {
    p.projPts = Math.max(180 - 1.4 * (i + 1), 5);
  });
}

// ============================================================
// TRENDING (inline wrapper — sleeper-client.js is not ours this round)
// ============================================================
function startTrending() {
  if (S.trendingTimer) {
    clearInterval(S.trendingTimer);
    S.trendingTimer = null;
  }
  fetchTrending();
  S.trendingTimer = setInterval(fetchTrending, TRENDING_REFRESH_MS);
}

// GET /v1/players/nfl/trending/add?limit=50 → Map<player_id, add_count>. Best-effort:
// any failure leaves the previous map (or null) in place — trending is an omit-when-absent hint.
async function fetchTrending() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(SLEEPER_BASE + '/v1/players/nfl/trending/add?limit=50', {
      signal: controller.signal
    });
    if (!res.ok) return;
    const arr = await res.json();
    if (!Array.isArray(arr)) return;
    const map = new Map();
    for (const row of arr) {
      if (row && row.player_id != null) {
        map.set(String(row.player_id), Number(row.count) || 0);
      }
    }
    S.trending = map;
  } catch (_) {
    /* trending is best-effort; keep whatever we had */
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// POLL LOOP
// ============================================================
function startPoll() {
  stopPoll();
  pollTick();
}
function stopPoll() {
  if (S.pollTimer) {
    clearTimeout(S.pollTimer);
    S.pollTimer = null;
  }
}
async function pollTick() {
  let cadence = POLL_ACTIVE_MS;
  try {
    // Refresh draft status while pre-draft so we notice the start.
    if (S.draft && S.draft.status === 'pre_draft') {
      try {
        S.draft = await getDraft(S.draftId);
      } catch (_) {
        /* keep last */
      }
      cadence = POLL_PREDRAFT_MS;
    }

    const picks = await getDraftPicks(S.draftId);
    beatHeartbeat();

    if (picks.length !== S.lastPickCount) {
      S.lastPickCount = picks.length;
      // A new pick landing means the next drafter's clock starts ~now (±poll cadence).
      S.clockStartAt = Date.now();
      recompute(picks);
    }

    // Completion: stop polling once the board is full.
    const totalPicks = S.league.teams * S.league.rounds;
    const done =
      (S.draft && S.draft.status === 'complete') ||
      (S.draftState && S.draftState.currentPickNo > totalPicks);
    if (done) {
      renderHeader(true);
      stopPoll();
      return;
    }
  } catch (err) {
    showNotice('error', 'Poll error: ' + humanError(err));
  }
  S.pollTimer = setTimeout(pollTick, cadence);
}

function recompute(picks) {
  S.draftState = buildDraftState({ draft: S.draft, picks, mySlot: S.mySlot });
  S.engineResult = evaluate({
    pool: S.pool,
    league: S.league,
    draftState: S.draftState
  });
  renderDraft();
  scheduleCalls();
}

// ============================================================
// CLAUDE — call scheduling state machine (DESIGN-1.1 §W3)
// ============================================================
function recKey() {
  return S.draftState.currentPickNo + ':' + S.lastPickCount;
}

// Compact payload for every advisor call, with the live trending map when present.
function buildPayload() {
  return buildUserPayload({
    league: S.league,
    draftState: S.draftState,
    engineResult: S.engineResult,
    pool: S.pool,
    trending: S.trending,
    teamContext: S.teamContext
  });
}

// Engine top-2 within 8% → a close call. NOTE: not wired — the council currently runs on
// every pick (gated only by the councilOnCloseCalls setting), so this helper is unused.
function isCloseCall() {
  const c = S.engineResult && S.engineResult.candidates;
  if (!c || c.length < 2) return false;
  const s0 = c[0].score;
  const s1 = c[1].score;
  if (!(s0 > 0)) return false;
  return (s0 - s1) / s0 < COUNCIL_CLOSENESS;
}

// Whether a real Claude/council rec already exists for this pick.
function hasRealRec(pickNo) {
  if (S.councilCache[pickNo]) return true;
  return !!S.recCache[pickNo + ':' + S.lastPickCount];
}

// A rec stays actionable while every player it recommends is still on the board —
// the invalidation criterion for precomputes and late-landing calls. A 2-picks-out
// deep analysis whose targets all survived is still the right advice.
function recStillValid(rec) {
  if (!rec || !Array.isArray(rec.recommendations) || !S.draftState || !S.pool) return false;
  const drafted = S.draftState.draftedIds;
  const byName = new Map(S.pool.map((p) => [p.name.toLowerCase(), p]));
  for (const r of rec.recommendations) {
    const p = r && r.player ? byName.get(String(r.player).toLowerCase()) : null;
    if (p && drafted.has(p.id)) return false;
  }
  return true;
}

// Called on every recompute. Arms the guardrail, then drives precompute / refresh /
// auto-council based on picksUntilMine (DESIGN-1.1 §W3).
function scheduleCalls() {
  if (!S.draftState) return;
  const ds = S.draftState;

  // 25s provisional guardrail runs regardless of API key so the user is never left blank.
  manageGuardrail(ds);

  if (!S.apiKey) return;
  if (!Number.isFinite(ds.picksUntilMine)) return; // slot not chosen yet

  const pum = ds.picksUntilMine;

  if (ds.isMyTurn) {
    const pk = ds.currentPickNo;
    if (S.councilCache[pk]) {
      // Early-convened councils can go stale if a recommended player was just sniped.
      if (recStillValid(S.councilCache[pk])) {
        renderRecs(S.councilCache[pk], { council: true });
        return;
      }
      delete S.councilCache[pk];
    }
    // My clock just started: fire the council NOW (cancels the 30s-left backstop —
    // an insta-picking predecessor can never beat this trigger).
    if (S.councilTimer) {
      clearTimeout(S.councilTimer);
      S.councilTimer = null;
      S.councilArmedFor = null;
    }
    if (S.councilOnCloseCalls && !S.councilInFlight) {
      runCouncil(pk, false);
      // No return: the single-call path below keeps a rec on screen while the council runs.
    }
  }

  // 2-3 picks out (window, not ===2: two picks can land in one poll) → prime deep rec.
  if (pum >= 2 && pum <= 3) {
    firePrecompute(ds);
  } else if (pum <= 1) {
    consumePrecomputeOrRefresh(ds);
    if (!ds.isMyTurn) armCouncilTrigger(ds);
  }
}

// Event-driven council launch for EVERY pick of mine: fire at "30 seconds left on the
// predecessor's clock" (estimated from when we observed their clock start — most drafters
// have already picked by then, so the council usually sees the complete board), with the
// my-clock-started branch in scheduleCalls as the always-wins second trigger. Untimed
// rooms fire immediately.
function armCouncilTrigger(ds) {
  if (!S.councilOnCloseCalls || !S.apiKey) return;
  const target = ds.myNextPickNo;
  if (target == null || S.councilCache[target] || S.councilInFlight) return;
  if (S.councilArmedFor === target && S.councilTimer) return;
  if (S.councilTimer) clearTimeout(S.councilTimer);
  const t = S.draft && S.draft.settings ? Number(S.draft.settings.pick_timer) : 0;
  const elapsed = Date.now() - (S.clockStartAt || Date.now());
  const delay = t > 0 ? Math.max(0, (t - 30) * 1000 - elapsed) : 0;
  S.councilArmedFor = target;
  S.councilTimer = setTimeout(() => {
    S.councilTimer = null;
    S.councilArmedFor = null;
    const cur = S.draftState;
    if (!cur || cur.myNextPickNo !== target) return;
    if (!cur.isMyTurn && !(Number.isFinite(cur.picksUntilMine) && cur.picksUntilMine <= 1)) return;
    if (!S.councilCache[target] && !S.councilInFlight) runCouncil(target, false);
  }, delay);
}

// picksUntilMine === 2 → prime a full-effort rec for my next pick in the background.
function firePrecompute(ds) {
  const target = ds.myNextPickNo;
  if (target == null) return;
  if (S.precompute && S.precompute.pickNo === target) return; // already primed
  if (S.precomputeInFlight) return;
  runPrecompute(target);
}

async function runPrecompute(target) {
  S.precomputeInFlight = true;
  const boardCount = S.lastPickCount;
  try {
    const userPayload = buildPayload();
    const rec = await getRecommendation({
      apiKey: S.apiKey,
      model: S.model,
      effort: S.precomputeEffort,
      system: SYSTEM_PROMPT,
      userPayload,
      signal: AbortSignal.timeout(PRECOMPUTE_TIMEOUT_MS)
    });
    S.precompute = { pickNo: target, boardCount, rec };
    await addSpend(estimateCostUsd(S.model, rec.usage));
  } catch (_) {
    // Best-effort priming. Tombstone the target so a persistent error can't loop refires;
    // the on-clock refresh covers it.
    S.precompute = { pickNo: target, boardCount, rec: null };
  } finally {
    S.precomputeInFlight = false;
    // The consume path defers to an in-flight precompute — resume scheduling now it landed.
    if (S.draftState) scheduleCalls();
  }
}

// picksUntilMine <= 1 → use the precompute if its targets survived, else a cheap 'low' refresh.
function consumePrecomputeOrRefresh(ds) {
  const key = recKey();
  if (S.recCache[key]) {
    S.currentRecKey = key;
    renderRecs(S.recCache[key]);
    return;
  }
  if (S.claudeInFlight) return;
  // Precompute still cooking → wait for it (its finally re-runs scheduleCalls) instead of
  // firing a duplicate paid refresh for the same pick.
  if (S.precomputeInFlight) return;
  const pc = S.precompute;
  if (pc && pc.pickNo === ds.myNextPickNo && pc.rec && recStillValid(pc.rec)) {
    S.recCache[key] = pc.rec;
    S.currentRecKey = key;
    clearNotice();
    renderRecs(pc.rec, { precomputed: true });
    return;
  }
  // 'high' ~31s with this payload (latency measured on predecessor claude-fable-5) — fits because the refresh normally
  // starts one pick early (predecessor's clock + yours); the 25s guardrail covers the tail.
  runClaude('high', false, REFRESH_TIMEOUT_MS);
}

// Single-call advisor path (manual "Advise now", refresh, or forced re-run).
async function runClaude(effort, force, timeoutMs) {
  if (S.claudeInFlight) return;
  if (!S.apiKey) {
    showNotice('error-setup', 'No API key. Add one in Setup.');
    return;
  }
  const key = recKey();
  if (!force && S.recCache[key]) {
    S.currentRecKey = key;
    renderRecs(S.recCache[key]);
    return;
  }
  S.claudeInFlight = true;
  setBusy(true);
  try {
    const userPayload = buildPayload();
    const rec = await getRecommendation({
      apiKey: S.apiKey,
      model: S.model,
      effort,
      system: SYSTEM_PROMPT,
      userPayload,
      signal: AbortSignal.timeout(timeoutMs || 60000)
    });
    S.recCache[key] = rec;
    S.currentRecKey = key;
    await addSpend(estimateCostUsd(S.model, rec.usage));
    if (recStillValid(rec)) {
      // The council's synthesis outranks a single call — never clobber a rendered council rec.
      if (!S.draftState || !S.councilCache[S.draftState.currentPickNo]) {
        clearNotice();
        renderRecs(rec);
      }
    }
    // Stale (a recommended player got drafted while we waited): don't render it and let
    // the post-finally reschedule fire a current-board call instead.
  } catch (err) {
    renderClaudeError(err);
  } finally {
    S.claudeInFlight = false;
    setBusy(false);
    // Re-evaluate scheduling on my turn: escalate close calls to the council, or replace a
    // discarded stale rec — scheduleCalls() is guarded by the caches so this terminates.
    if (S.draftState && S.draftState.isMyTurn && !S.councilCache[S.draftState.currentPickNo]) {
      scheduleCalls();
    }
  }
}

// Council path: 3 lenses in parallel + synthesis (DESIGN-1.1 §W2/§W3). Auto on close calls
// (force false) or from the manual "Council" button (force true). Cost accumulates too.
async function runCouncil(pickNo, force) {
  // Own flag (not claudeInFlight): a council must not block the single-call path that keeps
  // a rec on screen while it deliberates, and vice versa.
  if (S.councilInFlight) return;
  if (!S.apiKey) {
    showNotice('error-setup', 'No API key. Add one in Setup.');
    return;
  }
  if (!force && S.councilCache[pickNo]) {
    renderRecs(S.councilCache[pickNo], { council: true });
    return;
  }
  S.councilInFlight = true;
  setBusy(true);
  setCouncilProgress(0);
  try {
    const userPayload = buildPayload();
    const rec = await getCouncilRecommendation({
      apiKey: S.apiKey,
      model: S.model,
      system: SYSTEM_PROMPT,
      userPayload,
      signal: AbortSignal.timeout(COUNCIL_TIMEOUT_MS),
      onProgress: (k) => setCouncilProgress(k)
    });
    S.councilCache[pickNo] = rec;
    await addSpend(estimateCostUsd(S.model, rec.usage));
    // Render only if the draft is still sitting on this pick (I haven't picked meanwhile).
    if (S.draftState && S.draftState.currentPickNo === pickNo) {
      clearNotice();
      renderRecs(rec, { council: true });
    }
  } catch (err) {
    renderClaudeError(err);
  } finally {
    S.councilInFlight = false;
    setBusy(false);
  }
}

// ---- provisional guardrail (adapts to the room's pick timer) ----
// 25s fits a 60s clock; a 30s room needs the provisional up sooner. pick_timer 0 = untimed.
function guardrailMs() {
  const t = S.draft && S.draft.settings ? Number(S.draft.settings.pick_timer) : 0;
  if (!Number.isFinite(t) || t <= 0) return GUARDRAIL_MS;
  return Math.max(8000, Math.min(GUARDRAIL_MS, (t - 12) * 1000));
}

function manageGuardrail(ds) {
  if (ds.isMyTurn) {
    if (S.turnStartPick !== ds.currentPickNo) {
      S.turnStartPick = ds.currentPickNo;
      if (S.guardTimer) clearTimeout(S.guardTimer);
      const pk = ds.currentPickNo;
      S.guardTimer = setTimeout(() => maybeRenderProvisional(pk), guardrailMs());
    }
  } else {
    if (S.guardTimer) {
      clearTimeout(S.guardTimer);
      S.guardTimer = null;
    }
    S.turnStartPick = null;
  }
}

function maybeRenderProvisional(pickNo) {
  S.guardTimer = null;
  if (!S.draftState || S.draftState.currentPickNo !== pickNo || !S.draftState.isMyTurn) return;
  if (hasRealRec(pickNo)) return;
  renderProvisional();
}

async function addSpend(delta) {
  const { spendSession } = await sGet('spendSession');
  const total = (spendSession || 0) + (delta || 0);
  await sSet({ spendSession: total });
  return total;
}

function renderClaudeError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg === 'auth') {
    showNotice(
      'error-setup',
      'Auth error — ' + (err.hint || 'check your API key') + '. '
    );
  } else if (msg === 'rate') {
    showNotice('error', 'Rate limited. Try again in a moment.');
  } else if (msg === 'refusal') {
    showNotice('error', 'Claude declined to answer this one. Try Council.');
  } else {
    showNotice('error', 'Advisor error: ' + (err.hint || msg));
  }
}

// ============================================================
// RENDERING — DRAFT VIEW
// ============================================================
function renderDraft() {
  renderHeader(false);
  renderSlotPicker();
  renderShortlist();
  renderRoster();
  renderRuns();
  // re-show a cached rec for this pick if present (council preferred, keyed by pickNo).
  const pk = S.draftState.currentPickNo;
  if (S.councilCache[pk]) {
    renderRecs(S.councilCache[pk], { council: true });
  } else {
    const key = recKey();
    if (S.recCache[key]) renderRecs(S.recCache[key]);
  }
}

function renderHeader(complete) {
  const ds = S.draftState;
  const h = $('dheader');
  clear(h);

  const top = el('div', 'dheader-top');
  top.appendChild(el('span', 'chip', 'Draft ' + S.draftId));
  const status = complete ? 'complete' : (S.draft && S.draft.status) || 'live';
  top.appendChild(el('span', 'chip status', status));
  top.appendChild(el('span', 'chip', S.league.scoringLabel));
  const hb = el('span', 'heartbeat' + (S.heartbeatOn ? '' : ' off'));
  top.appendChild(hb);
  h.appendChild(top);

  if (ds) {
    h.appendChild(el('div', 'pickline', 'Round ' + ds.currentRound + ' · Pick ' + ds.currentPickNo));
    if (!complete) {
      if (ds.isMyTurn) {
        h.appendChild(el('div', 'otc-banner', 'ON THE CLOCK'));
      } else {
        const n = ds.picksUntilMine;
        h.appendChild(
          el(
            'div',
            'until-banner',
            Number.isFinite(n)
              ? n + ' pick' + (n === 1 ? '' : 's') + ' until yours'
              : 'pick your slot to track your turn'
          )
        );
      }
    }
  }
}

function renderSlotPicker() {
  const card = $('slot-picker-card');
  if (S.mySlot != null) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  const sel = $('slot-select');
  if (!sel.dataset.built) {
    clear(sel);
    for (let i = 1; i <= S.league.teams; i++) {
      const opt = el('option', null, 'Slot ' + i);
      opt.value = String(i);
      sel.appendChild(opt);
    }
    sel.dataset.built = '1';
    $('apply-slot').addEventListener('click', () => {
      S.mySlot = parseInt(sel.value, 10);
      // recompute against last known picks immediately
      getDraftPicks(S.draftId)
        .then((picks) => {
          S.lastPickCount = picks.length;
          recompute(picks);
          renderSlotPicker();
        })
        .catch(() => {});
    });
  }
}

function renderShortlist() {
  const box = $('shortlist');
  clear(box);
  const cands = (S.engineResult && S.engineResult.candidates) || [];
  if (!cands.length) {
    box.appendChild(el('div', 'muted', 'No candidates.'));
    return;
  }
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  ['Player', 'VBD', 'ADP', 'Surv', 'Tier', ''].forEach((t) => hr.appendChild(el('th', null, t)));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const c of cands.slice(0, 10)) {
    const p = c.player;
    const tr = el('tr');

    const nameTd = el('td', 'name');
    nameTd.appendChild(document.createTextNode(p.name + ' '));
    nameTd.appendChild(el('span', 'pos-tag', p.pos + (p.team ? ' ' + p.team : '')));
    tr.appendChild(nameTd);

    tr.appendChild(el('td', null, c.vbd == null ? '—' : Math.round(c.vbd)));
    tr.appendChild(el('td', null, p.adp == null ? '—' : p.adp));
    tr.appendChild(el('td', null, c.survival == null ? '—' : Math.round(c.survival * 100) + '%'));

    const tierTd = el('td');
    if (c.tierStatus === 'LAST_IN_TIER') tierTd.appendChild(el('span', 'badge last', 'LAST'));
    else if (c.tierStatus === 'TIER_THIN') tierTd.appendChild(el('span', 'badge thin', 'THIN'));
    tr.appendChild(tierTd);

    const flagTd = el('td');
    if (p.injuryStatus) flagTd.appendChild(el('span', 'inj', injTag(p.injuryStatus)));
    if (p.risk && p.risk.length) {
      flagTd.appendChild(document.createTextNode(' '));
      const r = el('span', 'risk-icon', '⚠');
      r.title = p.risk.join(', ');
      flagTd.appendChild(r);
    }
    tr.appendChild(flagTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
}

function injTag(status) {
  const map = { Questionable: 'Q', Doubtful: 'D', Out: 'OUT', IR: 'IR', PUP: 'PUP', Sus: 'SUS' };
  return map[status] || status;
}

function renderRoster() {
  const box = $('roster');
  clear(box);
  const positions = S.league.rosterPositions || [];
  const byId = new Map(S.pool.map((p) => [p.id, p]));
  const filled = greedyFill(S.draftState.myPlayerIds, positions, byId);

  positions.forEach((label, i) => {
    const slot = el('div', 'slot');
    slot.appendChild(el('span', 'slot-label', label));
    const player = filled.slots[i];
    if (player) {
      slot.appendChild(el('span', 'slot-player', player.name));
    } else {
      slot.classList.add('open');
      slot.appendChild(el('span', 'slot-player', '—'));
    }
    box.appendChild(slot);
  });
}

// Local greedy fill for roster display (mirrors prompt-builder / needFactor logic).
const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE']);
function isSuperFlex(l) {
  return l === 'SUPER_FLEX' || l === 'SUPERFLEX' || l === 'SF';
}
function isFlex(l) {
  return !isSuperFlex(l) && /FLEX$/.test(l);
}
function greedyFill(playerIds, positions, byId) {
  const slots = positions.map(() => null);
  for (const id of playerIds || []) {
    const p = byId.get(id);
    const pos = p ? p.pos : null;
    let idx = -1;
    if (pos) {
      idx = positions.findIndex((l, i) => slots[i] === null && l === pos);
      if (idx < 0)
        idx = positions.findIndex(
          (l, i) =>
            slots[i] === null &&
            ((isFlex(l) && FLEX_ELIGIBLE.has(pos)) ||
              (isSuperFlex(l) && SUPERFLEX_ELIGIBLE.has(pos)))
        );
    }
    if (idx < 0) idx = positions.findIndex((l, i) => slots[i] === null && l === 'BN');
    if (idx >= 0) slots[idx] = { name: p ? p.name : id, pos };
  }
  return { slots };
}

function renderRuns() {
  const card = $('runs-card');
  const box = $('runs');
  clear(box);
  const runs = (S.engineResult && S.engineResult.runs) || {};
  const keys = Object.keys(runs);
  if (!keys.length) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  for (const pos of keys) {
    const item = el('div', 'run-item');
    item.appendChild(document.createTextNode(pos + ' '));
    item.appendChild(el('b', null, runs[pos]));
    item.appendChild(document.createTextNode(' in last 8'));
    box.appendChild(item);
  }
}

// ---- Claude recs ----
function renderRecs(rec, opts) {
  const box = $('recs');
  clear(box);
  // A real rec landing satisfies the guardrail — cancel any pending provisional.
  if (S.guardTimer) {
    clearTimeout(S.guardTimer);
    S.guardTimer = null;
  }
  const council = !!(opts && opts.council);
  if (council) {
    const chipRow = el('div', 'rec-chiprow');
    chipRow.appendChild(el('span', 'chip council-chip', 'COUNCIL'));
    box.appendChild(chipRow);
  } else if (opts && opts.precomputed) {
    box.appendChild(el('div', 'muted', 'deep analysis, primed early — targets all still available'));
  }
  for (let i = 0; i < rec.recommendations.length; i++) {
    const r = rec.recommendations[i];
    const wrap = el('div', 'rec');
    const head = el('div', 'rec-head');
    head.appendChild(el('span', 'rec-rank', '#' + (i + 1)));
    head.appendChild(el('span', 'rec-name', r.player));
    const conf = el('span', 'conf ' + (r.confidence || 'medium'), r.confidence || '');
    head.appendChild(conf);
    wrap.appendChild(head);
    wrap.appendChild(el('div', 'rec-why', r.why));
    box.appendChild(wrap);
  }
  if (rec.strategyNote) box.appendChild(el('div', 'strategy-note', rec.strategyNote));
  if (council && Array.isArray(rec.lensResults) && rec.lensResults.length) {
    box.appendChild(renderLensSummary(rec.lensResults));
  }
  renderRecMeta(rec);
}

// Collapsible council-lens summary: each lens's #1 pick + a one-line why.
function renderLensSummary(lensResults) {
  const details = el('details', 'lens-summary');
  details.appendChild(el('summary', null, 'Council lenses (' + lensResults.length + ')'));
  for (const lr of lensResults) {
    const lensDef = LENSES.find((l) => l.key === lr.lens);
    const title = lensDef ? lensDef.title : String(lr.lens || '').toUpperCase();
    const top = lr.recommendations && lr.recommendations[0];
    const row = el('div', 'lens-row');
    const head = el('div', 'lens-head');
    head.appendChild(el('span', 'lens-title', title));
    if (top) head.appendChild(el('span', 'lens-pick', top.player));
    row.appendChild(head);
    if (top && top.why) row.appendChild(el('div', 'lens-why', top.why));
    details.appendChild(row);
  }
  return details;
}

// Council progress: "k/3 advisors…" as each lens settles. NON-destructive — maintains a
// single status line at the top of #recs so the 25s provisional guardrail card (or a prior
// rec) stays visible underneath while the council deliberates.
function setCouncilProgress(k) {
  const box = $('recs');
  let line = box.querySelector('.council-progress');
  if (!line) {
    line = el('div', 'muted council-progress');
    box.insertBefore(line, box.firstChild);
  }
  const n = Number.isFinite(k) ? k : 0;
  line.textContent = n + '/3 advisors…';
}

// 25s guardrail card: engine top-3 while Claude is still thinking. Replaced when a rec lands.
function renderProvisional() {
  const box = $('recs');
  clear(box);
  box.appendChild(el('div', 'provisional-label', 'engine provisional — Claude still thinking'));
  const cands = (S.engineResult && S.engineResult.candidates) || [];
  for (let i = 0; i < Math.min(3, cands.length); i++) {
    const c = cands[i];
    const p = c.player;
    const wrap = el('div', 'rec provisional');
    const head = el('div', 'rec-head');
    head.appendChild(el('span', 'rec-rank', '#' + (i + 1)));
    head.appendChild(el('span', 'rec-name', p.name));
    head.appendChild(el('span', 'pos-tag', p.pos + (p.team ? ' ' + p.team : '')));
    wrap.appendChild(head);
    let line = 'VBD ' + (c.vbd == null ? '—' : Math.round(c.vbd));
    line += ' · surv ' + (c.survival == null ? '—' : Math.round(c.survival * 100) + '%');
    if (c.tierStatus) line += ' · ' + tierLabel(c.tierStatus);
    wrap.appendChild(el('div', 'rec-why', line));
    if (p.note) {
      const note = p.note.length > 90 ? p.note.slice(0, 90) + '…' : p.note;
      wrap.appendChild(el('div', 'rec-why', note));
    }
    box.appendChild(wrap);
  }
  renderRecMeta({ model: S.model });
}

function tierLabel(status) {
  if (status === 'LAST_IN_TIER') return 'LAST IN TIER';
  if (status === 'TIER_THIN') return 'TIER THIN';
  return status;
}

function renderRecMeta(rec) {
  const box = $('rec-meta');
  clear(box);
  box.appendChild(el('span', null, modelLabel(rec.model)));
  sGet('spendSession').then(({ spendSession }) => {
    const spent = spendSession || 0;
    box.appendChild(el('span', null, '$' + spent.toFixed(4) + ' this session'));
  });
}

function setupDraftButtons() {
  $('advise-now').onclick = () => runClaude('low', true);
  $('council-btn').onclick = () => {
    if (!S.draftState) return;
    runCouncil(S.draftState.currentPickNo, true);
  };
}
function setBusy(busy) {
  $('advise-now').disabled = busy;
  $('council-btn').disabled = busy;
  $('advise-now').textContent = busy ? 'Thinking…' : 'Advise now';
}

// ---- notices ----
function showNotice(kind, msg) {
  const box = $('notices');
  clear(box);
  if (kind === 'error-setup') {
    const n = el('div', 'notice error');
    n.appendChild(document.createTextNode(msg + ' '));
    const link = el('a', null, 'Open Setup');
    link.addEventListener('click', showSetup);
    n.appendChild(link);
    box.appendChild(n);
    return;
  }
  const cls = kind === 'amber' ? 'notice amber' : 'notice error';
  box.appendChild(el('div', cls, msg));
}
function clearNotice() {
  clear($('notices'));
  // keep the persistent degraded-mode banner if projections failed
  if (S.projectionsFailed) {
    showNotice('amber', 'Projections unavailable — running on ADP + tiers.');
  }
}

// ---- misc ----
function beatHeartbeat() {
  S.heartbeatOn = !S.heartbeatOn;
  const dot = document.querySelector('.heartbeat');
  if (dot) dot.classList.toggle('off', !S.heartbeatOn);
}
function modelLabel(id) {
  const m = MODELS.find((x) => x.id === id);
  return m ? m.label : id;
}
function humanError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.startsWith('sleeper:')) return 'Sleeper API: ' + msg.slice(8);
  return msg;
}

// ============================================================
// BOOT
// ============================================================
initSetup().catch((e) => {
  const s = $('connect-status');
  if (s) s.textContent = 'Init error: ' + humanError(e);
});
