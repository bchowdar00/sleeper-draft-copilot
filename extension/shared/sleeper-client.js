// sleeper-client.js — thin, no-auth fetch wrappers for the Sleeper read API.
// Pure ES module: NO chrome.* and NO DOM references (must run in node >=18 for tests).
// All Sleeper fetches use a 10s AbortController timeout and throw
// `new Error("sleeper:<what>")` on any non-OK / network failure.

export const SLEEPER_BASE = 'https://api.sleeper.app';

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

// Fetch <url> as JSON with a 10s timeout. On timeout, network error, or non-OK
// response, throw `sleeper:<what>` so callers get a stable, typed error string.
async function fetchJson(url, what) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error('sleeper:' + what);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('sleeper:' + what);
  try {
    return await res.json();
  } catch (err) {
    throw new Error('sleeper:' + what);
  }
}

export async function getNflState() {
  return fetchJson(SLEEPER_BASE + '/v1/state/nfl', 'state');
}

export async function getDraft(draftId) {
  return fetchJson(SLEEPER_BASE + '/v1/draft/' + draftId, 'draft');
}

export async function getDraftPicks(draftId) {
  return fetchJson(SLEEPER_BASE + '/v1/draft/' + draftId + '/picks', 'picks');
}

export async function getLeague(leagueId) {
  return fetchJson(SLEEPER_BASE + '/v1/league/' + leagueId, 'league');
}

export async function getUser(usernameOrId) {
  return fetchJson(SLEEPER_BASE + '/v1/user/' + usernameOrId, 'user');
}

// Season-long projections (undocumented host path, no /v1 prefix). One fetch per
// position, merged into a single Map keyed by player_id. Every consumer wraps this
// in try/catch: it throws `sleeper:projections` on any failure so the panel can
// fall back to degraded (ADP-only) mode.
export async function getSeasonProjections(season, positions) {
  const merged = new Map();
  try {
    for (const pos of positions) {
      const url = SLEEPER_BASE + '/projections/nfl/' + season +
        '?season_type=regular&position[]=' + encodeURIComponent(pos) + '&order_by=adp';
      const arr = await fetchJson(url, 'projections');
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        if (!row || row.player_id == null) continue;
        merged.set(String(row.player_id), { stats: row.stats || {}, player: row.player || {} });
      }
    }
  } catch (err) {
    throw new Error('sleeper:projections');
  }
  return merged;
}

// Full NFL player catalog (~5MB). Filter to fantasy-relevant players and keep only
// the slim fields the copilot needs. Returns { fetchedAt, players }; the CALLER
// stamps fetchedAt and caches the result in chrome.storage.local for 24h. This
// module never touches chrome.storage.
export async function getPlayersSlim() {
  const all = await fetchJson(SLEEPER_BASE + '/v1/players/nfl', 'players');
  const players = {};
  for (const id in all) {
    const p = all[id];
    if (!p) continue;
    const pos = p.position;
    if (!FANTASY_POSITIONS.has(pos)) continue;
    const searchRank = typeof p.search_rank === 'number' ? p.search_rank : null;
    const keep = (p.team != null) || (searchRank != null && searchRank < 600);
    if (!keep) continue;
    players[id] = {
      player_id: String(p.player_id != null ? p.player_id : id),
      full_name: p.full_name != null ? p.full_name
        : [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      position: pos,
      team: p.team != null ? p.team : null,
      injury_status: p.injury_status != null ? p.injury_status : null,
      bye: null
    };
  }
  return { fetchedAt: null, players };
}

// sleeper.com/draft/nfl/<digits> or a bare numeric id -> the id string, else null.
export function parseDraftIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/draft\/nfl\/(\d+)/);
  return m ? m[1] : null;
}
