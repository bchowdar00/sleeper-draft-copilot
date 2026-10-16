#!/usr/bin/env node
// Sleeper Draft Copilot — dry-run harness (DESIGN.md §3.9 + DESIGN-1.1.md §W4)
//
// Fetches a real Sleeper draft, runs the full local pipeline against live
// projections, and prints what the side panel would compute. Optionally makes
// one real Claude call (single advisor) or a full council run. Node >= 18 only
// (relies on global fetch + AbortSignal + performance.now).
//
//   node test/dry-run.mjs <draftIdOrUrl> --slot N [--pick K]
//                         [--claude] [--effort low|medium|high] [--council]
//
// Env: ANTHROPIC_API_KEY (required for --claude / --council),
//      COPILOT_MODEL (default claude-fable-5-1 — the v1.1 fable-first default),
//      COPILOT_EFFORT (single-call effort default 'low'; --effort overrides).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getNflState,
  getDraft,
  getDraftPicks,
  getLeague,
  getSeasonProjections,
  getPlayersSlim,
  parseDraftIdFromUrl
} from '../extension/shared/sleeper-client.js';
import {
  buildLeagueContext,
  buildDraftState
} from '../extension/shared/draft-math.js';
import { buildPlayerPool, evaluate } from '../extension/shared/engine.js';
import { buildUserPayload } from '../extension/shared/prompt-builder.js';
import { SYSTEM_PROMPT } from '../extension/shared/strategy-prompt.js';
import {
  getRecommendation,
  estimateCostUsd
} from '../extension/shared/anthropic-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = join(__dirname, '..', 'extension', 'data', 'players-2026.json');
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const EFFORTS = new Set(['low', 'medium', 'high']);

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [], slot: null, pick: null, claude: false, council: false, effort: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--claude') args.claude = true;
    else if (a === '--council') args.council = true;
    else if (a === '--slot') args.slot = Number(argv[++i]);
    else if (a === '--pick') args.pick = Number(argv[++i]);
    else if (a === '--effort') args.effort = String(argv[++i] || '').toLowerCase();
    else if (a.startsWith('--')) die(`unknown flag: ${a}`);
    else args._.push(a);
  }
  return args;
}

function playerNameFromPick(pick) {
  const m = pick && pick.metadata;
  if (m && (m.first_name || m.last_name)) {
    return `${m.first_name || ''} ${m.last_name || ''}`.trim();
  }
  return pick && pick.player_id ? `#${pick.player_id}` : '(empty)';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0];
  if (!target) {
    die('usage: node test/dry-run.mjs <draftIdOrUrl> --slot N [--pick K] [--claude] [--effort low|medium|high] [--council]');
  }
  if (args.effort !== null && !EFFORTS.has(args.effort)) {
    die(`--effort must be one of low|medium|high (got: ${args.effort})`);
  }

  const draftId = parseDraftIdFromUrl(target);
  if (!draftId) die(`could not parse a draft id from: ${target}`);
  if (!Number.isInteger(args.slot) || args.slot < 1) {
    die('--slot N is required (your draft slot, 1-based)');
  }

  // ---- dataset (local) --------------------------------------------------
  let dataset;
  let teamContext = null;
  try {
    dataset = JSON.parse(await readFile(DATASET_PATH, 'utf8'));
    try {
      const tc = JSON.parse(
        await readFile(join(__dirname, '..', 'extension', 'data', 'team-context-2026.json'), 'utf8')
      );
      teamContext = tc.teams || null;
    } catch {
      teamContext = null; // optional dataset; absent until the pro-intel research lands
    }
  } catch (e) {
    die(`could not read dataset ${DATASET_PATH}: ${e.message}`);
  }

  // ---- draft + picks ----------------------------------------------------
  console.log(`\n● Fetching draft ${draftId} …`);
  let draft, allPicks;
  try {
    draft = await getDraft(draftId);
  } catch (e) {
    die(`fetch draft failed: ${e.message}`);
  }
  if (!draft) die(`draft ${draftId} not found`);
  try {
    allPicks = await getDraftPicks(draftId);
  } catch (e) {
    die(`fetch picks failed: ${e.message}`);
  }
  allPicks = Array.isArray(allPicks) ? allPicks : [];

  // truncate picks to K (default: all)
  const picks =
    Number.isInteger(args.pick) && args.pick >= 0
      ? allPicks.slice(0, args.pick)
      : allPicks;

  const mySlot = args.slot;

  // ---- league context ---------------------------------------------------
  let league = null;
  if (draft.league_id) {
    try {
      league = await getLeague(draft.league_id);
    } catch (e) {
      console.warn(`⚠ league fetch failed (${e.message}); using mock presets`);
      league = null;
    }
  }
  const leagueCtx = buildLeagueContext({ league, draft });
  const draftState = buildDraftState({ draft, picks, mySlot });

  // ---- season projections (live, degrade gracefully) --------------------
  let season = draft.season;
  if (!season) {
    try {
      season = (await getNflState()).season;
    } catch {
      season = String(new Date().getFullYear());
    }
  }
  let projections = new Map();
  try {
    console.log(`● Fetching season projections (${season}) …`);
    projections = await getSeasonProjections(season, POSITIONS);
  } catch (e) {
    console.warn(
      `⚠ projections unavailable (${e.message}); pool runs on ADP + tiers (degraded mode)`
    );
    projections = new Map();
  }

  // ---- players/nfl slim -------------------------------------------------
  let playersSlim = { fetchedAt: Date.now(), players: {} };
  try {
    console.log('● Fetching players/nfl (slim) …');
    playersSlim = await getPlayersSlim();
    playersSlim.fetchedAt = Date.now();
  } catch (e) {
    console.warn(`⚠ players/nfl fetch failed (${e.message}); injury tags unavailable`);
  }

  // ---- build pool + evaluate (timed) -----------------------------------
  const pool = buildPlayerPool({ projections, playersSlim, dataset, league: leagueCtx });
  const evalStart = performance.now();
  const engineResult = evaluate({ pool, league: leagueCtx, draftState });
  const evalMs = performance.now() - evalStart;

  // ---- report -----------------------------------------------------------
  printLeagueSummary(leagueCtx, draftState, draft, allPicks.length, picks.length);
  printBoard(picks);
  printMyRoster(draftState, pool);
  printCandidates(engineResult);
  printRuns(engineResult);
  printMc(engineResult);
  console.log(`\n■ Engine evaluate wall-clock: ${evalMs.toFixed(1)} ms`);

  const userPayload = buildUserPayload({
    league: leagueCtx,
    draftState,
    engineResult,
    pool,
    teamContext
  });
  const bytes = Buffer.byteLength(userPayload, 'utf8');
  console.log(
    `\n■ Prompt payload size: ${bytes} bytes (${(bytes / 1024).toFixed(2)} KB, target < 10 KB)`
  );
  printNewPayloadFields(userPayload);

  // ---- optional Claude call --------------------------------------------
  if (args.council) {
    await runCouncil(userPayload);
  } else if (args.claude) {
    await runClaude(userPayload, args.effort);
  } else {
    console.log('\n(skip Claude — pass --claude [--effort E] or --council with ANTHROPIC_API_KEY set)\n');
  }
}

function printLeagueSummary(leagueCtx, ds, draft, totalPicks, usedPicks) {
  console.log('\n── League ─────────────────────────────────');
  console.log(`  teams=${leagueCtx.teams}  rounds=${leagueCtx.rounds}  scoring=${leagueCtx.scoringLabel}`);
  console.log(`  recPoints=${leagueCtx.recPoints}  superflex=${leagueCtx.isSuperflex}`);
  console.log(`  status=${draft.status}  type=${draft.type}  leagueMode=${draft.league_id ? 'league' : 'mock'}`);
  console.log('── Draft state ────────────────────────────');
  console.log(`  picks used ${usedPicks}/${totalPicks}  → next pick #${ds.currentPickNo} (round ${ds.currentRound})`);
  console.log(`  on the clock: slot ${ds.onTheClockSlot}   mySlot=${ds.mySlot}  isMyTurn=${ds.isMyTurn}`);
  console.log(`  picksUntilMine=${ds.picksUntilMine}  myNextPickNo=${ds.myNextPickNo}  myFollowingPickNo=${ds.myFollowingPickNo}`);
}

function printBoard(picks) {
  console.log('\n── Board (last 10 picks) ──────────────────');
  const last = picks.slice(-10);
  if (last.length === 0) {
    console.log('  (no picks yet)');
    return;
  }
  for (const p of last) {
    const meta = p.metadata || {};
    const pos = meta.position || '?';
    const team = meta.team || '?';
    console.log(
      `  #${String(p.pick_no).padStart(3)} R${p.round}.${String(p.draft_slot).padStart(2)}  ${playerNameFromPick(p)} (${pos} ${team})`
    );
  }
}

function printMyRoster(ds, pool) {
  console.log('\n── My roster (pick order) ─────────────────');
  const byId = new Map(pool.map((pr) => [pr.id, pr]));
  if (!ds.myPlayerIds || ds.myPlayerIds.length === 0) {
    console.log('  (none yet)');
    return;
  }
  for (const id of ds.myPlayerIds) {
    const pr = byId.get(id);
    console.log(pr ? `  ${pr.pos.padEnd(3)} ${pr.name} (${pr.team || '—'})` : `  ?   #${id}`);
  }
}

function printCandidates(engineResult) {
  console.log('\n── Candidates (engine shortlist) ──────────');
  const rows = engineResult.candidates.map((c) => ({
    name: c.player.name,
    pos: c.player.pos,
    team: c.player.team || '',
    projPts: c.player.projPts == null ? '' : Math.round(c.player.projPts),
    vbd: Math.round(c.vbd),
    adp: c.player.adp == null ? '' : c.player.adp,
    'survive%': Math.round(c.survival * 100),
    need: c.needFactor,
    tier: c.tierStatus || '',
    run: c.runBoost ? '↑' : '',
    score: Number(c.score.toFixed(1)),
    waitVBD: c.bestAtPosAtNextPick == null ? '' : Math.round(c.bestAtPosAtNextPick)
  }));
  console.table(rows);
}

function printRuns(engineResult) {
  const runs = engineResult.runs || {};
  const entries = Object.entries(runs);
  if (entries.length === 0) return;
  console.log('── Position runs (last 8 picks, ≥4) ───────');
  console.log('  ' + entries.map(([pos, n]) => `${pos}:${n}`).join('  '));
}

// MC block — Monte Carlo availability sim summary (DESIGN-1.1 §W1 engine.mc).
// Absent when the engine took the closed-form fallback (neutral sim) or has not
// yet shipped the v1.1 mc field.
function printMc(engineResult) {
  console.log('\n── MC (opponent-need-biased sim) ──────────');
  const mc = engineResult.mc;
  if (!mc) {
    console.log('  (no mc block — engine on closed-form survival, no simulation)');
    return;
  }
  console.log(`  iterations: ${mc.iterations}`);
  const pts = mc.pTierSurvives || {};
  const posEntries = Object.entries(pts);
  if (posEntries.length === 0) {
    console.log('  pTierSurvives: (none)');
  } else {
    console.log(
      '  pTierSurvives (P best-remaining tier still has a member at my pick):'
    );
    for (const [pos, p] of posEntries) {
      console.log(`    ${pos.padEnd(4)} ${(Number(p) * 100).toFixed(0)}%`);
    }
  }
  const eb = mc.expBestVbdByPos || {};
  const ebEntries = Object.entries(eb);
  if (ebEntries.length > 0) {
    console.log('  expBestVbdByPos (p25/p50/p75 best remaining VBD at my pick):');
    for (const [pos, q] of ebEntries) {
      if (!q) continue;
      const fmt = (v) => (v == null ? '—' : Math.round(v));
      console.log(`    ${pos.padEnd(4)} ${fmt(q.p25)} / ${fmt(q.p50)} / ${fmt(q.p75)}`);
    }
  }
}

// Print the payload v2 fields added in DESIGN-1.1 §W2 (myUpcomingPicks,
// tiersRemaining, mc). Parsed back out of the compact JSON the panel would send.
function printNewPayloadFields(userPayload) {
  let obj;
  try {
    obj = JSON.parse(userPayload);
  } catch (e) {
    console.log(`  (payload not JSON-parseable: ${e.message})`);
    return;
  }
  console.log('\n── Payload v2 fields ──────────────────────');
  if ('myUpcomingPicks' in obj) {
    console.log(`  myUpcomingPicks: ${JSON.stringify(obj.myUpcomingPicks)}`);
  } else {
    console.log('  myUpcomingPicks: (absent — builder pre-v1.1)');
  }
  if ('tiersRemaining' in obj) {
    console.log('  tiersRemaining (best 3 tiers/pos, undrafted counts):');
    for (const [pos, tiers] of Object.entries(obj.tiersRemaining)) {
      const s = (tiers || []).map((t) => `T${t.tier}:${t.left}`).join('  ');
      console.log(`    ${pos.padEnd(4)} ${s}`);
    }
  } else {
    console.log('  tiersRemaining: (absent — builder pre-v1.1)');
  }
  if (obj.mc) {
    console.log(`  mc.note: ${obj.mc.note}`);
  } else {
    console.log('  mc: (absent — builder pre-v1.1 or neutral sim)');
  }
  // Count candidate-level v2 annotations if present.
  const cands = Array.isArray(obj.candidates) ? obj.candidates : [];
  const flagged = cands.filter(
    (c) => c && (c.byeOverlap || c.handcuff || c.stacksWithMyQB || c.trendingAdds != null)
  );
  if (flagged.length > 0) {
    console.log(`  candidate annotations (byeOverlap/handcuff/stack/trending) on ${flagged.length}/${cands.length}:`);
    for (const c of flagged) {
      const bits = [];
      if (c.byeOverlap) bits.push(`byeOverlap=${c.byeOverlap}`);
      if (c.handcuff) bits.push('handcuff');
      if (c.stacksWithMyQB) bits.push('stacksWithMyQB');
      if (c.trendingAdds != null) bits.push(`trendingAdds=${c.trendingAdds}`);
      console.log(`    ${c.name}: ${bits.join(', ')}`);
    }
  }
}

async function runClaude(userPayload, effortOverride) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) die('--claude requires the ANTHROPIC_API_KEY environment variable');
  const model = process.env.COPILOT_MODEL || 'claude-fable-5-1';
  const effort = effortOverride || process.env.COPILOT_EFFORT || 'low';

  console.log(`\n● Calling Claude (${model}, effort=${effort}) …`);
  const start = performance.now();
  let rec;
  try {
    rec = await getRecommendation({
      apiKey,
      model,
      effort,
      system: SYSTEM_PROMPT,
      userPayload
    });
  } catch (e) {
    die(`Claude call failed [${e.message}]`);
  }
  const callMs = performance.now() - start;

  console.log('\n── Claude recommendations ─────────────────');
  rec.recommendations.forEach((r, i) => {
    console.log(`\n  ${i + 1}. ${r.player}   [${r.confidence}]`);
    console.log(`     ${r.why}`);
  });
  console.log(`\n  strategy: ${rec.strategyNote}`);

  const cost = estimateCostUsd(rec.model, rec.usage);
  console.log(
    `\n  model=${rec.model}  in=${rec.usage.input_tokens} out=${rec.usage.output_tokens} tokens  ≈ $${cost.toFixed(4)}`
  );
  console.log(`  claude call wall-clock: ${callMs.toFixed(0)} ms\n`);
}

async function runCouncil(userPayload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) die('--council requires the ANTHROPIC_API_KEY environment variable');
  const model = process.env.COPILOT_MODEL || 'claude-fable-5-1';

  // Dynamic import so the no-council path never depends on the v1.1 exports
  // (W2 ships getCouncilRecommendation/LENSES concurrently).
  let getCouncilRecommendation;
  try {
    ({ getCouncilRecommendation } = await import('../extension/shared/anthropic-client.js'));
  } catch (e) {
    die(`could not import anthropic-client: ${e.message}`);
  }
  if (typeof getCouncilRecommendation !== 'function') {
    die('getCouncilRecommendation not exported yet (W2 anthropic-client.js not on disk)');
  }

  console.log(`\n● Council run (${model}): 3 lens calls (effort medium) + synthesis (effort low) …`);
  const start = performance.now();
  let result;
  try {
    result = await getCouncilRecommendation({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      userPayload,
      onProgress: (k) => console.log(`  · advisor ${k}/3 done`)
    });
  } catch (e) {
    die(`Council call failed [${e.message}]`);
  }
  const councilMs = performance.now() - start;

  console.log('\n── Council lenses (each advisor\'s #1) ─────');
  for (const lr of result.lensResults || []) {
    const top = lr.recommendations && lr.recommendations[0];
    console.log(`  [${lr.lens}] ${top ? top.player : '(no pick)'}${top ? `  — ${top.why}` : ''}`);
  }

  console.log('\n── Synthesized recommendation ─────────────');
  result.recommendations.forEach((r, i) => {
    console.log(`\n  ${i + 1}. ${r.player}   [${r.confidence}]`);
    console.log(`     ${r.why}`);
  });
  console.log(`\n  strategy: ${result.strategyNote}`);

  const cost = estimateCostUsd(result.model, result.usage);
  console.log(
    `\n  model=${result.model}  in=${result.usage.input_tokens} out=${result.usage.output_tokens} tokens (council total)  ≈ $${cost.toFixed(4)}`
  );
  console.log(`  council wall-clock: ${councilMs.toFixed(0)} ms (covers 3 lens calls + synthesis)\n`);
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
