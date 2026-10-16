// Claude Messages API client for the draft advisor. Pure ES module: no chrome.*, no DOM.
// Never logs or persists the API key. Non-streaming; structured outputs enforce the shape.
// Contract & request details: DESIGN.md §3.6.

// FABLE-ONLY MANDATE (DESIGN-1.1.md): claude-fable-5-1 is the DEFAULT and intended model for
// every advisor call — precompute, on-clock refresh, all council lens calls, and synthesis.
// Latency is managed by effort + scheduling, not by downgrading models. All four stay selectable.
export const MODELS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (default — deepest reasoning)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (fallback option)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (cheapest)' }
];

// Council lenses — three genuinely distinct advisor mandates. getCouncilRecommendation fires
// one getRecommendation per lens (effort 'medium'), each with the base system prompt plus the
// lens directive, then synthesizes (effort 'low'). Directives are 3-5 sentences each.
export const LENSES = [
  {
    key: 'floor',
    title: 'FLOOR & STRUCTURE',
    directive:
      'Advise as the floor-and-structure advisor: your mandate is roster-construction integrity and dependable starter floors, not upside. Prioritize players who lock in a reliable weekly starter at a position of real need and who keep the roster build balanced across the snake. Weigh every risk flag — injuryStatus, risk[], and note cautions — DOUBLE, and actively avoid busts, holdouts, and fragile depth situations even at a small projected-points cost. When two players are close, take the one with the safer outcome distribution and the cleaner path to snaps. Bench luxury and boom-bust dart throws are not your job.'
  },
  {
    key: 'ceiling',
    title: 'CEILING & LEVERAGE',
    directive:
      'Advise as the ceiling-and-leverage advisor: your mandate is league-winning upside and edges the market is mispricing. Hunt smash values where marketDisagreement or a favorable note says the ceiling outruns the ADP, and exploit tier breaks by grabbing the last elite talent before a cliff. You accept variance in exchange for a genuine path to a top-3 positional finish — a high ceiling with real bust risk beats a capped, safe starter. Discount risk flags that only threaten the floor, not the ceiling. Reach past consensus when the upside math justifies it, and say why.'
  },
  {
    key: 'game',
    title: 'GAME THEORY',
    directive:
      "Advise as the game-theory advisor: your mandate is the draft board, not just the player. Read opponent needs (opponentsBeforeMyNextPick), active position runs, and the survival / mc.pTierSurvives / bestAtPosAtNextPick math to decide what is actually gone before the user picks again. Prefer taking a player now only when the positional cliff arrives before the next turn; when comparable value survives, defer and attack the scarcer position first. Explicitly weigh value-of-waiting across the user's next two turns (myUpcomingPicks) and counter-draft the runs opponents are likely to extend. Optimize the sequence of picks, not this single slot in isolation."
  }
];

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// server-side refusal fallback: opus-5.5 and fable-5.1 (beta header + body field).
// The claude-api skill documents server-side-fallback-2026-07-01 for both.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Models that reject output_config.effort. Effort is GA on every current menu model
// (per the claude-api skill); only legacy Haiku 4.5 / Sonnet 4.5 do not accept it, so
// the parameter is omitted for those to avoid a 400.
const EFFORT_UNSUPPORTED = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);
function modelSupportsEffort(model) {
  return !EFFORT_UNSUPPORTED.has(model);
}

// Per-MTok [input, output] pricing (USD), from the claude-api skill model table.
const PRICING = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5]
};

// Structured-output schema — mirrors the SYSTEM PROMPT v1 output shape exactly.
export const REC_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      // Structured outputs only allow minItems 0|1 — "exactly 3" is enforced by the
      // system prompt and re-validated client-side after parsing.
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          player: { type: 'string' },
          why: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['player', 'why', 'confidence'],
        additionalProperties: false
      }
    },
    strategyNote: { type: 'string' }
  },
  required: ['recommendations', 'strategyNote'],
  additionalProperties: false
};

// Estimate cost in USD from a usage object. Unknown model → 0.
export function estimateCostUsd(model, usage) {
  const price = PRICING[model];
  if (!price || !usage) return 0;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  return (inTok * price[0] + outTok * price[1]) / 1e6;
}

function extractApiErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.error && parsed.error.message) return parsed.error.message;
  } catch (_) {
    /* not JSON */
  }
  return body ? String(body).slice(0, 300) : '';
}

// Resolve the Anthropic response body into a Recommendation. Throws typed errors.
function parseRecommendation(data, model) {
  if (data && data.stop_reason === 'refusal') {
    throw new Error('refusal');
  }
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const textBlock = blocks.find((b) => b && b.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw new Error('api:no-text-block');
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (_) {
    throw new Error('api:bad-json');
  }
  if (!parsed || !Array.isArray(parsed.recommendations) || parsed.recommendations.length < 1) {
    throw new Error('api:bad-shape');
  }
  // The prompt asks for exactly 3, but a 1-2 rec response is still actionable advice —
  // never discard usable recommendations on the clock over a count mismatch.
  return {
    recommendations: parsed.recommendations.slice(0, 3),
    strategyNote: parsed.strategyNote || '',
    model: (data && data.model) || model,
    usage: (data && data.usage) || { input_tokens: 0, output_tokens: 0 }
  };
}

// One POST to /v1/messages. Handles auth/rate/api typed errors and a single 429 retry.
async function postOnce({ apiKey, model, effort, system, userPayload, signal }) {
  const usesFallback = FALLBACK_MODELS.has(model);
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  if (usesFallback) headers['anthropic-beta'] = FALLBACK_BETA;

  // Effort is sent only to models that accept output_config.effort; the format
  // (structured output) is always sent.
  const outputConfig = { format: { type: 'json_schema', schema: REC_SCHEMA } };
  if (effort && modelSupportsEffort(model)) outputConfig.effort = effort;

  const body = {
    model,
    // Adaptive thinking counts against max_tokens: at high+ effort, 2000 truncates the
    // response before the answer is written (no text block). 16000 leaves ample room.
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPayload }],
    output_config: outputConfig
  };
  if (usesFallback) body.fallbacks = 'default';

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });
  return res;
}

// getRecommendation — resolves to a Recommendation (DESIGN.md §2). 60s timeout unless
// the caller passes its own AbortSignal.
export async function getRecommendation({ apiKey, model, effort, system, userPayload, signal }) {
  if (!apiKey) throw new Error('auth');
  const usedSignal = signal || AbortSignal.timeout(60000);

  let res = await postOnce({ apiKey, model, effort, system, userPayload, signal: usedSignal });

  // Single retry on 429, honoring retry-after when present.
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter, 10) * 1000 : 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await postOnce({ apiKey, model, effort, system, userPayload, signal: usedSignal });
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    if (res.status === 401) {
      const err = new Error('auth');
      err.hint = 'check your API key';
      throw err;
    }
    if (res.status === 429) {
      const err = new Error('rate');
      err.hint = 'rate limited — try again in a moment';
      throw err;
    }
    const msg = extractApiErrorMessage(bodyText);
    const err = new Error('api:' + res.status);
    err.hint = msg;
    throw err;
  }

  const data = await res.json();
  return parseRecommendation(data, model);
}

// getCouncilRecommendation — the close-call council (DESIGN-1.1.md §W2). Runs the three LENSES
// as parallel getRecommendation calls (effort 'medium'), drops any lens that rejects (proceeds
// with ≥2 survivors; throws the first error if ≤1 survives), then makes one synthesis call
// (effort 'low') that reconciles the surviving lens outputs into a single final ranking of 3.
// Resolves to the synthesized Recommendation shape plus `lensResults` (each surviving lens's
// output), with `usage` summed across every call so estimateCostUsd prices the whole council.
export async function getCouncilRecommendation({
  apiKey,
  model,
  system,
  userPayload,
  signal,
  onProgress
}) {
  if (!apiKey) throw new Error('auth');

  // Fire the three lens calls in parallel; report progress as each settles (1/3, 2/3, 3/3).
  let settledCount = 0;
  const lensSettled = await Promise.all(
    LENSES.map((lens) => {
      const lensSystem =
        system + '\n\nLENS DIRECTIVE — ' + lens.title + ': ' + lens.directive;
      return getRecommendation({
        apiKey,
        model,
        effort: 'medium',
        system: lensSystem,
        userPayload,
        signal
      }).then(
        (rec) => {
          settledCount += 1;
          if (typeof onProgress === 'function') onProgress(settledCount);
          return { status: 'fulfilled', lens, rec };
        },
        (err) => {
          settledCount += 1;
          if (typeof onProgress === 'function') onProgress(settledCount);
          return { status: 'rejected', lens, err };
        }
      );
    })
  );

  const survivors = lensSettled.filter((s) => s.status === 'fulfilled');
  if (survivors.length <= 1) {
    // Drop-on-reject only holds a quorum of ≥2; otherwise surface the first lens error.
    const firstError = lensSettled.find((s) => s.status === 'rejected');
    throw firstError ? firstError.err : new Error('council:insufficient');
  }

  const lensResults = survivors.map((s) => ({
    lens: s.lens.key,
    recommendations: s.rec.recommendations,
    strategyNote: s.rec.strategyNote
  }));

  // Synthesis: base system + a synthesis directive; user message = original payload + the
  // council outputs + an instruction to resolve disagreements on the merits in each `why`.
  const synthesisSystem =
    system +
    '\n\nSYNTHESIS DIRECTIVE: You are the head of a draft advisory council. Three independent advisors, each with a different mandate, have each produced a ranked recommendation from the same payload. Weigh their outputs against the payload evidence, reconcile their disagreements on the merits, and produce the single best final ranking of 3. Do not defer to any one advisor; where they conflict, decide with the tier / VBD / survival / need math in front of you.';
  const synthesisUserPayload =
    userPayload +
    '\n\nCOUNCIL OUTPUTS (three independent advisors):\n' +
    JSON.stringify(lensResults) +
    '\n\nWhere the advisors disagree, resolve the disagreement explicitly in each `why` — name the concrete trade-off (floor vs upside, take-now vs value-of-waiting, need vs best-available), not the advisors themselves. Output your final 3 ranked recommendations and a strategyNote.';

  const synthesis = await getRecommendation({
    apiKey,
    model,
    effort: 'low',
    system: synthesisSystem,
    userPayload: synthesisUserPayload,
    signal
  });

  // Sum usage across every completed call (surviving lenses + synthesis).
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const s of survivors) {
    usage.input_tokens += (s.rec.usage && s.rec.usage.input_tokens) || 0;
    usage.output_tokens += (s.rec.usage && s.rec.usage.output_tokens) || 0;
  }
  usage.input_tokens += (synthesis.usage && synthesis.usage.input_tokens) || 0;
  usage.output_tokens += (synthesis.usage && synthesis.usage.output_tokens) || 0;

  return {
    recommendations: synthesis.recommendations,
    strategyNote: synthesis.strategyNote,
    model: synthesis.model,
    usage,
    lensResults
  };
}
