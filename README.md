# Sleeper Draft Copilot

A personal Chrome extension that sits beside your live **Sleeper** fantasy football
draft, does the value math locally, and asks **Claude** for a final ranked
recommendation the moment you're on (or near) the clock.

It watches your draft room through Sleeper's public read-only API, builds a
value-based shortlist on your own machine, and only calls Claude when you're about
to pick — so you get a fast, league-aware "who should I take" answer without
tabbing away from the draft.

This is a personal, load-unpacked tool. There is no store listing, no account, and
no server. Your data stays on your machine and goes only to Sleeper (read-only) and
to Anthropic (your draft context, when you ask for advice).

---

## What it does

- **Auto-detects your draft** when you open a Sleeper draft room, real or mock.
- **Polls the draft** every few seconds and tracks every pick as it happens.
- **Computes a shortlist locally** using value-based drafting (VBD), positional
  need, ADP-based survival ("will he still be there next turn?"), tier scarcity,
  and positional runs — all adjusted to *your* league's scoring.
- **Asks Claude for the call** when you're on or near the clock: three ranked
  picks, each with a one-line reason and a confidence level, plus a short strategy
  note. It **precomputes** two picks out so the answer is usually already waiting
  when the clock reaches you.
- **Convenes a council on every pick** (when enabled, the default) — three advisor
  "lenses" (floor, ceiling, game theory) each weigh in and a fourth call synthesizes
  them into the final three picks. Turn it off to take the single-call answer instead.
- **Simulates the board with Monte Carlo** — an opponent-need-biased draft
  simulation estimates the real chance each player survives to your next pick,
  rather than an ADP curve alone.
- **Never leaves you stranded** — a 25-second guardrail drops the engine's own
  top three on screen if Claude is still thinking when the clock is ticking.
- **Shows the cost** of every Claude call so there are no surprises.

---

## Install (load unpacked)

1. Download or clone this folder to your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and choose the `extension/` folder inside this project.
5. The extension appears in your toolbar. (It ships with no custom icon, so Chrome
   shows its default puzzle-piece icon — that's expected.)

Pin it if you like, but you don't have to — the panel opens automatically when you
click the toolbar button.

---

## Setup

You need an **Anthropic API key** (this is separate from any Claude.ai subscription).

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in, and create
   an API key.
2. Click the Draft Copilot toolbar button to open the side panel.
3. In the **Setup** view, paste your key into the API key box and click **Save**.
4. Choose a model. **Fable 5.1 is the default** — it does the deepest reasoning and
   is the intended model for every advisor call (precompute, on-clock refresh, and
   every council lens and synthesis). Opus 5 is the fallback option; Sonnet 5 and
   Haiku are cheaper. Latency is managed by *effort*, not by downgrading the model
   (≈ 17s at low effort on a real draft payload, measured on the predecessor
   `claude-fable-5`). See the cost table below.
5. Enter your Sleeper username (used to find your draft slot automatically). If it
   guesses wrong, you can pick your slot from a dropdown instead.

### Settings reference

All settings live in the panel's **Setup** view and persist in `chrome.storage.local`:

| Setting | Storage key | Default | What it does |
|---|---|---|---|
| Model | `model` | Fable 5.1 | Which Claude model every advisor call uses (Fable / Opus / Sonnet / Haiku). |
| Precompute effort | `precomputeEffort` | `xhigh` | Effort for the early precompute call fired 2-3 picks before yours (`low` ~15s / `medium` / `high` ~31s / `xhigh` ~55s / `max` ~2+ min — latency figures measured on the predecessor `claude-fable-5`). The on-clock refresh runs at `high` (~31s); it normally starts a pick early, and the 25s provisional card covers the tail. |
| Council | `councilOnCloseCalls` | on | When on, auto-convene the 3-lens council on every pick. Turn off to always take the single-call answer. |

Your Anthropic API key (`anthropicApiKey`) and Sleeper username (`sleeperUsername`)
are stored the same way. Nothing is sent anywhere except Sleeper (read-only) and
Anthropic (your draft context, when a call fires).

### Security notes — read these

- **The API key is pasted only into the panel.** It is stored locally in Chrome's
  extension storage (`chrome.storage.local`) on your machine. It is never logged,
  never printed, and never sent anywhere except directly to Anthropic's API.
- **Rotate any key that was ever shared anywhere** — pasted into a chat, a screenshot,
  a gist, an email, a shared terminal. If a key has left your control even once,
  delete it at console.anthropic.com and create a fresh one. This tool only needs
  the key you paste into the panel.
- **Set a spend limit** at [platform.claude.com](https://platform.claude.com) (billing
  → usage limits). A draft is a burst of calls; a spend cap protects you from a
  runaway loop or a fat-fingered **Council** spree (each council is ~4 calls).
- Use the **Clear** button in Setup to wipe the stored key when you're done.

---

## Using it during a draft

1. Open your Sleeper draft room in Chrome: `https://sleeper.com/draft/nfl/<draft_id>`.
2. The extension detects the draft and shows a green dot on its toolbar badge.
3. Click the toolbar button to open the panel, then click **Connect** on the
   detected draft.
4. The panel loads your league settings, your roster, and the live board, then
   polls for picks every few seconds.
5. **Two to three picks before yours**, it fires a *precompute* call at your chosen
   precompute effort (default `xhigh`) and caches the answer. When the clock reaches
   you, the cached answer is shown instantly **as long as every player it recommends
   is still on the board**; if one of your targets got sniped, a `high`-effort
   *refresh* runs instead.
6. **On every pick** (when the council is enabled, the default), it convenes the
   **council** automatically: three lenses run in parallel — progress shows
   "2/3 advisors…" — then synthesize into the final three, tagged with a **COUNCIL**
   chip and a collapsible section showing each lens's #1.
7. **If Claude is still thinking 25 seconds into your turn**, a provisional card
   drops in with the engine's own top three (labeled "engine provisional — Claude
   still thinking") so you're never staring at a blank card on the clock; it's
   replaced the moment Claude lands.
8. You can also press **Advise now** any time (single, low effort) or **Council**
   (three lenses + synthesis, ~4 calls) to force a full council read.
9. Make your pick in Sleeper as usual — the panel keeps following along.

### How the timing works

- **Precompute at 2-3 picks out.** When you're a couple of picks away, the panel calls
  Claude early (up to a 120s window) and caches the result for your upcoming pick.
  This is why the answer is usually already there when you're on the clock.
- **Refresh at ≤1 pick.** The cached precompute renders as-is while all of its
  recommended players remain available — a deep read stays right even after unrelated
  picks. If a recommended player was taken, a `high`-effort refresh (~31s, 45s cap) replaces
  it — it usually starts one pick early, so it lands before or shortly into your clock.
- **Council on every pick, event-triggered.** The 3-advisor council launches at "30 seconds
  left on the predecessor's clock" (estimated from when the panel saw their clock start — most
  drafters have picked by then, so the council usually sees the complete board), or the instant
  your clock starts if they pick early. Its synthesis replaces the single-call rec when it
  lands and always outranks it.
- **Council costs ~4× a single call.** It fires on every pick while enabled (three lenses
  + one synthesis); turn it off in Setup to drop back to a single call per pick.
- **25s guardrail.** A hard 25-second timer from the start of your turn guarantees a
  card on screen even if the network or a high-effort call is slow.

The panel is your co-pilot, not an autopicker: it never touches your draft. You
always make the actual selection in Sleeper.

---

## Rehearse with a mock draft

You don't need a real league to try it:

1. In Sleeper, start a **mock draft** (Sleeper offers instant mock drafts any time).
2. Open the mock draft room — the panel auto-detects it exactly like a real draft.
3. Connect and draft. Everything works against mocks (the tool falls back to preset
   scoring when a mock has no league attached).

This is the recommended way to confirm your slot detection, model choice, and API
key all work *before* your real draft starts.

---

## Cost estimate

With the council on (the default), the panel fires about **four Claude calls per pick**
(three lenses + one synthesis); with it off, about **one call per pick**, plus the
occasional precompute/refresh. You get **one pick per round**, so the count tracks your
roster size, not the number of teams — **about 14–16 picks for a typical 14–16-round
roster** (the command-line dry-run saw 14). Every figure below is an **estimate at
Anthropic list price** for a typical draft payload — the repo ships no recorded cost
measurement — so treat them as planning ballparks, not measured results.

| Model | $/MTok in / out | Est. per single call | Est. per draft, council off (~15 picks) |
|---|---|---|---|
| `claude-fable-5-1` (**default**) | $10 / $50 | ~$0.06 | ~$0.90 |
| `claude-opus-5-5` (fallback) | $4 / $20 | ~$0.02 | ~$0.35 |
| `claude-sonnet-5-5` | $2 / $10 | ~$0.01 | ~$0.18 |
| `claude-haiku-5-5` | $0.10 / $0.50 | <~$0.01 | <~$0.01 |

> The Fable single-call figure is estimated from a typical draft payload's token volume at
> list price. The other models' per-call and per-draft figures are **estimated from the
> price ratio** to Fable (Opus 5.5 ≈ 0.4×, Sonnet 5.5 ≈ 0.2×, Haiku 5.5 ≈ 0.01×). Fable
> *latency* (≈17s at low effort) was measured on the predecessor `claude-fable-5`, which
> has identical pricing.

**With the council on (default), multiply the single-call draft figure by ~4** — on Fable
that is roughly **~$3.5–4 for a ~15-pick draft** (a higher precompute effort adds a little
more). Turn the council off in Setup to stay on the single-call figures above.

These are planning ballparks; actual cost depends on how much context each call carries
and how often you press **Advise now** / **Council**. The panel shows the running total
for your session (council calls included), and each call reports its own token usage. Set
a spend limit (see Security notes) so a draft can never cost more than you intend.

---

## How it works (in 10 lines)

1. A content script on `sleeper.com/draft/*` reads the draft id from the URL.
2. It sends that id to the background service worker (a thin relay).
3. The service worker stores the id and sets a badge; it does no heavy work.
4. Clicking the toolbar opens the **side panel**, a full extension page.
5. The panel — being an extension page — can fetch Sleeper and Anthropic without
   CORS problems, and staying open keeps the extension alive.
6. It fetches the draft, league, live projections, and a slim players list.
7. It builds a merged player pool scored under your league's exact scoring.
8. Every 3 seconds it re-reads picks, recomputes the shortlist, and runs a Monte
   Carlo board simulation to estimate who survives to your next pick.
9. Two picks out it precomputes a Claude call; on every pick it runs the council (while enabled);
   a 25s guardrail shows the engine's own top three if Claude is slow.
10. Shared logic lives in `extension/shared/` as pure modules (also runnable in
    Node for tests) — no `chrome.*`, no build step, no dependencies.

---

## Command-line dry run (optional)

For testing without the browser, `test/dry-run.mjs` runs the whole local pipeline
against a real draft from your terminal (Node 18+):

```
node test/dry-run.mjs <draftIdOrUrl> --slot N [--pick K] [--claude]
```

- `<draftIdOrUrl>` — a draft id or a full `sleeper.com/draft/nfl/...` URL.
- `--slot N` — your draft slot (1-based). Required.
- `--pick K` — pretend only the first `K` picks have happened (default: all).
- `--claude` — also make one real single Claude call. Requires `ANTHROPIC_API_KEY`
  in your environment; optional `COPILOT_MODEL` (default `claude-fable-5-1`, the
  fable-first v1.1 default) and `COPILOT_EFFORT` (single-call default `low`).
- `--effort low|medium|high` — override the single-call effort for this run.
- `--council` — run the full council (three lenses + synthesis) instead of a single
  call, printing each lens's #1 and the synthesized three. Also needs `ANTHROPIC_API_KEY`.

It prints a league summary, the last ten picks, your roster, the candidate table,
an **MC block** (per-position tier-survival probabilities and iteration count from
the Monte Carlo sim), the new **payload v2 fields** (upcoming picks, remaining
tiers, candidate annotations), the exact prompt payload size, and **per-run
wall-clock timings** (engine evaluate, and each Claude call). With `--claude` /
`--council` it then prints the recommendations and their cost. Never pass your API
key on the command line — put it in the environment.

---

## Troubleshooting

- **"Projections unavailable — running on ADP + tiers."** Sleeper's projections
  endpoint is undocumented and occasionally returns a 404. The panel degrades
  gracefully: it keeps working from ADP and dataset tiers, just with less precise
  point values. Usually it clears on its own; nothing to do.
- **Wrong slot / recommendations look off.** If your slot was auto-detected wrong,
  use the manual **slot dropdown** in the panel to set it (1..number-of-teams).
  Everything recomputes.
- **"Check your API key" / auth errors.** The key is missing, mistyped, or revoked.
  Re-paste it in **Setup**. If it was ever shared, rotate it first (see Security
  notes).
- **Rate limited.** Too many calls too fast. Wait a moment; the tool retries once
  automatically. Prefer **Advise now** over spamming **Council** (each is ~4 calls).
- **Nothing detected.** Make sure you're on a `sleeper.com/draft/nfl/...` page and
  the extension is enabled at `chrome://extensions`. Reloading the draft tab
  re-triggers detection.

---

## Data freshness (dataset compiled Aug 30)

The expert dataset (`extension/data/players-2026.json`) — the tiers, notes, risk
flags, and market-disagreement calls — was **compiled on 2026-08-30**. NFL final
roster cuts land **September 1**, so if you're drafting after that date some notes
can be a day or two stale.

You don't need to do anything about it: the panel merges **live** `injuryStatus`
(from Sleeper's players list) and **live** `trendingAdds` (Sleeper's trending-adds
feed) at draft time, and the advisor is instructed that these live fields **win**
over a stale note when they conflict (e.g. a player who looked healthy in the note
but was cut or hurt after Aug 30). So a post-cuts draft is covered.

If you want the underlying dataset itself refreshed (new tiers/notes rather than
just live overrides), re-run the research pipeline in `research/` to regenerate
`players-2026.json`.

---

## Disclaimers

- **Personal use.** This is a private tool for your own drafts, not a product.
- **Sleeper API etiquette.** It uses only Sleeper's public read-only endpoints and
  polls modestly (every few seconds during a live draft, slower before it starts,
  and it stops when the draft completes). Don't hammer the API.
- **Not affiliated** with Sleeper or Anthropic. All trademarks belong to their
  owners.
- Recommendations are advice, not guarantees. You make every pick.
