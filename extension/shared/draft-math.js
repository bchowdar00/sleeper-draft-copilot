// draft-math.js — pure snake-draft + league-context math (B2).
// No chrome.* and no DOM: must import cleanly under node >=18 for tests.

// Preset scoring tables used when no real league backs the draft (mock drafts),
// and as the defensive fallback for any scoring key a real league omits.
// Shared base across all three PPR variants (DESIGN §3.2).
const SCORING_BASE = {
  pass_td: 4,
  pass_yd: 0.04,
  pass_int: -1,
  rush_yd: 0.1,
  rush_td: 6,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2
};

export const SCORING_PRESETS = {
  std: { ...SCORING_BASE, rec: 0 },
  half: { ...SCORING_BASE, rec: 0.5 },
  ppr: { ...SCORING_BASE, rec: 1 }
};

// Map Sleeper draft.metadata.scoring_type → preset key (+ superflex flag for 2qb).
function presetForScoringType(scoringType) {
  switch (String(scoringType || '').toLowerCase()) {
    case 'std':
    case 'standard':
      return { preset: 'std', superflex: false };
    case 'half_ppr':
    case 'half':
      return { preset: 'half', superflex: false };
    case '2qb':
    case 'superflex':
      return { preset: 'ppr', superflex: true };
    case 'ppr':
      return { preset: 'ppr', superflex: false };
    default:
      // Undocumented / missing scoring_type: default to PPR (the doc's primary
      // target format) as the least-surprising defensive fallback.
      return { preset: 'ppr', superflex: false };
  }
}

// Snake pick number for a given slot/round. Odd rounds run left→right,
// even rounds reverse (DESIGN §3.2).
export function pickNoFor(slot, round, teams) {
  if (round % 2 === 1) return (round - 1) * teams + slot;
  return round * teams - slot + 1;
}

export function slotForPickNo(pickNo, teams) {
  const round = roundForPickNo(pickNo, teams);
  const indexInRound = pickNo - (round - 1) * teams; // 1..teams
  if (round % 2 === 1) return indexInRound;
  return teams - indexInRound + 1;
}

export function roundForPickNo(pickNo, teams) {
  return Math.ceil(pickNo / teams);
}

export function myPickNos(slot, teams, rounds) {
  const out = [];
  for (let r = 1; r <= rounds; r++) out.push(pickNoFor(slot, r, teams));
  return out; // ascending by construction
}

// Build a roster_positions array from a mock draft's slots_* settings.
// Dedicated slots first, then flex/superflex, then bench (defensive reads).
function rosterPositionsFromSlots(s = {}) {
  const out = [];
  const push = (pos, n) => {
    for (let i = 0; i < (Number(n) || 0); i++) out.push(pos);
  };
  push('QB', s.slots_qb);
  push('RB', s.slots_rb);
  push('WR', s.slots_wr);
  push('TE', s.slots_te);
  push('FLEX', s.slots_flex);
  push('SUPER_FLEX', s.slots_super_flex);
  push('K', s.slots_k);
  push('DEF', s.slots_def);
  push('BN', s.slots_bn);
  return out;
}

function countQb(rosterPositions) {
  return rosterPositions.filter((p) => p === 'QB').length;
}

export function buildLeagueContext({ league, draft }) {
  const draftSettings = (draft && draft.settings) || {};
  const scoringType = (draft && draft.metadata && draft.metadata.scoring_type) || null;
  const { preset, superflex: presetSuperflex } = presetForScoringType(scoringType);
  const presetScoring = SCORING_PRESETS[preset];

  let rosterPositions;
  let scoring;
  let settings;
  let teams;

  if (league) {
    rosterPositions = Array.isArray(league.roster_positions)
      ? league.roster_positions.slice()
      : rosterPositionsFromSlots(draftSettings);
    // Real scoring_settings, with any missing key defaulting to the preset value
    // (DESIGN §3.2: "any missing key falls back to preset value").
    scoring = { ...presetScoring, ...(league.scoring_settings || {}) };
    settings = league.settings || draftSettings;
    teams =
      Number(league.total_rosters) ||
      Number(draftSettings.teams) ||
      countSlotsTeams(rosterPositions);
  } else {
    rosterPositions = rosterPositionsFromSlots(draftSettings);
    scoring = { ...presetScoring };
    settings = draftSettings;
    teams = Number(draftSettings.teams) || 0;
  }

  const rounds = Number(draftSettings.rounds) || rosterPositions.length || 0;
  const recPoints = scoring.rec != null ? scoring.rec : 0;
  const isSuperflex =
    rosterPositions.includes('SUPER_FLEX') || countQb(rosterPositions) >= 2 || presetSuperflex;

  let scoringLabel;
  if (recPoints >= 1) scoringLabel = 'PPR';
  else if (recPoints > 0) scoringLabel = 'Half-PPR';
  else scoringLabel = 'Standard';
  if (isSuperflex) scoringLabel += ' Superflex';

  return {
    teams,
    rounds,
    scoring,
    rosterPositions,
    recPoints,
    isSuperflex,
    scoringLabel
  };
}

function countSlotsTeams() {
  // Fallback only; teams should always come from settings/league.
  return 0;
}

export function resolveMySlot({ draft, myUserId }) {
  if (!draft || !draft.draft_order || myUserId == null) return null;
  const slot = draft.draft_order[myUserId];
  return slot != null ? Number(slot) : null;
}

export function buildDraftState({ draft, picks, mySlot }) {
  const settings = (draft && draft.settings) || {};
  const teams = Number(settings.teams) || 0;
  const rounds = Number(settings.rounds) || 0;
  const pickList = Array.isArray(picks) ? picks : [];

  const currentPickNo = pickList.length + 1;
  const currentRound = teams ? roundForPickNo(currentPickNo, teams) : 1;
  const onTheClockSlot = teams ? slotForPickNo(currentPickNo, teams) : null;

  const isMyTurn = mySlot != null && onTheClockSlot === mySlot;

  // My pick schedule.
  let myNextPickNo = null;
  let myFollowingPickNo = null;
  if (mySlot != null && teams && rounds) {
    const mine = myPickNos(mySlot, teams, rounds);
    const upcoming = mine.filter((p) => p >= currentPickNo);
    myNextPickNo = upcoming.length ? upcoming[0] : null;
    myFollowingPickNo = upcoming.length > 1 ? upcoming[1] : null;
  }
  const picksUntilMine = myNextPickNo != null ? Math.max(myNextPickNo - currentPickNo, 0) : null;

  // Drafted ids + per-slot / my player id tracking (in pick order).
  const draftedIds = new Set();
  const myPlayerIds = [];
  const slotPlayerIds = new Map();
  const ordered = pickList.slice().sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
  for (const pick of ordered) {
    const pid = pick.player_id;
    if (pid) draftedIds.add(pid);
    const slot = Number(pick.draft_slot);
    if (!slotPlayerIds.has(slot)) slotPlayerIds.set(slot, []);
    if (pid) slotPlayerIds.get(slot).push(pid);
    if (mySlot != null && slot === mySlot && pid) myPlayerIds.push(pid);
  }

  // Slots picking between now and my next real pick (excluding me). When on the
  // clock, the relevant gap is up to my FOLLOWING pick (DESIGN §3.2 / §6 survival).
  const waitTarget = isMyTurn ? myFollowingPickNo : myNextPickNo;
  const slotsBetween = [];
  if (teams && waitTarget != null) {
    for (let p = currentPickNo; p < waitTarget; p++) {
      const s = slotForPickNo(p, teams);
      if (s !== mySlot) slotsBetween.push(s);
    }
  }

  return {
    draftId: draft && draft.draft_id,
    status: draft && draft.status,
    type: draft && draft.type,
    picks: pickList,
    currentPickNo,
    currentRound,
    onTheClockSlot,
    mySlot: mySlot != null ? mySlot : null,
    isMyTurn,
    picksUntilMine,
    myNextPickNo,
    myFollowingPickNo,
    draftedIds,
    myPlayerIds,
    slotPlayerIds,
    slotsBetween
  };
}
