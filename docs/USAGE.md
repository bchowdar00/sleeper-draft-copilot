# Draft-Day Runbook

Everything you need to run Sleeper Draft Copilot during a live draft, plus how to
read what it's telling you. If you haven't installed it yet, start with the
[README](../README.md).

---

## 1. Before the draft (do this the day before, not five minutes before)

A short checklist prevents the two things that ruin a draft: a wrong slot and a
dead API key.

- **Rehearse with a mock.** Start a Sleeper mock draft, open the room, and connect
  the panel. Confirm it detects the draft, loads your league/scoring, shows a
  shortlist, and can fetch a Claude recommendation. If a mock works end to end,
  your real draft will too.
- **Verify your slot.** After connecting, check the header: it should show *your*
  slot and count down "N picks until yours" correctly. If the auto-detected slot is
  wrong, set it with the manual **slot dropdown** now, not during your first pick.
- **Prefund / check your API key.** Confirm your Anthropic key is saved in **Setup**
  and that your account can pay for calls: sign in at
  [platform.claude.com](https://platform.claude.com), confirm you have credit or a
  card on file, and set a **spend limit** so a draft can't overspend. A revoked or
  unfunded key fails silently until you're on the clock — check it in advance.
- **Pick your model.** **Fable 5.1 is the default** and the intended model for every
  advisor call — it does the deepest reasoning, and latency is handled by *effort*
  and the precompute schedule, not by switching to a lighter model. Opus 5 is the
  fallback; Sonnet 5 / Haiku are cheaper. See the cost table in the README. You can
  change it mid-draft.
- **Set your call settings.** In Setup, choose your **precompute effort** (default
  `xhigh` — this is the effort of the call fired two picks before yours) and whether to
  **auto-convene the council on every pick** (default on). Both are explained in
  the README settings reference.
- **Open the real draft room a few minutes early** so detection and the first data
  load happen before the clock starts.

---

## 2. Reading the panel

The **Draft** view has five sections, top to bottom.

### Header

Draft id, a status chip, **Round X · Pick Y**, your league's scoring label (PPR /
Half-PPR / Standard, "+ Superflex" if applicable), and a small heartbeat dot that
blinks each time the panel re-polls the board. When it's your turn you get a bright
**ON THE CLOCK** banner; otherwise it reads **N picks until yours**.

### Claude card

The three ranked recommendations. Each shows the player's name (big), a
**confidence** chip (high / medium / low), and a one-line *why*. Below them is a
short **strategy note** in italics — the bigger-picture read (e.g. "you can wait on
QB, the run is at RB"), which in v1.1 also names what to target at your next one or
two picks. The card also shows the model in use and the **cost so far** this session.

You usually won't have to press anything: the panel **precomputes** the answer two
picks before yours and shows it the instant you're on the clock. What you may see:

- A **COUNCIL** chip on every pick (while the council is enabled, the default): three
  advisor lenses — floor, ceiling, game theory — weighed in and a fourth call
  synthesized them. A collapsible section shows each lens's #1 pick.
- A provisional **"engine provisional — Claude still thinking"** card if 25 seconds
  pass on your clock with no answer yet — the engine's own top three, replaced the
  moment Claude lands. It means the call is slow, not that anything is broken.

Two buttons:

- **Advise now** — ask Claude immediately (single call, low effort).
- **Council** — force the full three-lens + synthesis read (~4 calls). See section 4
  for when it's worth it.

### Shortlist table (the local engine)

The top ~10 players by the tool's own value math, computed on your machine every
few seconds. Columns: name, position, team, **VBD**, **ADP**, **survive%**, a tier
badge, risk icons, and an injury tag. This is what Claude reasons over — it's useful
on its own even before you call Claude.

### My roster

Your league's roster slots (QB, RB, WR, TE, FLEX, BN, …) with your drafted players
filled in greedily; open slots show hollow. This is how you see, at a glance, what
you still *need*.

### Position runs

Appears only when a run is happening: a strip like `RB:5 WR:4` meaning that many of
the last eight picks were at that position. A run is your cue that value at that
position is draining fast.

---

## 3. How to read VBD, survival, and tier badges

These three tell you *most* of what you need before Claude even weighs in.

- **VBD (Value-Based Drafting)** — how many projected points this player is worth
  *above the replacement-level starter at his position* in your league. Higher is
  better. VBD, not raw projected points, is the right cross-position comparison: a
  30-VBD WR and a 30-VBD RB are worth about the same to your roster even if their raw
  point totals differ. VBD is dynamic — as a position drains, its replacement level
  drops and the remaining players' VBD shifts.

- **survive% (survival)** — the tool's estimate of the chance this player is *still
  available at your next pick*. In v1.1 this comes from a **Monte Carlo board
  simulation** (250 runs of the picks between now and your next turn, biased by each
  opponent's roster needs), not just an ADP curve — so it reflects that an opponent
  with an RB hole will drain RBs faster. High survive% (say 80%+) means you can
  probably wait and grab someone else now;
  low survive% (say under 40%) means it's now-or-never. Use it with VBD: a
  high-VBD player with low survival is the classic "take him now" case; a high-VBD
  player with high survival is someone you can safely pass on this turn.

- **Tier badges** — from the expert dataset's positional tiers:
  - **LAST IN TIER (red)** — he's the last (or nearly last) player left in the best
    remaining tier at his position. After him there's a real drop-off. Strong signal
    to pull the trigger.
  - **THIN (amber)** — the tier is getting thin (a couple left). A softer version of
    the same warning.
  - No badge — the tier is healthy; no scarcity pressure yet.

- **Risk icons / injury tag** — flags from the dataset (volatility, situation risk)
  and the live injury status (Questionable, Out, IR, …). Treat these as
  tie-breakers and cautions, not disqualifiers.

> **Dataset vintage.** The tiers, notes, and risk flags were compiled **Aug 30, 2026**;
> NFL final cuts land **Sept 1**. If you draft after that, the panel's **live**
> `injuryStatus` and trending-adds override a stale note, and the advisor is told the
> live fields win on conflict — so a post-cuts draft is covered. To refresh the
> dataset itself, re-run the `research/` pipeline (see the README).

Put together: the players you should think hardest about are **high VBD + low
survival + a tier badge** — high value, won't last, and scarce.

---

## 4. When to use the "Council"

- **With the council on (the default), it fires on its own on every pick** — you'll see
  the **COUNCIL** chip and the per-lens breakdown without doing anything. This is the
  most thorough mode and also the most expensive (~4 calls per pick).
- **Single call (Advise now, or the council turned off)** is fast, league-aware, and
  high-quality, and is plenty for the vast majority of picks. Turn the council off in
  Setup if you'd rather pay for a single call per pick.
- With the council off, reach for the **Council** button yourself when a pick is
  genuinely hard and consequential:
  - an early-round pivot where two positions are close on value,
  - a spot where a run is forcing a reach-vs-wait decision,
  - your last shot at a scarce tier before it empties,
  - superflex QB timing calls.
- Mind the cost: each council is ~4 calls (three lenses + synthesis), so running it on
  every pick is ~4× the cost of single calls and a bit slower. On easy picks it rarely
  changes the answer, so turn the council off in Setup if you'd rather save it for the
  moments that matter.
- **Reading a council result:** the synthesized *why* resolves the trade-off the
  lenses disagreed on (floor vs ceiling vs game theory), so when it hedges, that
  hedge is the actual decision — read it, then trust it.

If Claude and the shortlist disagree, read the *why* and the strategy note: usually
Claude is weighing roster need, runs, or a player note that the raw VBD ordering
doesn't capture.

---

## 5. How the advisor weighs your league scoring

Everything the tool computes is already adjusted to *your* league — you don't have to
mentally translate.

- **Scoring is baked into projected points.** Player projections are scored under
  your league's actual settings, so a full-PPR league lifts pass-catching backs and
  slot receivers, while a standard (rec=0) league pushes early-down runners up. The
  same player can rank very differently between your leagues, and that's correct.
- **VBD uses your roster shape.** Replacement level is computed from how many
  starters your league actually uses at each position (including FLEX and, in
  superflex, the extra QB demand). More starting slots at a position → higher
  replacement level → VBD spread reflects real scarcity in *your* format.
- **Superflex changes QB value.** If your league is superflex (or two-QB), quarterbacks
  are matched against superflex ADP and get a larger starter share, so they surface
  far earlier than in a single-QB league. The tool handles this automatically.
- **Kickers and defenses are suppressed** until the final rounds, so they won't
  clutter your shortlist early even if their raw numbers look fine.
- **The numbers handed to Claude are already league-adjusted.** When Claude cites VBD,
  survival, or need, it's reasoning on figures computed for your exact league — so its
  advice is about *your* draft, not a generic ranking.

That's the whole loop: the local engine turns your league's rules into value and
scarcity signals, and Claude turns those signals — plus roster need, runs, and expert
player notes — into the three picks you should actually consider.
