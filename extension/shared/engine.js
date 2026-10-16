// engine.js — the local value/scoring math (B2).
// Pure ES module: no chrome.*, no DOM. Runs under node >=18 for tests.

const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE']);

// Per-FLEX and per-SUPER_FLEX positional share added to starter counts (DESIGN §3.3 #4).
const FLEX_SHARE = { RB: 0.35, WR: 0.55, TE: 0.1 };
const SUPERFLEX_SHARE = { QB: 0.75, RB: 0.1, WR: 0.15 };

// v1.1 Monte Carlo (DESIGN-1.1 §W1): position index layout for the allocation-free sim.
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POS_IDX = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
// Flex/superflex eligibility keyed by POS_IDX (RB/WR/TE flex; QB/RB/WR/TE superflex).
const FLEX_ELIG_IDX = [false, true, true, true, false, false];
const SF_ELIG_IDX = [true, true, true, true, false, false];

// Keys excluded from the scoring summation in projPts (DESIGN §3.3 #1).
function isExcludedStatKey(k) {
  return /^adp/.test(k) || /^pos_adp/.test(k) || k === 'gp';
}

// ---- normalizeName ---------------------------------------------------------
// lowercase, strip diacritics/punctuation and jr|sr|ii|iii|iv name suffixes.
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ') // generational suffixes
    .replace(/\s+/g, ' ')
    .trim();
}

function lastNameInitialKey(name, pos) {
  const norm = normalizeName(name);
  const parts = norm.split(' ').filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0][0] || '';
  return `${last}|${firstInitial}|${pos}`;
}

// Season points under this league's scoring (DESIGN §3.3 #1).
function computeProjPts(stats, scoring, recPoints) {
  if (!stats) return null;
  let sum = 0;
  let overlap = 0;
  for (const k of Object.keys(stats)) {
    if (isExcludedStatKey(k)) continue;
    if (scoring[k] == null) continue;
    const v = Number(stats[k]);
    if (!Number.isFinite(v)) continue;
    sum += v * Number(scoring[k]);
    overlap += 1;
  }
  if (overlap > 0 && sum > 0) return sum;
  // Fallback to a precomputed points column matching the league's PPR basis.
  let fallback;
  if (recPoints >= 1) fallback = stats.pts_ppr;
  else if (recPoints > 0) fallback = stats.pts_half_ppr;
  else fallback = stats.pts_std;
  return fallback != null && Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

// Format-matched ADP; 999 sentinel or missing → null (DESIGN §3.3 #2).
function computeAdp(stats, isSuperflex, recPoints) {
  if (!stats) return null;
  let key;
  if (isSuperflex) key = 'adp_2qb';
  else if (recPoints >= 1) key = 'adp_ppr';
  else if (recPoints > 0) key = 'adp_half_ppr';
  else key = 'adp_std';
  const v = stats[key];
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n >= 999) return null;
  return n;
}

// Standard normal CDF via the Abramowitz & Stegun erf approximation
// (Handbook of Mathematical Functions, formula 7.1.26; max error ~1.5e-7).
function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  // A&S 7.1.26 coefficients.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// Probability the player is still on the board at my next relevant pick (DESIGN §3.3 #6).
function survivalFor(adp, targetPick) {
  // No future pick to wait for (final round): constant for ALL candidates, including
  // adp-null ones, so the urgency multiplier cannot reorder them.
  if (targetPick == null) return 0.5;
  if (adp == null) return 0.95;
  const sigma = Math.max(adp / 4, 3);
  const s = 1 - normalCdf((targetPick - adp) / sigma);
  return Math.min(Math.max(s, 0), 1);
}

// ---- buildPlayerPool -------------------------------------------------------
export function buildPlayerPool({ projections, playersSlim, dataset, league }) {
  const scoring = (league && league.scoring) || {};
  const recPoints = league && league.recPoints != null ? league.recPoints : scoring.rec || 0;
  const isSuperflex = !!(league && league.isSuperflex);
  const slimMap = (playersSlim && playersSlim.players) || playersSlim || {};
  const byeWeeks = (dataset && dataset.byeWeeks) || {};

  const projEntries =
    projections instanceof Map ? Array.from(projections.entries()) : Object.entries(projections || {});

  // Degraded mode (DESIGN §3.8): no projections → build the pool from the bundled dataset,
  // matched to players/nfl for real player_ids (so drafted-pick filtering still works) and
  // injury tags. projPts stays null; the caller synthesizes it via the ADP-rank curve.
  if (projEntries.length === 0) {
    const slimByNamePos = new Map();
    for (const [pid, s] of Object.entries(slimMap)) {
      if (!s || !s.full_name || !s.position) continue;
      slimByNamePos.set(`${normalizeName(s.full_name)}|${String(s.position).toUpperCase()}`, { pid, slim: s });
    }
    const dsPool = [];
    for (const row of (dataset && dataset.players) || []) {
      const pos = (row.pos || '').toUpperCase();
      if (!FANTASY_POSITIONS.includes(pos)) continue;
      const hit = pos === 'DEF' ? null : slimByNamePos.get(`${normalizeName(row.name)}|${pos}`);
      const team = row.team && row.team !== 'FA' ? row.team : hit && hit.slim.team ? hit.slim.team : null;
      dsPool.push({
        id: pos === 'DEF' ? (row.team || row.name) : hit ? hit.pid : `ds:${normalizeName(row.name)}|${pos}`,
        name: row.name,
        pos,
        team,
        byeWeek: byeWeeks[team] != null ? byeWeeks[team] : null,
        projPts: null,
        adp: row.adp != null ? row.adp : null,
        tier: row.tier != null ? row.tier : null,
        posRank: row.posRank != null ? row.posRank : null,
        note: row.note || '',
        risk: Array.isArray(row.risk) ? row.risk.slice() : [],
        injuryStatus: hit && hit.slim.injury_status != null ? hit.slim.injury_status : null,
        marketDisagreement: marketDisagreementFromNote(row.note)
      });
    }
    return dsPool;
  }

  const pool = [];
  for (const [pid, entry] of projEntries) {
    if (!entry) continue;
    const stats = entry.stats || {};
    const p = entry.player || {};
    const pos = (p.position || p.pos || '').toUpperCase();
    if (!FANTASY_POSITIONS.includes(pos)) continue;

    const slim = slimMap[pid] || {};
    const team = p.team || slim.team || null;
    const name =
      p.full_name ||
      (p.first_name || p.last_name ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : null) ||
      slim.full_name ||
      pid;

    // DEF ids are the team code (e.g. "SF").
    const id = pos === 'DEF' ? (team || pid) : pid;

    const record = {
      id,
      name,
      pos,
      team,
      byeWeek: byeWeeks[team] != null ? byeWeeks[team] : slim.bye != null ? slim.bye : null,
      projPts: computeProjPts(stats, scoring, recPoints),
      adp: computeAdp(stats, isSuperflex, recPoints),
      tier: null,
      posRank: null,
      note: '',
      risk: [],
      injuryStatus: slim.injury_status != null ? slim.injury_status : null,
      marketDisagreement: null
    };
    pool.push(record);
  }

  mergeDataset(pool, dataset);
  return pool;
}

// Detect market-disagreement language in a dataset note (DESIGN §2 PlayerRecord).
function marketDisagreementFromNote(note) {
  if (!note) return null;
  return /market split|market|overvalued|undervalued|disagree/i.test(note) ? note : null;
}

function mergeDataset(pool, dataset) {
  const rows = (dataset && dataset.players) || [];
  if (!rows.length) return;

  // Index the pool for the three match strategies.
  const byNamePos = new Map();
  const byLastInitPos = new Map();
  const byTeamDef = new Map();
  for (const rec of pool) {
    byNamePos.set(`${normalizeName(rec.name)}|${rec.pos}`, rec);
    const li = lastNameInitialKey(rec.name, rec.pos);
    if (li && !byLastInitPos.has(li)) byLastInitPos.set(li, rec);
    if (rec.pos === 'DEF' && rec.team) byTeamDef.set(rec.team.toUpperCase(), rec);
  }

  for (const row of rows) {
    const pos = (row.pos || '').toUpperCase();
    let rec = null;
    if (pos === 'DEF') {
      rec = row.team ? byTeamDef.get(String(row.team).toUpperCase()) : null;
    } else {
      rec = byNamePos.get(`${normalizeName(row.name)}|${pos}`);
      if (!rec) {
        const li = lastNameInitialKey(row.name, pos);
        if (li) rec = byLastInitPos.get(li);
      }
    }
    if (!rec) continue; // unmatched dataset rows dropped silently
    rec.tier = row.tier != null ? row.tier : null;
    rec.posRank = row.posRank != null ? row.posRank : null;
    rec.note = row.note || '';
    rec.risk = Array.isArray(row.risk) ? row.risk.slice() : [];
    rec.marketDisagreement = marketDisagreementFromNote(row.note);
  }
}

// ---- simulateToNextPick (v1.1 Monte Carlo, DESIGN-1.1 §W1) -----------------
// Estimates, by repeated draft simulation of the intervening picks, the chance each
// undrafted player survives to my next relevant pick, the distribution of best-remaining
// VBD per position at that pick, and the chance each position's current best tier survives.
// `rng` is injectable for deterministic tests. The inner per-pick loop is allocation-free.
export function simulateToNextPick({
  undrafted,
  draftState,
  league,
  opponentStates,
  iterations = 250,
  rng = Math.random
}) {
  const teams = league.teams;
  const rounds = league.rounds;
  const start = draftState.currentPickNo;
  // Wait-target: my next pick when it's not my turn, else the one after it.
  const target = draftState.isMyTurn ? draftState.myFollowingPickNo : draftState.myNextPickNo;
  const all = undrafted || [];
  const n = all.length;

  // Precompute per-player arrays. VBD is read from an attached `.vbd` (set by evaluate
  // before it calls the sim), falling back to raw projPts when absent.
  const vbdOf = new Float64Array(n);
  const posIdx = new Int32Array(n);
  const adpOf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = all[i];
    vbdOf[i] = Number.isFinite(p.vbd) ? p.vbd : Number.isFinite(p.projPts) ? p.projPts : 0;
    posIdx[i] = POS_IDX[p.pos] != null ? POS_IDX[p.pos] : 1;
    adpOf[i] = p.adp != null && Number.isFinite(p.adp) ? p.adp : Infinity;
  }

  const numPicks = target == null ? 0 : target - start;

  // Neutral fallback: no future pick to wait for, OR the pool is too small to simulate the
  // intervening picks meaningfully (fewer players than picks would drain the board entirely).
  // Evaluate keeps its closed-form survival when the sim is neutral.
  if (target == null || numPicks <= 0 || n <= numPicks) {
    return neutralMcResult(all, vbdOf, posIdx, iterations);
  }

  // adp-sorted order (ascending; null/Infinity last) — the "top 12 remaining by adp" pool.
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => adpOf[a] - adpOf[b]);

  // Per-slot need template. Group opponentStates by slot so a team's picks share depletion.
  const NKINDS = 8; // QB RB WR TE K DEF FLEX SUPER_FLEX
  const slotRow = new Map();
  const rows = [];
  const pickRow = new Int32Array(numPicks);
  const suppress = new Uint8Array(numPicks); // K/DEF suppressed before the final 2 rounds
  for (let k = 0; k < numPicks; k++) {
    const os = opponentStates[k] || {};
    const slot = os.slot != null ? os.slot : -(k + 1);
    let ri = slotRow.get(slot);
    if (ri === undefined) {
      ri = rows.length;
      slotRow.set(slot, ri);
      const us = os.unfilledStarters || {};
      const row = new Float64Array(NKINDS);
      row[0] = us.QB || 0;
      row[1] = us.RB || 0;
      row[2] = us.WR || 0;
      row[3] = us.TE || 0;
      row[4] = us.K || 0;
      row[5] = us.DEF || 0;
      row[6] = us.FLEX || 0;
      row[7] = us.SUPER_FLEX || 0;
      rows.push(row);
    }
    pickRow[k] = ri;
    const pickNo = start + k;
    const round = Math.ceil(pickNo / teams);
    suppress[k] = round < rounds - 1 ? 1 : 0;
  }
  const nRows = rows.length;
  const templateFlat = new Float64Array(nRows * NKINDS);
  for (let r = 0; r < nRows; r++) templateFlat.set(rows[r], r * NKINDS);
  const work = new Float64Array(nRows * NKINDS);

  // Pre-sim best (lowest) tier per pos + membership flags.
  const bestTier = new Array(6).fill(null);
  for (let i = 0; i < n; i++) {
    const t = all[i].tier;
    if (t == null) continue;
    const pk = posIdx[i];
    if (bestTier[pk] == null || t < bestTier[pk]) bestTier[pk] = t;
  }
  const tierMemberPos = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const pk = posIdx[i];
    const t = all[i].tier;
    tierMemberPos[i] = t != null && t === bestTier[pk] ? pk : -1;
  }
  const hasTier = new Array(6);
  for (let p = 0; p < 6; p++) hasTier[p] = bestTier[p] != null;

  // Reusable buffers (no per-pick allocation).
  const taken = new Uint8Array(n);
  const candBuf = new Int32Array(12);
  const wBuf = new Float64Array(12);
  const expTable = new Float64Array(12);
  for (let j = 0; j < 12; j++) expTable[j] = Math.exp(-j / 3);

  const availCount = new Float64Array(n);
  const samples = [];
  for (let p = 0; p < 6; p++) samples.push(new Float64Array(iterations));
  const tierSurvCount = new Float64Array(6);
  const iterBest = new Float64Array(6);
  const iterTierAlive = new Uint8Array(6);

  for (let it = 0; it < iterations; it++) {
    taken.fill(0);
    work.set(templateFlat);

    for (let k = 0; k < numPicks; k++) {
      // Gather the top-12 remaining players by adp.
      let cnt = 0;
      for (let oi = 0; oi < n && cnt < 12; oi++) {
        const i = order[oi];
        if (taken[i]) continue;
        candBuf[cnt++] = i;
      }
      if (cnt === 0) break;
      const base = pickRow[k] * NKINDS;
      const sup = suppress[k];
      let sum = 0;
      for (let j = 0; j < cnt; j++) {
        const i = candBuf[j];
        const pk = posIdx[i];
        let mult;
        if ((pk === 4 || pk === 5) && sup) mult = 0.02;
        else if (work[base + pk] > 0) mult = 2.0;
        else if (FLEX_ELIG_IDX[pk] && work[base + 6] > 0) mult = 1.2;
        else if (SF_ELIG_IDX[pk] && work[base + 7] > 0) mult = 1.2;
        else mult = 0.45;
        const w = expTable[j] * mult;
        wBuf[j] = w;
        sum += w;
      }
      // Draw one player by normalized weight.
      let r = rng() * sum;
      let chosen = candBuf[cnt - 1];
      for (let j = 0; j < cnt; j++) {
        r -= wBuf[j];
        if (r <= 0) {
          chosen = candBuf[j];
          break;
        }
      }
      taken[chosen] = 1;
      // Decrement that team's need for the chosen position.
      const cpk = posIdx[chosen];
      if (work[base + cpk] > 0) work[base + cpk] -= 1;
      else if (FLEX_ELIG_IDX[cpk] && work[base + 6] > 0) work[base + 6] -= 1;
      else if (SF_ELIG_IDX[cpk] && work[base + 7] > 0) work[base + 7] -= 1;
    }

    // Aggregate this iteration in a single pass over the pool.
    for (let p = 0; p < 6; p++) {
      iterBest[p] = -Infinity;
      iterTierAlive[p] = 0;
    }
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      availCount[i] += 1;
      const pk = posIdx[i];
      const v = vbdOf[i];
      if (v > iterBest[pk]) iterBest[pk] = v;
      const tm = tierMemberPos[i];
      if (tm >= 0) iterTierAlive[tm] = 1;
    }
    for (let p = 0; p < 6; p++) {
      samples[p][it] = iterBest[p];
      if (iterTierAlive[p]) tierSurvCount[p] += 1;
    }
  }

  const pAvail = new Map();
  for (let i = 0; i < n; i++) pAvail.set(all[i].id, availCount[i] / iterations);

  const expBestVbdByPos = {};
  for (let p = 0; p < 6; p++) {
    const finite = [];
    for (let it = 0; it < iterations; it++) {
      const v = samples[p][it];
      if (v !== -Infinity) finite.push(v);
    }
    if (!finite.length) {
      expBestVbdByPos[POS_ORDER[p]] = { p25: null, p50: null, p75: null };
    } else {
      finite.sort((a, b) => a - b);
      expBestVbdByPos[POS_ORDER[p]] = {
        p25: quantileSorted(finite, 0.25),
        p50: quantileSorted(finite, 0.5),
        p75: quantileSorted(finite, 0.75)
      };
    }
  }

  const pTierSurvives = {};
  for (let p = 0; p < 6; p++) {
    pTierSurvives[POS_ORDER[p]] = hasTier[p] ? tierSurvCount[p] / iterations : 1;
  }

  return { pAvail, expBestVbdByPos, pTierSurvives, iterations, neutral: false };
}

// Neutral MC result: everyone survives, expBest = current best remaining VBD per pos.
function neutralMcResult(all, vbdOf, posIdx, iterations) {
  const pAvail = new Map();
  for (const p of all) pAvail.set(p.id, 1);
  const best = new Float64Array(6).fill(-Infinity);
  for (let i = 0; i < all.length; i++) {
    const pk = posIdx[i];
    if (vbdOf[i] > best[pk]) best[pk] = vbdOf[i];
  }
  const expBestVbdByPos = {};
  const pTierSurvives = {};
  for (let p = 0; p < 6; p++) {
    const v = best[p] === -Infinity ? null : best[p];
    expBestVbdByPos[POS_ORDER[p]] = { p25: v, p50: v, p75: v };
    pTierSurvives[POS_ORDER[p]] = 1;
  }
  return { pAvail, expBestVbdByPos, pTierSurvives, iterations, neutral: true };
}

// Linear-interpolated quantile over an ascending-sorted array.
function quantileSorted(sorted, q) {
  const len = sorted.length;
  if (len === 0) return null;
  if (len === 1) return sorted[0];
  const idx = q * (len - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// Snake slot for a 1-based pick number (matches draft-math.slotForPickNo).
function slotForPickNoLocal(pickNo, teams) {
  const round = Math.ceil(pickNo / teams);
  const offset = pickNo - (round - 1) * teams;
  return round % 2 === 1 ? offset : teams - offset + 1;
}

// Build opponentStates aligned to the simulated picks (currentPickNo .. target-1),
// reusing the greedy roster fill. Same-slot picks share one unfilledStarters snapshot.
function buildOpponentStates(draftState, poolById, rosterPositions, teams, start, target) {
  const states = [];
  const slotPlayerIds = draftState.slotPlayerIds || new Map();
  const cache = new Map();
  for (let pickNo = start; pickNo < target; pickNo++) {
    const slot = slotForPickNoLocal(pickNo, teams);
    let us = cache.get(slot);
    if (!us) {
      const ids = slotPlayerIds.get(slot) || [];
      const fill = fillRoster(ids, poolById, draftState.picks, rosterPositions);
      us = {
        QB: fill.openDedicated.QB,
        RB: fill.openDedicated.RB,
        WR: fill.openDedicated.WR,
        TE: fill.openDedicated.TE,
        K: fill.openDedicated.K,
        DEF: fill.openDedicated.DEF,
        FLEX: fill.flexOpen,
        SUPER_FLEX: fill.superFlexOpen
      };
      cache.set(slot, us);
    }
    states.push({ slot, unfilledStarters: us });
  }
  return states;
}

// ---- evaluate --------------------------------------------------------------
export function evaluate({ pool, league, draftState }) {
  const teams = league.teams;
  const rounds = league.rounds;
  const rosterPositions = league.rosterPositions || [];
  const draftedIds = draftState.draftedIds || new Set();

  const poolById = new Map(pool.map((p) => [p.id, p]));
  // Synthetic "ds:" ids (degraded-mode players absent from players/nfl) can't match
  // pick player_ids — filter those by normalized name+pos from pick metadata instead.
  const draftedNameKeys = new Set();
  for (const pick of draftState.picks || []) {
    const m = pick && pick.metadata;
    if (!m || (!m.first_name && !m.last_name)) continue;
    const nm = normalizeName(`${m.first_name || ''} ${m.last_name || ''}`.trim());
    if (nm) draftedNameKeys.add(`${nm}|${String(m.position || '').toUpperCase()}`);
  }
  const undrafted = pool.filter(
    (p) =>
      !draftedIds.has(p.id) &&
      !(p.id.startsWith('ds:') && draftedNameKeys.has(`${normalizeName(p.name)}|${p.pos}`))
  );

  // Undrafted grouped by position (kept in projPts-desc order for reuse).
  const byPos = {};
  for (const pos of FANTASY_POSITIONS) byPos[pos] = [];
  for (const p of undrafted) {
    if (byPos[p.pos]) byPos[p.pos].push(p);
  }
  for (const pos of FANTASY_POSITIONS) {
    byPos[pos].sort((a, b) => (b.projPts ?? -Infinity) - (a.projPts ?? -Infinity));
  }

  // #4 starter slots per position (league-wide).
  const starterSlots = computeStarterSlots(rosterPositions, teams);

  // Drafted counts per position (authoritative from pick metadata, pool fallback).
  const draftedAtPos = {};
  for (const pos of FANTASY_POSITIONS) draftedAtPos[pos] = 0;
  for (const pick of draftState.picks || []) {
    if (!pick.player_id) continue;
    const pos =
      (pick.metadata && pick.metadata.position && pick.metadata.position.toUpperCase()) ||
      (poolById.get(pick.player_id) && poolById.get(pick.player_id).pos) ||
      null;
    if (pos && draftedAtPos[pos] != null) draftedAtPos[pos] += 1;
  }

  // #5 dynamic replacement level.
  const replacementPts = {};
  const unfilledAtPos = {};
  for (const pos of FANTASY_POSITIONS) {
    const unfilled = Math.max(Math.round(starterSlots[pos] || 0) - draftedAtPos[pos], 1);
    unfilledAtPos[pos] = unfilled;
    const arr = byPos[pos];
    if (!arr.length) {
      replacementPts[pos] = 0;
      continue;
    }
    const idx = Math.min(unfilled, arr.length - 1);
    const rp = arr[idx].projPts;
    replacementPts[pos] = rp != null ? rp : 0;
  }

  const vbdFor = (p) => (p.projPts != null ? p.projPts : 0) - (replacementPts[p.pos] || 0);

  // #6 survival: wait-target pick.
  const waitTarget = draftState.isMyTurn ? draftState.myFollowingPickNo : draftState.myNextPickNo;

  // #7 need factor: greedy-fill my current roster once.
  const rosterFill = fillRoster(draftState.myPlayerIds || [], poolById, draftState.picks, rosterPositions);

  // #9 best remaining tier per position.
  const bestTier = {};
  for (const pos of FANTASY_POSITIONS) {
    let best = null;
    for (const p of byPos[pos]) {
      if (p.tier != null && (best == null || p.tier < best)) best = p.tier;
    }
    bestTier[pos] = best;
  }

  // #10 position runs in the last 8 picks.
  const runs = computeRuns(draftState.picks || [], poolById);

  // Precompute survival for every undrafted player (needed for #12).
  const survivalById = new Map();
  for (const p of undrafted) survivalById.set(p.id, survivalFor(p.adp, waitTarget));

  // Build a scored candidate object per undrafted player.
  const scored = undrafted.map((player) => {
    const vbd = vbdFor(player);
    const survival = survivalById.get(player.id);
    const needFactor = needFactorFor(player.pos, rosterFill, draftState.currentRound, rounds);
    const tierStatus = tierStatusFor(player, byPos[player.pos], bestTier[player.pos]);
    const tierMult = tierStatus === 'LAST_IN_TIER' ? 1.15 : tierStatus === 'TIER_THIN' ? 1.08 : 1.0;
    const posRunning = (runs[player.pos] || 0) >= 4;
    const runBoost = posRunning && tierStatus != null;
    const runMult = runBoost ? 1.05 : 1.0;
    const scoringVbd = Math.max(vbd, 1); // #11 vbd floor for scoring purposes
    const score = scoringVbd * needFactor * tierMult * runMult * (0.6 + 0.4 * (1 - survival));
    // Value-fall signal: how far past their ADP the room has already let this player slide
    // (positive = fallen / free equity or hidden news; near zero = on schedule).
    const adpDelta =
      player.adp != null ? Math.round(draftState.currentPickNo - player.adp) : null;
    return {
      player,
      score,
      vbd,
      replacementPts: replacementPts[player.pos] || 0,
      survival,
      needFactor,
      tierStatus,
      runBoost,
      adpDelta,
      bestAtPosAtNextPick: null // filled below
    };
  });

  const scoredById = new Map(scored.map((c) => [c.player.id, c]));

  // #12 bestAtPosAtNextPick: best VBD among same-pos undrafted that survive (>=0.5),
  // excluding the candidate itself.
  for (const cand of scored) {
    let best = null;
    for (const other of byPos[cand.player.pos]) {
      if (other.id === cand.player.id) continue;
      if ((survivalById.get(other.id) || 0) < 0.5) continue;
      const v = vbdFor(other);
      if (best == null || v > best) best = v;
    }
    cand.bestAtPosAtNextPick = best;
  }

  // ---- v1.1 Monte Carlo overwrite (DESIGN-1.1 §W1) -------------------------
  // Run the availability sim once. When it returns a real (non-neutral) result,
  // overwrite each candidate's survival + bestAtPosAtNextPick and recompute score
  // (formula unchanged, now fed by MC survival). Neutral → keep the closed-form path.
  for (const p of undrafted) p.vbd = vbdFor(p); // sim reads best-remaining VBD per pos
  const mcTarget = draftState.isMyTurn ? draftState.myFollowingPickNo : draftState.myNextPickNo;
  const opponentStates =
    mcTarget != null
      ? buildOpponentStates(draftState, poolById, rosterPositions, teams, draftState.currentPickNo, mcTarget)
      : [];
  const mc = simulateToNextPick({ undrafted, draftState, league, opponentStates });
  let mcForResult = null;
  if (!mc.neutral) {
    mcForResult = { pTierSurvives: mc.pTierSurvives, expBestVbdByPos: mc.expBestVbdByPos, iterations: mc.iterations };
    for (const cand of scored) {
      const pa = mc.pAvail.get(cand.player.id);
      if (pa != null) cand.survival = pa;
      const q = mc.expBestVbdByPos[cand.player.pos];
      if (q && q.p50 != null) cand.bestAtPosAtNextPick = q.p50;
      const tierMult = cand.tierStatus === 'LAST_IN_TIER' ? 1.15 : cand.tierStatus === 'TIER_THIN' ? 1.08 : 1.0;
      const runMult = cand.runBoost ? 1.05 : 1.0;
      const scoringVbd = Math.max(cand.vbd, 1);
      cand.score = scoringVbd * cand.needFactor * tierMult * runMult * (0.6 + 0.4 * (1 - cand.survival));
    }
  }

  // #13 candidate selection: top 8 by score, then guarantee the raw-VBD leader
  // and the score-leader at each of QB/RB/WR/TE, cap 10, sorted by score desc.
  scored.sort((a, b) => b.score - a.score);
  const selected = [];
  const selectedIds = new Set();
  const add = (cand) => {
    if (!cand || selectedIds.has(cand.player.id) || selected.length >= 10) return;
    selected.push(cand);
    selectedIds.add(cand.player.id);
  };
  for (let i = 0; i < scored.length && selected.length < 8; i++) add(scored[i]);

  // Raw VBD leader.
  let vbdLeader = null;
  for (const c of scored) {
    if (vbdLeader == null || c.vbd > vbdLeader.vbd) vbdLeader = c;
  }
  add(vbdLeader);

  // Score leader per skill position.
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    let leader = null;
    for (const p of byPos[pos]) {
      const c = scoredById.get(p.id);
      if (!c) continue;
      if (leader == null || c.score > leader.score) leader = c;
    }
    add(leader);
  }

  selected.sort((a, b) => b.score - a.score);

  // positionSummary.
  const positionSummary = {};
  for (const pos of FANTASY_POSITIONS) {
    const arr = byPos[pos];
    if (!arr.length) continue;
    const topTierLeft =
      bestTier[pos] == null ? 0 : arr.filter((p) => p.tier === bestTier[pos]).length;
    positionSummary[pos] = {
      remainingStarters: unfilledAtPos[pos],
      topTierLeft,
      bestName: arr[0] ? arr[0].name : null
    };
  }

  return { candidates: selected, positionSummary, runs, mc: mcForResult };
}

// #4 starter slots per position, apportioning FLEX / SUPER_FLEX shares.
function computeStarterSlots(rosterPositions, teams) {
  const perTeam = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  let flex = 0;
  let superFlex = 0;
  for (const slot of rosterPositions) {
    if (perTeam[slot] != null) perTeam[slot] += 1;
    else if (slot === 'FLEX') flex += 1;
    else if (slot === 'SUPER_FLEX') superFlex += 1;
    // BN and other slot types contribute no starter share.
  }
  for (const pos of Object.keys(FLEX_SHARE)) perTeam[pos] += flex * FLEX_SHARE[pos];
  for (const pos of Object.keys(SUPERFLEX_SHARE)) perTeam[pos] += superFlex * SUPERFLEX_SHARE[pos];
  const out = {};
  for (const pos of FANTASY_POSITIONS) out[pos] = (perTeam[pos] || 0) * teams;
  return out;
}

// #7 greedy fill of my roster: dedicated slots first, then FLEX, then SUPER_FLEX,
// then bench. Returns open-slot counts + my per-position counts.
function fillRoster(myPlayerIds, poolById, picks, rosterPositions) {
  const openDedicated = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  let flexOpen = 0;
  let superFlexOpen = 0;
  for (const slot of rosterPositions) {
    if (openDedicated[slot] != null) openDedicated[slot] += 1;
    else if (slot === 'FLEX') flexOpen += 1;
    else if (slot === 'SUPER_FLEX') superFlexOpen += 1;
  }

  // Resolve my player positions (pool first, pick metadata fallback).
  const posByPick = new Map();
  for (const pick of picks || []) {
    if (pick.player_id && pick.metadata && pick.metadata.position) {
      posByPick.set(pick.player_id, pick.metadata.position.toUpperCase());
    }
  }
  const countAtPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

  for (const pid of myPlayerIds) {
    const pos = (poolById.get(pid) && poolById.get(pid).pos) || posByPick.get(pid) || null;
    if (!pos) continue;
    if (countAtPos[pos] != null) countAtPos[pos] += 1;
    if (openDedicated[pos] > 0) {
      openDedicated[pos] -= 1;
    } else if (FLEX_ELIGIBLE.has(pos) && flexOpen > 0) {
      flexOpen -= 1;
    } else if (SUPERFLEX_ELIGIBLE.has(pos) && superFlexOpen > 0) {
      superFlexOpen -= 1;
    }
    // else: overflows onto the bench (bench is unbounded for need purposes).
  }

  return { openDedicated, flexOpen, superFlexOpen, countAtPos };
}

function needFactorFor(pos, fill, currentRound, rounds) {
  // #8 K/DEF hard suppression before the final two rounds.
  if ((pos === 'K' || pos === 'DEF') && currentRound < rounds - 1) return 0.05;

  if ((fill.openDedicated[pos] || 0) > 0) return 1.0;
  if (FLEX_ELIGIBLE.has(pos) && fill.flexOpen > 0) return 0.9;
  if (SUPERFLEX_ELIGIBLE.has(pos) && fill.superFlexOpen > 0) return 0.9;
  // Bench.
  if ((pos === 'QB' || pos === 'TE') && (fill.countAtPos[pos] || 0) >= 2) return 0.4;
  return 0.7;
}

// #9 tier status among undrafted at this position.
function tierStatusFor(player, undraftedAtPos, bestTier) {
  if (player.tier == null || bestTier == null || player.tier !== bestTier) return null;
  let others = 0;
  for (const p of undraftedAtPos) {
    if (p.id === player.id) continue;
    if (p.tier === player.tier) others += 1;
  }
  if (others <= 1) return 'LAST_IN_TIER';
  if (others <= 2) return 'TIER_THIN';
  return null;
}

// #10 runs: count each position among the last 8 picks; report entries >=4.
function computeRuns(picks, poolById) {
  const last8 = picks.slice(-8);
  const counts = {};
  for (const pick of last8) {
    const pos =
      (pick.metadata && pick.metadata.position && pick.metadata.position.toUpperCase()) ||
      (pick.player_id && poolById.get(pick.player_id) && poolById.get(pick.player_id).pos) ||
      null;
    if (!pos) continue;
    counts[pos] = (counts[pos] || 0) + 1;
  }
  const out = {};
  for (const [pos, n] of Object.entries(counts)) {
    if (n >= 4) out[pos] = n;
  }
  return out;
}
