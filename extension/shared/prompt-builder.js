// Builds the compact user-message payload for the advisor. Pure ES module: no chrome.*, no DOM.
// Contract: DESIGN.md §3.5 + payload v2 additions in DESIGN-1.1.md §W2. Target < 10KB,
// JSON.stringify(0 indent), no null-noise.

import { myPickNos } from './draft-math.js';

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
const TIER_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE']);
const NON_STARTER_SLOTS = new Set(['BN', 'IR', 'TAXI']);

// Exactly the labels engine.js's needFactor greedy fill recognizes — the payload's
// slotFilled/openStarters must agree with needFactor, so these stay in lockstep.
function isSuperFlexLabel(label) {
  return label === 'SUPER_FLEX';
}
function isFlexLabel(label) {
  return label === 'FLEX';
}

// Greedy fill of playerIds into rosterPositions: dedicated slots first, then FLEX/SUPER_FLEX,
// then bench. Mirrors the engine needFactor fill so the payload agrees with scoring.
function greedyFill(playerIds, rosterPositions, byId) {
  const slots = (rosterPositions || []).map((label) => ({ label, filledBy: null }));
  const filled = [];
  for (const id of playerIds || []) {
    const player = byId.get(id);
    const pos = player ? player.pos : null;
    let slot = null;
    if (pos) {
      // 1. dedicated slot exactly matching the position
      slot = slots.find((s) => s.label === pos && s.filledBy === null);
      // 2. flex, then superflex (same fill order as engine.js needFactor greedy fill)
      if (!slot && FLEX_ELIGIBLE.has(pos)) {
        slot = slots.find((s) => s.filledBy === null && isFlexLabel(s.label));
      }
      if (!slot && SUPERFLEX_ELIGIBLE.has(pos)) {
        slot = slots.find((s) => s.filledBy === null && isSuperFlexLabel(s.label));
      }
    }
    // 3. bench
    if (!slot) slot = slots.find((s) => s.label === 'BN' && s.filledBy === null);
    const slotLabel = slot ? slot.label : 'BN';
    if (slot) slot.filledBy = id;
    filled.push({
      name: player ? player.name : id,
      pos: pos || null,
      slotFilled: slotLabel
    });
  }
  // unfilled starter slots (exclude bench/IR/taxi)
  const openStarters = slots
    .filter((s) => s.filledBy === null && !NON_STARTER_SLOTS.has(s.label))
    .map((s) => s.label);
  return { filled, openStarters };
}

// Strip null/undefined/empty fields so the payload carries no null-noise.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Preset scoring baseline (per recPoints) used to surface only NON-preset scoring keys.
function presetScoring(recPoints) {
  return {
    pass_td: 4,
    pass_yd: 0.04,
    pass_int: -1,
    rush_yd: 0.1,
    rush_td: 6,
    rec_yd: 0.1,
    rec_td: 6,
    fum_lost: -2,
    rec: recPoints
  };
}

// Scoring keys whose value meaningfully differs from the format preset (bonuses, TE premium…).
function notableScoring(scoring, recPoints) {
  const preset = presetScoring(recPoints);
  const notable = {};
  if (!scoring || typeof scoring !== 'object') return notable;
  for (const [k, v] of Object.entries(scoring)) {
    if (typeof v !== 'number' || v === 0) continue;
    if (k in preset && preset[k] === v) continue;
    notable[k] = v;
  }
  return notable;
}

// tiersRemaining: for QB/RB/WR/TE, count UNDRAFTED dataset-tiered players per tier and keep the
// lowest (best) 3 tier numbers per position → { pos: [{tier, left}] }. Omits positions with none.
function tiersRemaining(pool, draftedIds, draftedNameKeys) {
  const out = {};
  for (const pos of TIER_POSITIONS) {
    const counts = new Map();
    for (const p of pool || []) {
      if (p.pos !== pos) continue;
      if (p.tier === null || p.tier === undefined) continue;
      if (draftedIds && draftedIds.has && draftedIds.has(p.id)) continue;
      // Degraded-mode synthetic ids can't match pick player_ids — filter those by name.
      if (
        draftedNameKeys &&
        p.id.startsWith('ds:') &&
        draftedNameKeys.has(p.name.toLowerCase() + '|' + p.pos)
      )
        continue;
      counts.set(p.tier, (counts.get(p.tier) || 0) + 1);
    }
    const tiers = [...counts.keys()]
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map((tier) => ({ tier, left: counts.get(tier) }));
    if (tiers.length) out[pos] = tiers;
  }
  return out;
}

// Human-readable description of the snake-turn geometry — pros plan pairs at a turn, and the
// asymmetric gaps (e.g. 5 then 27 from slot 14/16) change what "wait one round" means.
function turnProfile(draftState) {
  const picks = [draftState.currentPickNo, draftState.myNextPickNo, draftState.myFollowingPickNo]
    .concat([])
    .filter((n) => Number.isFinite(n));
  const mine = [draftState.myNextPickNo, draftState.myFollowingPickNo].filter((n) => Number.isFinite(n));
  if (mine.length < 2) return null;
  const gap = mine[1] - mine[0] - 1;
  if (draftState.isMyTurn) {
    return `on the clock now; next pick in ${mine[0] - draftState.currentPickNo} picks — plan this pick and that one as a pair`;
  }
  return `${draftState.picksUntilMine} picks until yours, then ${gap} picks between your next two — plan those two as a pair, then survive the long gap`;
}

// trending: optional Map<player_id, add_count> (live Sleeper adds). teamContext: optional
// {TEAM: {identity, implication}} from data/team-context-2026.json — attached per candidate.
export function buildUserPayload({ league, draftState, engineResult, pool, trending, teamContext }) {
  const byId = new Map((pool || []).map((p) => [p.id, p]));
  const draftedIds = draftState.draftedIds;
  const hasTrending = trending && typeof trending.get === 'function';

  // Name+pos keys of drafted players (from pick metadata) — catches degraded-mode ds: ids.
  const draftedNameKeys = new Set();
  for (const pick of draftState.picks || []) {
    const m = pick && pick.metadata;
    if (!m || (!m.first_name && !m.last_name)) continue;
    const nm = `${m.first_name || ''} ${m.last_name || ''}`.trim().toLowerCase();
    if (nm) draftedNameKeys.add(nm + '|' + String(m.position || '').toUpperCase());
  }

  // My roster + open starter slots.
  const mine = greedyFill(draftState.myPlayerIds, league.rosterPositions, byId);

  // My starter bye weeks (filled entries align with myPlayerIds order) — for byeOverlap.
  const myStarterByes = [];
  const myRbTeams = new Set();
  const myQbTeams = new Set();
  (mine.filled || []).forEach((f, i) => {
    const id = (draftState.myPlayerIds || [])[i];
    const p = id ? byId.get(id) : null;
    if (!p) return;
    if (!NON_STARTER_SLOTS.has(f.slotFilled) && p.byeWeek !== null && p.byeWeek !== undefined) {
      myStarterByes.push(p.byeWeek);
    }
    if (p.team) {
      if (p.pos === 'RB') myRbTeams.add(p.team);
      if (p.pos === 'QB') myQbTeams.add(p.team);
    }
  });

  // Revealed room behavior: per-slot reach tendency (adp − pick_no; positive = reaches ahead
  // of market) and positional lean, from the picks actually made. This is where opponent
  // mistakes become exploitable signals.
  const slotStats = new Map();
  for (const pick of draftState.picks || []) {
    const slot = pick && pick.draft_slot;
    if (!Number.isFinite(slot)) continue;
    let st = slotStats.get(slot);
    if (!st) {
      st = { n: 0, reachSum: 0, reachN: 0, posCounts: {} };
      slotStats.set(slot, st);
    }
    st.n += 1;
    const pos = pick.metadata && pick.metadata.position ? String(pick.metadata.position).toUpperCase() : null;
    if (pos) st.posCounts[pos] = (st.posCounts[pos] || 0) + 1;
    const p = pick.player_id ? byId.get(pick.player_id) : null;
    if (p && p.adp != null && Number.isFinite(pick.pick_no)) {
      st.reachSum += p.adp - pick.pick_no;
      st.reachN += 1;
    }
  }
  function slotTendency(slot) {
    const st = slotStats.get(slot);
    if (!st || st.reachN < 2) return null;
    const avg = st.reachSum / st.reachN;
    if (avg >= 4) return `reaches +${avg.toFixed(1)} vs ADP`;
    if (avg <= -4) return `lets value fall ${avg.toFixed(1)} vs ADP`;
    return null;
  }
  function slotLean(slot) {
    const st = slotStats.get(slot);
    if (!st || st.n < 4) return null;
    for (const [pos, n] of Object.entries(st.posCounts)) {
      if (n >= 3 && n / st.n >= 0.6) return `${pos}-heavy (${n}/${st.n})`;
    }
    return null;
  }

  // Opponents picking before my next pick: unfilled starter needs + revealed tendencies.
  const opponents = [];
  for (const slot of draftState.slotsBetween || []) {
    const ids =
      draftState.slotPlayerIds && draftState.slotPlayerIds.get
        ? draftState.slotPlayerIds.get(slot) || []
        : [];
    const filledSlot = greedyFill(ids, league.rosterPositions, byId);
    opponents.push(
      compact({ slot, needs: filledSlot.openStarters, tendency: slotTendency(slot), lean: slotLean(slot) })
    );
  }

  // Room-wide reads: the most extreme revealed behaviors (max 3, only when meaningful).
  const roomReads = [];
  const ranked = [...slotStats.entries()]
    .filter(([, st]) => st.reachN >= 3)
    .map(([slot, st]) => ({ slot, avg: st.reachSum / st.reachN }))
    .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg));
  for (const r of ranked.slice(0, 2)) {
    if (Math.abs(r.avg) >= 5) {
      roomReads.push(`slot ${r.slot} ${r.avg > 0 ? 'reaches +' + r.avg.toFixed(1) : 'drafts value ' + r.avg.toFixed(1)} vs ADP`);
    }
  }
  for (const [slot] of slotStats) {
    const lean = slotLean(slot);
    if (lean && roomReads.length < 3) roomReads.push(`slot ${slot} ${lean}`);
  }

  // Candidates — read the engine's already-scoring-adjusted numbers.
  const candidates = (engineResult.candidates || []).map((c) => {
    const p = c.player;
    // byeOverlap: how many of my current starters share this candidate's bye (omit when 0).
    let byeOverlap = null;
    if (p.byeWeek !== null && p.byeWeek !== undefined) {
      const n = myStarterByes.filter((b) => b === p.byeWeek).length;
      if (n > 0) byeOverlap = n;
    }
    // handcuff: candidate RB shares an NFL team with one of my RBs (omit otherwise).
    const handcuff = p.pos === 'RB' && p.team && myRbTeams.has(p.team) ? true : null;
    // stacksWithMyQB: candidate WR/TE shares an NFL team with my QB (omit otherwise).
    const stacksWithMyQB =
      (p.pos === 'WR' || p.pos === 'TE') && p.team && myQbTeams.has(p.team) ? true : null;
    // trendingAdds: live Sleeper add count when a trending map is supplied (omit when absent).
    let trendingAdds = null;
    if (hasTrending) {
      const t = trending.get(p.id);
      if (t !== null && t !== undefined) trendingAdds = t;
    }
    // Per-team offensive context (identity + fantasy implication), when the dataset is present.
    let teamCtx = null;
    if (teamContext && p.team && teamContext[p.team]) {
      const tc = teamContext[p.team];
      teamCtx = [tc.identity, tc.implication].filter(Boolean).join(' · ') || null;
    }
    return compact({
      name: p.name,
      pos: p.pos,
      team: p.team,
      bye: p.byeWeek,
      projPts: p.projPts === null ? null : round1(p.projPts),
      vbd: c.vbd === null || c.vbd === undefined ? null : round1(c.vbd),
      adp: p.adp,
      survival: c.survival === null || c.survival === undefined ? null : round2(c.survival),
      needFactor: c.needFactor === null || c.needFactor === undefined ? null : round2(c.needFactor),
      tierStatus: c.tierStatus,
      bestAtPosAtNextPick:
        c.bestAtPosAtNextPick === null || c.bestAtPosAtNextPick === undefined
          ? null
          : round1(c.bestAtPosAtNextPick),
      byeOverlap,
      handcuff,
      stacksWithMyQB,
      trendingAdds,
      teamCtx,
      // Self-labeling value-fall/reach signals (split so the sign can never be misread):
      fallenPastAdp: c.adpDelta !== null && c.adpDelta >= 3 ? c.adpDelta : null,
      earlyByPicks: c.adpDelta !== null && c.adpDelta <= -3 ? -c.adpDelta : null,
      note: p.note,
      risk: p.risk,
      injuryStatus: p.injuryStatus,
      marketDisagreement: p.marketDisagreement
    });
  });

  // My next 3 upcoming pick numbers (from draft-math myPickNos, only those past the current pick).
  let myUpcomingPicks = null;
  if (draftState.mySlot && league.teams && Array.isArray(league.rosterPositions)) {
    // Actual draft rounds (they can differ from roster-slot count); slot count is the fallback.
    const rounds = league.rounds || league.rosterPositions.length;
    myUpcomingPicks = myPickNos(draftState.mySlot, league.teams, rounds)
      .filter((n) => n > draftState.currentPickNo)
      .slice(0, 3);
  }

  // MC block from the engine's Monte Carlo sim, when present.
  let mc = null;
  if (engineResult.mc) {
    mc = {
      pTierSurvives: engineResult.mc.pTierSurvives,
      note:
        'survival & bestAtPosAtNextPick come from a ' +
        engineResult.mc.iterations +
        '-run opponent-need-biased draft simulation'
    };
  }

  const payload = compact({
    league: compact({
      teams: league.teams,
      scoringLabel: league.scoringLabel,
      recPoints: league.recPoints,
      isSuperflex: league.isSuperflex,
      notableScoring: emptyToNull(notableScoring(league.scoring, league.recPoints))
    }),
    draft: compact({
      round: draftState.currentRound,
      pickNo: draftState.currentPickNo,
      myslot: draftState.mySlot,
      picksUntilMine: draftState.picksUntilMine,
      myNextPickNo: draftState.myNextPickNo,
      myFollowingPickNo: draftState.myFollowingPickNo
    }),
    myUpcomingPicks,
    turnProfile: turnProfile(draftState),
    roomReads: roomReads.length ? roomReads : null,
    myRoster: mine.filled,
    openStarters: mine.openStarters,
    opponentsBeforeMyNextPick: opponents,
    tiersRemaining: emptyToNull(tiersRemaining(pool, draftedIds, draftedNameKeys)),
    mc,
    runs: emptyToNull(engineResult.runs),
    positionSummary: emptyToNull(engineResult.positionSummary),
    candidates
  });

  return JSON.stringify(payload);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function emptyToNull(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return Object.keys(obj).length ? obj : null;
}
