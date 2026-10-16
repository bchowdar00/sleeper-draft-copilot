// engine.test.mjs — node --test suite for draft-math + engine (B2).
// Synthetic fixtures only; no network.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickNoFor,
  slotForPickNo,
  roundForPickNo,
  myPickNos,
  buildLeagueContext,
  buildDraftState,
  resolveMySlot
} from '../extension/shared/draft-math.js';

import { buildPlayerPool, evaluate, normalizeName, simulateToNextPick } from '../extension/shared/engine.js';

// Seeded PRNG for deterministic MC tests (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a synthetic undrafted pool with explicit vbd + adp (what the sim reads directly).
function simPlayer({ id, pos = 'RB', adp = null, vbd = 50, tier = null }) {
  return { id, name: id, pos, team: 'AAA', adp, vbd, tier, projPts: vbd };
}

// A neutral opponentStates array of length numPicks (no positional need → 0.45 everywhere).
function neutralStates(numPicks, teams = 12) {
  const states = [];
  for (let k = 0; k < numPicks; k++) states.push({ slot: ((k % teams) + 1), unfilledStarters: {} });
  return states;
}

// A draftState just rich enough for the sim.
function simDraftState({ currentPickNo = 20, myNextPickNo = 35, myFollowingPickNo = null, isMyTurn = false } = {}) {
  return { currentPickNo, myNextPickNo, myFollowingPickNo, isMyTurn };
}

const simLeague = { teams: 12, rounds: 15 };

// ---- fixture helpers -------------------------------------------------------

// A raw Sleeper-style league object (→ buildLeagueContext).
function rawLeague({ recPoints = 1, superflex = false, teams = 12, rounds = 15 } = {}) {
  const roster = superflex
    ? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN']
    : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
  return {
    league: {
      total_rosters: teams,
      roster_positions: roster,
      scoring_settings: {
        rec: recPoints,
        pass_td: 4,
        pass_yd: 0.04,
        pass_int: -1,
        rush_yd: 0.1,
        rush_td: 6,
        rec_yd: 0.1,
        rec_td: 6,
        fum_lost: -2
      }
    },
    draft: {
      draft_id: 'test',
      status: 'drafting',
      type: 'snake',
      settings: { teams, rounds },
      metadata: { scoring_type: superflex ? '2qb' : recPoints >= 1 ? 'ppr' : recPoints > 0 ? 'half_ppr' : 'std' }
    }
  };
}

// Build a projections object {id: {stats, player}}.
function makeProjections(list) {
  const out = {};
  for (const p of list) {
    out[p.id] = { stats: p.stats, player: { full_name: p.name, position: p.pos, team: p.team || 'FA' } };
  }
  return out;
}

// Standard stat lines with format ADPs baked in.
function statLine({ rush_yd = 0, rush_td = 0, rec = 0, rec_yd = 0, rec_td = 0, pass_yd = 0, pass_td = 0, pass_int = 0, adp } = {}) {
  const s = { rush_yd, rush_td, rec, rec_yd, rec_td, pass_yd, pass_td, pass_int };
  if (adp != null) {
    s.adp_ppr = adp.ppr ?? adp.std ?? adp;
    s.adp_half_ppr = adp.half ?? adp.ppr ?? adp;
    s.adp_std = adp.std ?? adp;
    s.adp_2qb = adp.two_qb ?? adp.ppr ?? adp;
  }
  return s;
}

// A minimal hand-crafted draftState (evaluate only reads a few fields).
function draftStateStub(overrides = {}) {
  return {
    draftId: 'test',
    picks: [],
    currentPickNo: 1,
    currentRound: 1,
    isMyTurn: false,
    mySlot: 1,
    myNextPickNo: 20,
    myFollowingPickNo: 45,
    picksUntilMine: 19,
    draftedIds: new Set(),
    myPlayerIds: [],
    slotPlayerIds: new Map(),
    slotsBetween: [],
    ...overrides
  };
}

function candFor(result, id) {
  return result.candidates.find((c) => c.player.id === id);
}

// ---- 1. snake pick math round-trips ---------------------------------------

test('snake pick math round-trips for 12 teams', () => {
  const teams = 12;
  for (let pickNo = 1; pickNo <= teams * 15; pickNo++) {
    const round = roundForPickNo(pickNo, teams);
    const slot = slotForPickNo(pickNo, teams);
    assert.equal(pickNoFor(slot, round, teams), pickNo, `pickNo ${pickNo}`);
    assert.ok(slot >= 1 && slot <= teams);
  }
});

test('myPickNos are ascending and snake-correct for slot 3 / 12 teams', () => {
  const mine = myPickNos(3, 12, 4);
  assert.deepEqual(mine, [3, 22, 27, 46]);
  for (let i = 1; i < mine.length; i++) assert.ok(mine[i] > mine[i - 1]);
});

test('resolveMySlot + buildDraftState derive turn order and my schedule', () => {
  const { draft } = rawLeague({ teams: 12, rounds: 15 });
  draft.draft_order = { u1: 3 };
  const mySlot = resolveMySlot({ draft, myUserId: 'u1' });
  assert.equal(mySlot, 3);
  // Two picks made → next pick is #3 (mine), on the clock.
  const picks = [
    { pick_no: 1, draft_slot: 1, player_id: 'a', metadata: { position: 'RB' } },
    { pick_no: 2, draft_slot: 2, player_id: 'b', metadata: { position: 'WR' } }
  ];
  const ds = buildDraftState({ draft, picks, mySlot });
  assert.equal(ds.currentPickNo, 3);
  assert.equal(ds.onTheClockSlot, 3);
  assert.equal(ds.isMyTurn, true);
  assert.equal(ds.myNextPickNo, 3);
  assert.equal(ds.myFollowingPickNo, 22);
  assert.equal(ds.picksUntilMine, 0);
  assert.ok(ds.draftedIds.has('a') && ds.draftedIds.has('b'));
});

// ---- 2. replacement drops as pool drains ----------------------------------

test('replacement level drops as the top of a position is drafted', () => {
  // Small 2-team league so starter counts are hand-computable.
  const { league, draft } = rawLeague({ recPoints: 1, teams: 2, rounds: 8 });
  // One RB starter slot per team → starterSlots.RB = 1/team × 2 teams = 2.
  league.roster_positions = ['RB', 'WR', 'BN', 'BN'];
  const ctx = buildLeagueContext({ league, draft });
  // 6 RBs, projPts 100..50 step 10.
  const rbs = [100, 90, 80, 70, 60, 50].map((pts, i) => ({
    id: `rb${i}`,
    name: `RB ${i}`,
    pos: 'RB',
    team: 'AAA',
    stats: statLine({ rush_yd: pts * 10, adp: i + 1 })
  }));
  const pool = buildPlayerPool({ projections: makeProjections(rbs), playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: ctx });

  // starterSlots RB = 1/team * 2 teams = 2. 0 drafted -> unfilled 2 -> index 2 -> projPts 80.
  const r0 = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentRound: 1 }) });
  const rep0 = candFor(r0, 'rb2') ? candFor(r0, 'rb2').replacementPts : r0.candidates.find((c) => c.player.pos === 'RB').replacementPts;
  assert.equal(rep0, 80);

  // Draft the top 2 RBs -> unfilled floors, replacement drops to 70.
  const drafted = new Set(['rb0', 'rb1']);
  const picks = [
    { pick_no: 1, draft_slot: 1, player_id: 'rb0', metadata: { position: 'RB' } },
    { pick_no: 2, draft_slot: 2, player_id: 'rb1', metadata: { position: 'RB' } }
  ];
  const r1 = evaluate({ pool, league: ctx, draftState: draftStateStub({ draftedIds: drafted, picks, currentRound: 2 }) });
  const rep1 = r1.candidates.find((c) => c.player.pos === 'RB').replacementPts;
  assert.equal(rep1, 70);
  assert.ok(rep1 < rep0, 'replacement dropped as pool drained');
});

// ---- 3. K/DEF suppressed before the final two rounds ----------------------

test('K and DEF are hard-suppressed before the final two rounds', () => {
  const { league, draft } = rawLeague({ recPoints: 1, teams: 12, rounds: 15 });
  const ctx = buildLeagueContext({ league, draft });
  const players = [
    { id: 'k1', name: 'Kicker One', pos: 'K', team: 'AAA', stats: statLine({ rush_yd: 0, adp: 130 }) },
    { id: 'SF', name: 'SF DEF', pos: 'DEF', team: 'SF', stats: statLine({ adp: 140 }) },
    { id: 'rb1', name: 'Back One', pos: 'RB', team: 'BBB', stats: statLine({ rush_yd: 1200, rush_td: 10, adp: 20 }) }
  ];
  const pool = buildPlayerPool({ projections: makeProjections(players), playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: ctx });

  // Round 3 (well before final 2): K/DEF needFactor should be 0.05.
  const early = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentRound: 3 }) });
  assert.equal(candFor(early, 'k1').needFactor, 0.05);
  assert.equal(candFor(early, 'SF').needFactor, 0.05);

  // Round 14 (rounds-1) — suppression lifts, dedicated K/DEF slot open → 1.0.
  const late = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentRound: 14 }) });
  assert.equal(candFor(late, 'k1').needFactor, 1.0);
  assert.equal(candFor(late, 'SF').needFactor, 1.0);
});

// ---- 4. rec=0 vs rec=1 flips an RB-vs-possession-WR ordering ---------------

test('PPR vs Standard flips a workhorse RB against a possession WR', () => {
  const rusher = { id: 'rush', name: 'Workhorse Back', pos: 'RB', team: 'AAA', stats: statLine({ rush_yd: 1200, rush_td: 10, rec: 25, rec_yd: 180, adp: 12 }) };
  const catcher = { id: 'catch', name: 'Possession Wideout', pos: 'WR', team: 'BBB', stats: statLine({ rec: 115, rec_yd: 1150, rec_td: 6, adp: 12 }) };
  // Filler so each position has a replacement baseline.
  const fillers = [];
  for (let i = 0; i < 30; i++) {
    fillers.push({ id: `frb${i}`, name: `Filler RB ${i}`, pos: 'RB', team: 'CCC', stats: statLine({ rush_yd: (1000 - i * 25) * 1, rush_td: 4, rec: 20, rec_yd: 120, adp: 30 + i }) });
    fillers.push({ id: `fwr${i}`, name: `Filler WR ${i}`, pos: 'WR', team: 'DDD', stats: statLine({ rec: 70 - i, rec_yd: 900 - i * 20, rec_td: 4, adp: 30 + i }) });
  }
  const proj = makeProjections([rusher, catcher, ...fillers]);

  const pprCtx = buildLeagueContext(rawLeague({ recPoints: 1, teams: 12, rounds: 15 }));
  const pprPool = buildPlayerPool({ projections: proj, playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: pprCtx });
  const pprRes = evaluate({ pool: pprPool, league: pprCtx, draftState: draftStateStub({ currentRound: 1 }) });

  const stdCtx = buildLeagueContext(rawLeague({ recPoints: 0, teams: 12, rounds: 15 }));
  const stdPool = buildPlayerPool({ projections: proj, playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: stdCtx });
  const stdRes = evaluate({ pool: stdPool, league: stdCtx, draftState: draftStateStub({ currentRound: 1 }) });

  const pprRB = candFor(pprRes, 'rush').score;
  const pprWR = candFor(pprRes, 'catch').score;
  const stdRB = candFor(stdRes, 'rush').score;
  const stdWR = candFor(stdRes, 'catch').score;

  assert.ok(pprWR > pprRB, `PPR: possession WR (${pprWR.toFixed(1)}) should outrank RB (${pprRB.toFixed(1)})`);
  assert.ok(stdRB > stdWR, `STD: workhorse RB (${stdRB.toFixed(1)}) should outrank WR (${stdWR.toFixed(1)})`);
});

// ---- 5. superflex boosts QB via adp_2qb + starter share --------------------

test('superflex boosts a QB score vs the same QB in a 1QB league', () => {
  const qbs = [];
  // Deep QB pool (> superflex starter demand) so the replacement index is not clamped.
  for (let i = 0; i < 30; i++) {
    qbs.push({
      id: `qb${i}`,
      name: `Passer ${i}`,
      pos: 'QB',
      team: 'AAA',
      stats: statLine({
        pass_yd: 4600 - i * 100,
        pass_td: 36 - i,
        rush_yd: 420 - i * 12,
        rush_td: 4,
        pass_int: 10,
        // In superflex QBs go much earlier: adp_2qb far ahead of adp_ppr.
        adp: { ppr: 40 + i * 4, two_qb: 8 + i * 3 }
      })
    });
  }
  const proj = makeProjections(qbs);

  const oneQbCtx = buildLeagueContext(rawLeague({ recPoints: 1, superflex: false, teams: 12, rounds: 15 }));
  const oneQbPool = buildPlayerPool({ projections: proj, playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: oneQbCtx });
  const oneRes = evaluate({ pool: oneQbPool, league: oneQbCtx, draftState: draftStateStub({ currentRound: 2, myNextPickNo: 20 }) });

  const sfCtx = buildLeagueContext(rawLeague({ recPoints: 1, superflex: true, teams: 12, rounds: 15 }));
  assert.equal(sfCtx.isSuperflex, true);
  const sfPool = buildPlayerPool({ projections: proj, playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: sfCtx });
  const sfRes = evaluate({ pool: sfPool, league: sfCtx, draftState: draftStateStub({ currentRound: 2, myNextPickNo: 20 }) });

  // adp switched to adp_2qb (verify pool adp differs).
  assert.equal(sfPool.find((p) => p.id === 'qb0').adp, 8);
  assert.equal(oneQbPool.find((p) => p.id === 'qb0').adp, 40);

  const sfScore = candFor(sfRes, 'qb0').score;
  const oneScore = candFor(oneRes, 'qb0').score;
  assert.ok(sfScore > oneScore, `superflex QB score (${sfScore.toFixed(1)}) should exceed 1QB (${oneScore.toFixed(1)})`);
  // Superflex also raises QB VBD (deeper replacement demand).
  assert.ok(candFor(sfRes, 'qb0').vbd > candFor(oneRes, 'qb0').vbd);
});

// ---- 6. survival monotonic in adp and in pick distance ---------------------

function survivalOfSolo(adp, myNextPickNo) {
  const ctx = buildLeagueContext(rawLeague({ recPoints: 1, teams: 12, rounds: 15 }));
  const player = { id: 'x', name: 'Target Player', pos: 'WR', team: 'AAA', stats: statLine({ rec: 90, rec_yd: 1100, rec_td: 7, adp }) };
  const pool = buildPlayerPool({ projections: makeProjections([player]), playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: ctx });
  const res = evaluate({ pool, league: ctx, draftState: draftStateStub({ isMyTurn: false, myNextPickNo, currentRound: 2 }) });
  return candFor(res, 'x').survival;
}

test('survival is monotonic increasing in ADP at a fixed pick', () => {
  const s10 = survivalOfSolo(10, 30);
  const s25 = survivalOfSolo(25, 30);
  const s50 = survivalOfSolo(50, 30);
  assert.ok(s10 < s25 && s25 < s50, `survival should rise with ADP: ${s10} < ${s25} < ${s50}`);
});

test('survival is monotonic decreasing in pick distance at a fixed ADP', () => {
  const near = survivalOfSolo(25, 15); // pick before ADP → likely available
  const mid = survivalOfSolo(25, 25);
  const far = survivalOfSolo(25, 45); // long wait → likely gone
  assert.ok(near > mid && mid > far, `survival should fall with distance: ${near} > ${mid} > ${far}`);
});

// ---- 7. LAST_IN_TIER fires when a tier is nearly drained -------------------

test('tierStatus transitions TIER_THIN → LAST_IN_TIER as a tier drains', () => {
  const ctx = buildLeagueContext(rawLeague({ recPoints: 1, teams: 12, rounds: 15 }));
  const wrs = ['Alpha WR', 'Bravo WR', 'Charlie WR', 'Delta WR', 'Echo WR'].map((name, i) => ({
    id: `wr${i}`,
    name,
    pos: 'WR',
    team: 'AAA',
    stats: statLine({ rec: 100 - i * 5, rec_yd: 1200 - i * 60, rec_td: 8, adp: 5 + i })
  }));
  // Tier 1 = Alpha/Bravo/Charlie (3 players); tier 2 = Delta/Echo.
  const dataset = {
    byeWeeks: {},
    players: [
      { name: 'Alpha WR', pos: 'WR', tier: 1, posRank: 1, note: '', risk: [] },
      { name: 'Bravo WR', pos: 'WR', tier: 1, posRank: 2, note: '', risk: [] },
      { name: 'Charlie WR', pos: 'WR', tier: 1, posRank: 3, note: '', risk: [] },
      { name: 'Delta WR', pos: 'WR', tier: 2, posRank: 4, note: '', risk: [] },
      { name: 'Echo WR', pos: 'WR', tier: 2, posRank: 5, note: '', risk: [] }
    ]
  };
  const pool = buildPlayerPool({ projections: makeProjections(wrs), playersSlim: {}, dataset, league: ctx });

  // All undrafted: Alpha is in best tier (1) with 2 others left → TIER_THIN.
  const full = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentRound: 1 }) });
  assert.equal(candFor(full, 'wr0').tierStatus, 'TIER_THIN');

  // Draft Charlie → tier 1 has Alpha + Bravo (1 other) → LAST_IN_TIER.
  const drained = evaluate({
    pool,
    league: ctx,
    draftState: draftStateStub({
      currentRound: 1,
      draftedIds: new Set(['wr2']),
      picks: [{ pick_no: 1, draft_slot: 1, player_id: 'wr2', metadata: { position: 'WR' } }]
    })
  });
  assert.equal(candFor(drained, 'wr0').tierStatus, 'LAST_IN_TIER');
  // Tier multiplier lifted the score relative to the non-drained case.
  assert.ok(candFor(drained, 'wr0').score > candFor(full, 'wr0').score);
});

// ---- 8. buildLeagueContext from a mock draft's slots_* (league null) -------

test('buildLeagueContext derives everything from mock slots_* when league is null', () => {
  const draft = {
    draft_id: 'mock',
    status: 'drafting',
    type: 'snake',
    league_id: null,
    metadata: { scoring_type: 'std' },
    settings: {
      rounds: 15,
      teams: 10,
      slots_qb: 1,
      slots_rb: 2,
      slots_wr: 2,
      slots_te: 1,
      slots_flex: 2,
      slots_k: 1,
      slots_def: 1
      // no slots_bn / slots_super_flex present → defensive default 0
    }
  };
  const ctx = buildLeagueContext({ league: null, draft });
  assert.equal(ctx.teams, 10);
  assert.equal(ctx.rounds, 15);
  assert.equal(ctx.recPoints, 0);
  assert.equal(ctx.scoringLabel, 'Standard');
  assert.equal(ctx.isSuperflex, false);
  // rosterPositions rebuilt from slots: 1QB 2RB 2WR 1TE 2FLEX 1K 1DEF = 10 slots.
  assert.deepEqual(ctx.rosterPositions, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF']);
  // Preset scoring applied (std rec 0, rush_td 6…).
  assert.equal(ctx.scoring.rec, 0);
  assert.equal(ctx.scoring.rush_td, 6);
  assert.equal(ctx.scoring.pass_yd, 0.04);

  // 2qb variant → PPR + Superflex.
  const draft2 = { ...draft, metadata: { scoring_type: '2qb' }, settings: { ...draft.settings, slots_super_flex: 1 } };
  const ctx2 = buildLeagueContext({ league: null, draft: draft2 });
  assert.equal(ctx2.isSuperflex, true);
  assert.equal(ctx2.recPoints, 1);
  assert.equal(ctx2.scoringLabel, 'PPR Superflex');
  assert.ok(ctx2.rosterPositions.includes('SUPER_FLEX'));
});

// ---- misc sanity: normalizeName + candidate cap ---------------------------

test('normalizeName strips diacritics, punctuation and generational suffixes', () => {
  assert.equal(normalizeName('Marvin Harrison Jr.'), 'marvin harrison');
  assert.equal(normalizeName("De'Von Achane"), 'de von achane');
  assert.equal(normalizeName('Kenneth Walker III'), 'kenneth walker');
});

// ---- 9. Monte Carlo: seeded-rng determinism (DESIGN-1.1 §W1) ---------------

test('simulateToNextPick is deterministic for a fixed seed', () => {
  const undrafted = [];
  for (let i = 0; i < 60; i++) {
    undrafted.push(simPlayer({ id: `p${i}`, pos: ['RB', 'WR', 'QB', 'TE'][i % 4], adp: 15 + i, vbd: 120 - i }));
  }
  const numPicks = 15;
  const draftState = simDraftState({ currentPickNo: 20, myNextPickNo: 35 });
  const states = neutralStates(numPicks);
  const a = simulateToNextPick({ undrafted, draftState, league: simLeague, opponentStates: states, iterations: 200, rng: mulberry32(12345) });
  const b = simulateToNextPick({ undrafted, draftState, league: simLeague, opponentStates: states, iterations: 200, rng: mulberry32(12345) });
  assert.equal(a.neutral, false);
  assert.equal(a.pAvail.size, b.pAvail.size);
  for (const [id, v] of a.pAvail) assert.equal(v, b.pAvail.get(id), `pAvail differs for ${id}`);
  // A different seed should produce at least one different value.
  const c = simulateToNextPick({ undrafted, draftState, league: simLeague, opponentStates: states, iterations: 200, rng: mulberry32(99) });
  let anyDiff = false;
  for (const [id, v] of a.pAvail) if (v !== c.pAvail.get(id)) anyDiff = true;
  assert.ok(anyDiff, 'a different seed should change some pAvail');
});

// ---- 10. Monte Carlo: adp windows drive availability -----------------------

test('simulateToNextPick: adp far below the window ≈ 0, far beyond ≈ 1', () => {
  const undrafted = [];
  for (let i = 0; i < 60; i++) undrafted.push(simPlayer({ id: `mid${i}`, pos: 'RB', adp: 18 + i, vbd: 80 }));
  undrafted.push(simPlayer({ id: 'early', pos: 'RB', adp: 2, vbd: 80 })); // way before the picks → grabbed
  undrafted.push(simPlayer({ id: 'late', pos: 'RB', adp: 500, vbd: 80 })); // never in top-12 → survives
  const numPicks = 15;
  const draftState = simDraftState({ currentPickNo: 20, myNextPickNo: 35 });
  const res = simulateToNextPick({
    undrafted,
    draftState,
    league: simLeague,
    opponentStates: neutralStates(numPicks),
    iterations: 300,
    rng: mulberry32(7)
  });
  assert.ok(res.pAvail.get('early') < 0.1, `early adp should be nearly gone: ${res.pAvail.get('early')}`);
  assert.ok(res.pAvail.get('late') > 0.9, `late adp should nearly always survive: ${res.pAvail.get('late')}`);
});

// ---- 11. Monte Carlo: need bias drains a position faster --------------------

test('simulateToNextPick: an RB-hole field drains RBs faster than a no-need field', () => {
  // Interleaved RB/WR at matched adp so only need biases the draw.
  const undrafted = [];
  for (let i = 0; i < 40; i++) {
    undrafted.push(simPlayer({ id: `rb${i}`, pos: 'RB', adp: 20 + i * 2, vbd: 80 }));
    undrafted.push(simPlayer({ id: `wr${i}`, pos: 'WR', adp: 21 + i * 2, vbd: 80 }));
  }
  const numPicks = 15;
  const draftState = simDraftState({ currentPickNo: 20, myNextPickNo: 35 });

  const holeStates = [];
  const baseStates = [];
  for (let k = 0; k < numPicks; k++) {
    holeStates.push({ slot: (k % 12) + 1, unfilledStarters: { RB: 2 } }); // every team wants RBs
    baseStates.push({ slot: (k % 12) + 1, unfilledStarters: {} }); // starters full → 0.45
  }

  const hole = simulateToNextPick({ undrafted, draftState, league: simLeague, opponentStates: holeStates, iterations: 300, rng: mulberry32(3) });
  const base = simulateToNextPick({ undrafted, draftState, league: simLeague, opponentStates: baseStates, iterations: 300, rng: mulberry32(3) });

  // Average RB availability should be strictly lower when every team has an RB hole.
  let holeSum = 0;
  let baseSum = 0;
  for (let i = 0; i < 40; i++) {
    holeSum += hole.pAvail.get(`rb${i}`);
    baseSum += base.pAvail.get(`rb${i}`);
  }
  assert.ok(holeSum / 40 < baseSum / 40, `RB-hole avail (${(holeSum / 40).toFixed(3)}) should be < baseline (${(baseSum / 40).toFixed(3)})`);
});

// ---- 12. Monte Carlo: quantile ordering p25 ≤ p50 ≤ p75 --------------------

test('simulateToNextPick: expBestVbdByPos quantiles are ordered p25 ≤ p50 ≤ p75', () => {
  const undrafted = [];
  for (let i = 0; i < 50; i++) {
    undrafted.push(simPlayer({ id: `rb${i}`, pos: 'RB', adp: 18 + i, vbd: 130 - i * 2 }));
    undrafted.push(simPlayer({ id: `wr${i}`, pos: 'WR', adp: 19 + i, vbd: 125 - i * 2 }));
  }
  const numPicks = 18;
  const res = simulateToNextPick({
    undrafted,
    draftState: simDraftState({ currentPickNo: 20, myNextPickNo: 38 }),
    league: simLeague,
    opponentStates: neutralStates(numPicks),
    iterations: 250,
    rng: mulberry32(42)
  });
  for (const pos of ['RB', 'WR']) {
    const q = res.expBestVbdByPos[pos];
    assert.ok(q.p25 <= q.p50 && q.p50 <= q.p75, `${pos}: ${q.p25} <= ${q.p50} <= ${q.p75}`);
  }
});

// ---- 13. Monte Carlo: performance guard ------------------------------------

test('simulateToNextPick: 250 iterations over a 400-player pool runs < 250ms', () => {
  const undrafted = [];
  for (let i = 0; i < 400; i++) {
    undrafted.push(simPlayer({ id: `p${i}`, pos: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'][i % 6], adp: 5 + i, vbd: 200 - i * 0.4 }));
  }
  const numPicks = 31; // a 16-team following-pick span
  const league = { teams: 16, rounds: 15 };
  const states = neutralStates(numPicks, 16);
  const t0 = process.hrtime.bigint();
  const res = simulateToNextPick({
    undrafted,
    draftState: simDraftState({ currentPickNo: 40, myNextPickNo: 71 }),
    league,
    opponentStates: states,
    iterations: 250,
    rng: mulberry32(1)
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(res.neutral, false);
  assert.ok(ms < 250, `sim wall-clock ${ms.toFixed(1)}ms should be < 250ms`);
  console.log(`    [perf] 250 iters × ${numPicks} picks × 400 players = ${ms.toFixed(1)}ms`);
});

// ---- 14. Monte Carlo: neutral fallback when there is no future pick ---------

test('simulateToNextPick returns neutral (survival 1.0) when the wait-target is null', () => {
  const undrafted = [];
  for (let i = 0; i < 30; i++) undrafted.push(simPlayer({ id: `p${i}`, pos: 'RB', adp: 10 + i, vbd: 90 - i }));
  const res = simulateToNextPick({
    undrafted,
    draftState: simDraftState({ currentPickNo: 200, myNextPickNo: null, myFollowingPickNo: null, isMyTurn: false }),
    league: simLeague,
    opponentStates: [],
    iterations: 100,
    rng: mulberry32(1)
  });
  assert.equal(res.neutral, true);
  for (const [, v] of res.pAvail) assert.equal(v, 1);
  assert.equal(res.pTierSurvives.RB, 1);
});

// ---- 15. Monte Carlo: evaluate publishes engineResult.mc -------------------

test('evaluate attaches engineResult.mc when the sim is live', () => {
  const ctx = buildLeagueContext(rawLeague({ recPoints: 1, teams: 12, rounds: 15 }));
  const players = [];
  for (let i = 0; i < 60; i++) {
    const pos = ['QB', 'RB', 'WR', 'TE'][i % 4];
    players.push({ id: `p${i}`, name: `Player ${i}`, pos, team: 'AAA', stats: statLine({ rush_yd: 1200 - i * 10, rec: 50, rec_yd: 600, rec_td: 4, pass_yd: 3200, pass_td: 22, adp: 5 + i }) });
  }
  const pool = buildPlayerPool({ projections: makeProjections(players), playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: ctx });
  const res = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentPickNo: 10, currentRound: 1, myNextPickNo: 27 }) });
  assert.ok(res.mc, 'engineResult.mc should be present');
  assert.equal(res.mc.iterations, 250);
  assert.ok(res.mc.pTierSurvives && res.mc.expBestVbdByPos);
  // Candidate survival now comes from the MC pAvail (0..1).
  for (const c of res.candidates) assert.ok(c.survival >= 0 && c.survival <= 1);
});

test('candidate list is capped at 10 and sorted by score descending', () => {
  const ctx = buildLeagueContext(rawLeague({ recPoints: 1, teams: 12, rounds: 15 }));
  const players = [];
  for (let i = 0; i < 40; i++) {
    const pos = ['QB', 'RB', 'WR', 'TE'][i % 4];
    players.push({ id: `p${i}`, name: `Player ${i}`, pos, team: 'AAA', stats: statLine({ rush_yd: 1200 - i * 20, rec: 40, rec_yd: 500, rec_td: 3, pass_yd: 3000, pass_td: 20, adp: 5 + i }) });
  }
  const pool = buildPlayerPool({ projections: makeProjections(players), playersSlim: {}, dataset: { players: [], byeWeeks: {} }, league: ctx });
  const res = evaluate({ pool, league: ctx, draftState: draftStateStub({ currentRound: 1 }) });
  assert.ok(res.candidates.length <= 10);
  for (let i = 1; i < res.candidates.length; i++) {
    assert.ok(res.candidates[i - 1].score >= res.candidates[i].score);
  }
});
