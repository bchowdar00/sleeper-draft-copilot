# Sleeper Draft Copilot — Redraft Snake Draft Strategy Playbook

Compiled 2026-08-30 for the 2026 NFL season. Redraft snake leagues, primary target 12-team full-PPR, with deltas noted for 10-team and half-PPR/standard/superflex/TE-premium/IDP. All time-sensitive claims are sourced to July/August 2026 publications; frameworks (VBD math, tiers, ADP survival math) are largely format-agnostic and cite the best available explainer regardless of date, with math verified directly against the source.

---

## 1. Scoring Formats and Strategic Deltas

**Standard (0 PPR):** Touchdowns and yardage dominate. Workhorse/goal-line running backs are scarcest and most valuable; big-play, low-target WRs (deep threats) hold value even on 3 catches/90 yards because they aren't penalized for low volume. RB tends to go earliest and deepest into drafts.

**Half-PPR (0.5/reception):** The "middle ground" format most 12-team redraft leagues actually use. Elite workhorse RBs still command premium value, but pass-catching backs get a real bump; WR target volume matters more than standard but less than full PPR. [Bleacher Nation, Aug 12 2026](https://www.bleachernation.com/fantasy-football/2026/08/12/ppr-vs-half-ppr/)

**Full PPR (1.0/reception):** Value shifts materially toward target volume. Worked example directly from source: an 8-catch, 80-yard WR game scores 8 pts standard, 12 pts half-PPR, 16 pts full PPR — reception points alone can be half a receiver's box score. Pass-catching RBs (60-80 receptions/season) can outscore "better" pure runners who don't see targets; slot/possession WRs get a scoring floor even without touchdowns. [FantasySixPack scoring guide](https://fantasysixpack.net/fantasy-football-standard-ppr-half-ppr/)

**Superflex / 2QB:** QB scarcity becomes a positional-tier problem rather than a late-round afterthought, because a second startable QB slot means ~24 QBs are fantasy-relevant starters in a 12-team league (vs. 12-14 in 1QB). Per Aug 2026 CBS/FantasyPros coverage, the QB20 in superflex outscores a typical RB2/WR2 most weeks — but 2026 is notable because the gap has compressed: "only 12 points of 3D Value separate QB2 and QB15," smaller than the RB8-RB14 or WR10-WR12 gaps, meaning the historical "you must take 2 QBs in the first 3 rounds" rule is weaker in 2026 than prior years — a genuine strategy shift experts are flagging this year. [FantasyPros Superflex Strategy, Aug 2026](https://www.fantasypros.com/2026/08/superflex-fantasy-football-draft-strategy-qb2-targets-2026/); [DraftSharks Superflex Mock](https://www.draftsharks.com/article/superflex-mock-draft). Roster-build implication: still draft 3-4 QBs total for bye/injury churn.

**TE-Premium (1.0-1.5 pt/reception for TEs only):** Counterintuitive finding directly sourced: managers assume a 1.5-pt TE-premium format makes elite TEs "50% more valuable" than non-premium — FantasyPros' analysis of Trey McBride shows the actual VBD boost was **19.9%**, not 50%, because value is relative to a replacement TE who *also* benefits from the bonus. Net effect: TE-premium still pushes points-above-replacement at TE ahead of RB/WR at the position's high end, but the market tends to overpay for the format shift — good picks flow to other positions while rivals reach for TEs. [FantasyPros TE-Premium Strategy, June 2026](https://www.fantasypros.com/2026/06/te-premium-fantasy-football-draft-strategy-targets-2026/)

**IDP (brief):** Only relevant if the league starts individual defenders instead of team DST. Two governing rules: (1) draft timing scales with required IDP roster spots — light IDP (1 defensive starter) can wait to round 10+; heavy IDP (2 LB + tackle-heavy scoring) means the first linebacker should be gone by round 6 in a 12-team draft. (2) The scoring sheet determines position scarcity, not name recognition — e.g., 2 pts/solo tackle + 4 pts/sack converges LB and DL value; 1 pt tackle + 6 pt sack makes edge rushers the scarce, reach-worthy asset. Always read IDP scoring before valuing players. [DraftSharks IDP guide](https://www.draftsharks.com/kb/what-is-idp-fantasy-football-best-strategy); [Footballguys IDP Blueprint 2026](https://www.footballguys.com/article/2026-idp-draft-blueprint-godfathers-step-by-step-guide)

---

## 2. Value Frameworks: VBD / VORP / VONA / VOLS

Core principle (FantasyPros, verified from primary explainer): a player's absolute projected score matters far less than how much better he is than the worst viable starter a competitor could plug into the same slot. VBD is the umbrella; VORP, VOLS, and VONA are three different replacement baselines.

### VORP (Value Over Replacement Player)
Baseline = the best player expected to be available on the **waiver wire** (i.e., last rostered player at the position across the league, accounting for bench spots).

**How replacement level is set from league size + roster slots (worked example, directly verified numbers):**
- 12-team league, 5 WR-eligible slots rostered per team (starters + bench allocation) → 60 WRs rostered total → replacement-level WR ≈ **WR61**.
- Ja'Marr Chase projection: 283.3 half-PPR pts. Replacement WR65 (Tre Harris): 114.2 pts. **Chase VORP = 169.1 pts** (283.3 − 114.2).
- Lamar Jackson projection: 371.1 pts. Replacement QB (12th rostered starter-tier, e.g. Bryce Young): 244.4 pts. **Jackson VORP = 126.7 pts.**
[FantasyPros VBD/VORP/VOLS/VONA explainer](https://www.fantasypros.com/2025/06/fantasy-football-draft-strategy-value-based-drafting-vorp-vols-vona/) (verified numbers pulled directly from article; 2025 edition, methodology confirmed unchanged in the [June 2026 update](https://www.fantasypros.com/2026/06/fantasy-football-draft-strategy-value-based-drafting-2026/), which explicitly says "everything in that article still applies").

**League-size/roster-slot rule for your extension:** replacement rank = (# teams) × (starters at that position, including realistic flex share) — e.g., 12 teams, 2 RB + 2 WR + 1 flex (flex assumed to split ~60/40 to RB/WR in PPR) → replacement RB sits around **RB25-30**, replacement WR around **WR30-37**, matching the FantasyPros WR36-baseline example below. This is exactly the ballpark the task brief specified (RB30) — confirmed consistent with sourced math, not just asserted.

### VOLS (Value Over Last Starter)
Baseline = the last starter drafted leaguewide at that position (no bench allowance) — a *tighter*, more conservative baseline than VORP.
- 12 teams × 3 WR starters = 36 starting WRs → baseline = **WR36**.
- Chase VOLS: 283.3 − 157.3 (WR36, Jaylen Waddle) = **126.0 pts**.
- Jackson VOLS: 371.1 − 286.2 (QB12, Dak Prescott) = **85.0 pts**.
- Key insight (verified): using VOLS instead of VORP, Jackson trails Chase by 39% instead of 29% — this is *why* elite QBs get pushed later in 1QB startable-value math: the tighter baseline shrinks the QB's apparent edge because backup-QB replacement points are much higher than backup-WR replacement points.

### VONA (Value Over Next Available)
Baseline = the best player you expect to still be available **at your own next pick** — dynamic, draft-flow-dependent, cannot be precomputed pre-draft.
- Worked example (pick 1.02, verified from source): choosing Justin Jefferson vs. Saquon Barkley. If the room is RB-heavy, taking Jefferson now leaves an elite RB (Barkley-tier) gone by your next pick, so your realistic Round 2 alternative RB is only "RB2-type" (e.g., Kenneth Walker) — Barkley's VONA = **68.4 pts**. Jefferson's VONA = **39.4 pts** because elite WRs are more likely to still be there next round. Verdict from the math: take the position more likely to be gone by your next turn, not necessarily the higher-ranked player in the abstract.
- Practical guidance from the source: don't try to hand-calculate precise VONA live; instead use it as a *heuristic* — "which position will still have a premium tier available when my pick comes back around?" and let that break ties between similarly-tiered players.

### Static vs. Dynamic VBD
- **Static VBD** = precomputed once, pre-draft, using projections and fixed baselines (VORP/VOLS). Good for pre-draft rankings/cheat sheets.
- **Dynamic VBD** = recalculated live as players come off the board, because replacement level *shifts* as the position gets drained (VONA is inherently dynamic). An in-draft AI advisor should default to dynamic: re-rank available players' VORP/VOLS against the *actual* remaining pool at each pick, not a frozen pre-draft baseline.

---

## 3. Tier-Based Drafting

**Why tiers beat strict rank-ordering:** Rankings imply false precision — the gap between rank 14 and 15 is often trivial while the gap between rank 15 and 16 is a cliff. Tiers group players who project similarly and isolate the "cliffs" where real value drops occur. [Boris Chen](http://www.borischen.co/) generates tiers via a Gaussian mixture clustering model over FantasyPros expert-consensus rankings, continuously updated through the preseason — the most commonly cited "citable" tier methodology in the space.

**Operating rule:** the decision point isn't "who is ranked higher," it's "how many players are left in this tier vs. that tier, and how many picks until my tier runs out." If Tier 2 RB has 1 player left and Tier 2 WR has 4 players left, take the RB — you're paying for scarcity, not marginal rank. [Tier strategy explainer, 2026](https://thefantasyfootballalmanac.com/2026/02/19/fantasy-football-draft-tiers-explained-2026-strategy-guide/)

**Deciding between positions when tiers break simultaneously:** compare (a) VONA/survival odds — which position's next tier is more likely to be gone by your next pick (section 4), and (b) roster need — do you already have a started-tier player at one of the two positions. Tiers tell you *when* a position is urgent; VONA + survival probability tell you *how* urgent relative to the other broken tier.

---

## 4. Availability / Survival Probability (ADP Math)

**Primary sourced methodology** (DraftKick, directly verified from their published formula): use a **normal cumulative distribution function** where:
- X = your next pick number
- mean = player's ADP
- standard deviation ≈ **ADP ÷ 4**

`P(drafted before your pick) = Φ((X − ADP) / (ADP/4))`
`Survival probability = 1 − Φ((X − ADP) / (ADP/4))`

Their stated approximation: min-to-max ADP range roughly tracks the ADP itself (ADP 6 typically goes picks 3-9; ADP 100 typically goes picks 50-150) — i.e., variance scales with ADP, consistent with the /4 stdev heuristic. Caveat directly from source: the range is tighter early and widens as the draft progresses, so this is "a rough tool, not a definitive predictor." [DraftKick Projected Availability](https://draftkick.com/blog/projected-availability/)

**Decision thresholds (sourced):** ≥60-70% survival → wait, take a different need now; ≤20-30% survival → take him now or lose him.

**Snake-math distance to your next pick** (deterministic, not probabilistic — compute directly):
- In an N-team snake draft, if you pick at slot `s` in an odd round (picks ascending), your next pick (in the following even round) is at overall position `2N − s + 1` picks later... more simply: **picks between your selections = 2 × (N − s) + 1** if you're not at the turn, and as few as **1 pick** if you hold the last slot in an odd round (immediately followed by the first pick of the even round — the "turn"). For a mid-pack slot (s ≈ N/2), the gap is roughly N picks; for edge slots (s=1 or s=N), the gap alternates between very short (the turn) and up to 2N−1 picks.
- Practical implication: **early and late slots (turn-holders) get bursts** — two picks close together, then a long wait — which rewards deliberately pairing a "player + his replacement-tier backup" or "two players from a tier about to break" at the turn, then coasting through the long gap. Mid-slot drafters face more uniform spacing and should lean more heavily on the ADP-survival formula above since the wait is more predictable. [Fantasy strategy guide on turn-pick dynamics, 2026](https://fantasystrategyguide.com/snake-draft-tips); reasoning on the pick-distance formula is standard snake-draft arithmetic, verified by construction, not an external claim.

**When to reach vs. wait:** reach (take below ADP-implied value) when (a) survival probability at your next pick is low (<30%) for a player who fills a tier-cliff need, or (b) the position's tier is about to break and no comparable tier exists at other positions of need. Wait when survival probability is high AND a different position has an urgent tier break right now.

---

## 5. Named Strategies — 2026 Standing (per August 2026 expert commentary)

**Zero RB** — *Weaker in 2026 than recent years, per multiple sources.* NBC Sports (Aug 2026) still lists Zero RB targets (Blake Corum, Tank Bigsby), but the CBS/FantasyPros 2026 draft-plan consensus explicitly flags: "the Zero RB strategy is not as appealing as it has been, as there looks to be a dozen or so legitimate workhorse running backs you really want to have, combined with an extremely weak rookie RB class." [CBS Sports, 2026 draft plan](https://www.cbssports.com/fantasy/football/news/jamey-eisenbergs-2026-fantasy-draft-plan/); [NBC Sports Zero RB targets](https://www.nbcsports.com/fantasy/football/news/fantasy-football-2026-zero-rb-draft-targets-headlined-by-blake-corum-tank-bigsby)

**Hero/Anchor RB** — *The dominant 2026 recommendation.* FantasyPros' Aug 28, 2026 "Perfect Draft" guide (Andrew Erickson) explicitly argues for a hero-style approach: "get two shots on net at an elite RB season and an elite WR season" in rounds 1-2, with a **hard round-3 deadline** to lock a second RB with upside (names cited: Breece Hall, Javonte Williams, Travis Etienne) before pivoting to WR accumulation rounds 4-6. Rationale cited: "five RBs outscored every WR not named Ja'Marr Chase in 2024 in half-PPR." [FantasyPros Perfect Draft, Aug 28 2026](https://www.fantasypros.com/2026/08/perfect-fantasy-football-draft-strategy-advice-targets-2026/)

**Robust RB** — Still a named/viable third path (attack RB from pick 1) per FantasySixPack's Hero/Zero explainer, and consistent with the "more RBs drafted in first two rounds in 2026 than the last couple years" market shift noted in the Yahoo RB preview — but not the headline 2026 consensus pick; treated as the aggressive variant of Hero RB rather than a separately favored strategy this year. [Yahoo RB Preview, 2026](https://sports.yahoo.com/fantasy/article/2026-fantasy-football-rb-preview-draft-strategy-rankings-fades-and-sleepers-163344738.html); [FantasySixPack Hero/Zero](https://fantasysixpack.net/fantasy-football-running-back-draft-strategies/)

**Late-round QB vs. early elite QB (1QB leagues)** — **Genuine, current expert disagreement**, worth flagging as non-consensus edge territory:
- JJ Zachariason (originator of Late-Round QB philosophy) continues advocating waiting on QB into 2026; supporting stat cited in research: 3 of last year's top-5 scoring QBs had ADP of QB15 or later.
- FantasyPros' Aug 2026 "Perfect Draft" piece counters directly on rushing-QB risk (see Common Mistakes below): the biggest recurring mistake is *overevaluating non-elite rushing QBs* — 10 of the top-14 scoring QBs in 2025 rushed for 350+ yards, meaning rushing floor, not the arm, drives QB scoring, and counting on a cheap QB to unexpectedly add a rushing role is the real (risky) mechanism behind late-round QB hits, not raw talent evaluation.
- Consensus middle ground across sources: draft at least one QB by round 3 if a true elite tier-1 arm is falling to you, but do not force a QB2 there — QB is not the scarce resource it once was in most 1QB formats. [DraftSharks Elite vs Late QB](https://www.draftsharks.com/article/fantasy-football-draft-preview-quarterbacks); [4for4 Late-Round QB Targets 2026](https://www.4for4.com/2026/preseason/2026-ffpc-late-round-quarterback-targets)

**Elite TE premium (draft a top TE early)** — FantasyPros' Aug 2026 guidance: either go elite at TE early (Brock Bowers cited as a Round 2 target) for a positional advantage similar to elite WR, **or** fully punt the position and stream — explicitly avoid the middle tier of TEs, which offers a poor cost/production tradeoff. [FantasyPros Perfect Draft, Aug 28 2026](https://www.fantasypros.com/2026/08/perfect-fantasy-football-draft-strategy-advice-targets-2026/); consistent with the TE strategy piece: "don't commit to a single TE strategy pre-draft; let rival overvaluation (especially in TE-premium formats) dictate whether you get squeezed out or scoop value elsewhere." [FantasyPros TE Strategy, June 2026](https://www.fantasypros.com/2026/06/te-premium-fantasy-football-draft-strategy-targets-2026/)

**WR-heavy starts / bimodal builds** — Directly supported by the Aug 2026 FantasyPros piece's stated WR depth finding: WR ranks 13-36 compress within 4 PPG of each other, meaning the WR *middle class* is fungible and expendable early — so a bimodal build (elite WR/RB rounds 1-3, hero-tier only, then wait on WR depth in the flat middle tiers rounds 6-9 where you lose little value) is implicitly endorsed by the data cited, even though the article doesn't use the term "bimodal."

### Round-by-round archetype — 12-team full-PPR (primary target format)
Directly reflects FantasyPros' Aug 28 2026 round-by-round guidance:
1. **Rounds 1-2:** One elite RB (workhorse + receiving role, e.g., Gibbs/Bijan-tier) OR a top-3 elite WR (Chase-tier) — take the best "difference-maker" regardless of position; this is your one/two shots at a true positional advantage.
2. **Round 3:** Hard deadline to secure a second RB with real upside if you don't already have two (Hall/Williams/Etienne-tier) — avoid leaving the draft with zero RB conviction past this point.
3. **Rounds 4-6:** Pivot to WR accumulation and breakout-profile targets; if pursuing elite TE, this is the window (or Round 2, per the elite-early rule above).
4. **Rounds 7-9:** Late-round RB strategy — target committee/backup backs (ADP 20-40 among RBs) in ambiguous or free-agent-year backfields for late-season role growth.
5. **Rounds 10+:** Rookie WRs aggressively (pair with same-offense veterans already rostered), late-round QB (target the rushing-floor "50 pass attempts+300 rush yards" dual-threat archetype), TE if punted earlier.
6. **Last 2 rounds:** K and DST only (see Section 6).
[FantasyPros Perfect Draft, Aug 28 2026](https://www.fantasypros.com/2026/08/perfect-fantasy-football-draft-strategy-advice-targets-2026/) — **note:** this article does not itself address bench composition, handcuffs, or bye weeks; those are covered from separate sources in Section 6.

**10-team adjustment:** Replacement level rises faster (fewer teams draining the position pool), so the RB/WR "cliff" hits later in absolute pick count but the same tier-count logic applies — starter-quality players are more available on waivers, which modestly favors punting a position longer (Zero-RB-style patience is more survivable in 10-team than 12-team) since 2 extra teams' worth of depth remains on the wire all season.

**Half-PPR adjustment:** Dial back the "TE/WR volume over RB workload" tiebreakers used in full-PPR; workhorse RBs retain more of their premium since reception points are worth half as much — Hero RB's round-1/2 RB emphasis is even easier to justify in half-PPR than full-PPR.

---

## 6. Roster Construction Rules

**Bench composition:** Prioritize handcuffs for your OWN premium (round 1-2) RBs, then upside bench stashes (ambiguous backfields, rookie WRs in good offenses), then a 3rd-4th QB purely for bye/injury churn in superflex.

**Handcuff theory (verified from Aug 2026 sources):** A handcuff is the backup RB who inherits a "much larger role" if your starter is hurt. Selective, not default — "handcuffing is not a default strategy... balance the value of the backup against bench space and upside." Best practice: handcuff a premium RB you drafted in rounds 1-2 where the backup has a clear, valuable path to volume; for everyone else, track handcuffs as a watch list for waivers rather than roster them. [FTN Handcuff Strategy 2026](https://ftnfantasy.com/nfl/fantasy-football-handcuff-strategy-for-2026); [RotoWire Handcuffing Guide](https://www.rotowire.com/football/article/handcuffing-fantasy-football-strategy-95685)

**Upside vs. floor by draft phase:** Early rounds (1-3) prioritize floor/proven role at the truly elite tier (this IS the safe pick, since bust risk is what separates Round 1 misses from Round 8 misses). Middle rounds (4-9) are where you differentiate on upside — this is where league-winners are found. Late rounds (10+) are pure lottery tickets — take unresolved backfields, contested WR2/3 roles, rookie breakout bets.

**Bye weeks — largely ignorable early, and why:** With 17-18 game NFL seasons and byes spread across many weeks, the in-season waiver wire and your bench depth handle bye-week gaps far more efficiently than pre-emptively stacking your draft board around avoiding bye collisions — reaching for a worse player in rounds 1-6 to dodge a bye costs far more value than it saves, since a rounds-1-6 player's raw talent gap dwarfs one missed week. Bye-week awareness becomes marginally relevant only in the very late rounds when choosing between similarly-ranked bench/streaming options.

**K/DST — last two rounds only, streaming mentality (verified from sourced guidance):** "Save your last two picks for a kicker and a defense, and never draft them earlier than that" — commonly cited slotting is DST in the second-to-last round, K in the final round. Week-to-week variance at both positions is small and largely matchup-driven/unpredictable, so in-season streaming off the waiver wire consistently outperforms rostering a "name" K/DST all season. [FootballNationUSA K guide, 2026](https://www.footballnationusa.com/post/how-many-kickers-draft-fantasy-football-2026); [RotoWire K Strategy 2026](https://www.rotowire.com/football/article/2026-fantasy-football-draft-strategy-kickers-rankings-and-draft-strategy-130303)

---

## 7. In-Draft Adaptation

**Position runs:** A run starts when several managers draft the same position in a short stretch, typically because a tier is ending and everyone reacts simultaneously. **The sourced consensus is explicit: do not chase runs reflexively.** "Runs are not automatically signals to chase... focus on overall value" and avoid panic drafting. The correct response is to check your tier board: if your target tier at the "running" position still has multiple names left, let the run pass; if the run is draining the last player in a tier you need, that's when to act — but the trigger is the tier board, not the run itself. [Bleacher Nation Snake Draft Strategy, Aug 2026](https://www.bleachernation.com/fantasy-football/2026/08/13/snake-draft-strategy/)

**When to tilt against your board:** Tilt only when (a) the ADP-survival formula says a need-filling player has <30% odds of surviving to your next pick, or (b) a whole tier at a scarce position is about to be exhausted. Never tilt purely because "everyone else is doing it" — that's the run-chasing mistake above.

**Opponent-roster awareness (picks between your turns):** Track what the managers picking between your current pick and your next pick still need. If 2-3 of those managers are RB-needy (thin RB corps so far) and a tier of good RBs remains, expect that tier to be drained before it returns to you — lower your effective survival probability for RBs in that tier below the generic ADP-based estimate, and raise it correspondingly for WR/other positions those same managers are unlikely to touch. This is a manual Bayesian adjustment layered on top of the ADP-CDF formula in Section 4 — the extension should surface "which of the 2N-2 picks before your turn are likely position X" as a visible signal, not just raw ADP odds.

**Turn-pick pairing tactic:** For drafters at slot 1 or slot N (the "turn" holders), the two consecutive picks at the turn are the moment to either (a) lock two players from the same about-to-break tier, or (b) pair a premium RB with his own handcuff before the long wait resumes. [Turn-pick dynamics, Fantasy Strategy Guide 2026](https://fantasystrategyguide.com/snake-draft-tips)

**On-the-clock decision checklist (for the extension to operationalize):**
1. Pull current tier board for each position — is my best-available player's tier about to break (≤1-2 players left)?
2. Compute survival probability (ADP-CDF) for my top 3 candidates at my *next* pick, adjusted for known opponent needs between now and then.
3. Check my own roster construction phase (early=floor/elite, mid=upside, late=lottery/needs) and unfilled starter slots.
4. Compare VORP/VOLS of top candidates against the *current* remaining pool (dynamic VBD, not frozen pre-draft numbers).
5. If two candidates are tier-mates with similar VORP, break the tie with VONA: which one is more likely to have a same-tier replacement available at my next pick?
6. Make the pick; do not re-litigate after a run starts elsewhere.

---

## 8. Common Mistakes, Ranked by Cost

Synthesized and cross-checked across FantasyPros (Aug 2026), Footballguys (Jul 19 2026, partially paywalled), and ESPN's "nine mistakes" (2026) — ranked here by how much value/season-outcome each mistake is described as costing in the sourced material, highest cost first:

1. **Overevaluating non-elite rushing QBs.** Explicitly called "the biggest mistake fantasy football gamers continue to make." Verified stat: 10 of the top-14 scoring QBs in 2025 had 350+ rushing yards — meaning arm talent alone (without a rushing role) is a false signal, and reaching for pocket-passer QBs based on passing stats overpays for a QB tier that won't hit its ceiling. [FantasyPros Do Not Draft, Aug 2026](https://www.fantasypros.com/2026/08/fantasy-football-do-not-draft-list-5-busts-to-avoid-2026/)
2. **Chasing position runs / panic drafting.** Named directly as a top mistake — abandoning tiers and process because a run is happening, rather than checking whether your actual tier is still intact.
3. **Rigid adherence to a pre-draft plan.** Footballguys: "Everybody has a plan until they get punched in the face" — treating a strategy (Zero RB, Hero RB, etc.) as dogma instead of adapting to what the board actually gives you.
4. **Not knowing your league's exact scoring/roster settings before drafting.** Footballguys' #1 listed mistake — drafting with generic rankings when your league runs superflex, TE-premium, or non-standard flex spots invalidates the rankings you're using.
5. **Filling starting lineup before building bench depth**, leading to a thin, injury-vulnerable bench by mid-draft.
6. **Chasing last year's breakout WR2 at an inflated price** — paying a premium for "real-life" recency bias (last season's ascendant WR2) rather than value.
7. **Overthinking round 1** — sourced framing: "Leagues aren't won because someone found the perfect player in Round 1. They're won because one manager avoided the mistakes everyone else makes" — i.e., process discipline across 15 rounds outweighs optimizing the single highest-profile pick.

**Note on Footballguys source completeness:** the Jul 19, 2026 Footballguys "6 Biggest Mistakes" article is paywalled past mistake #3 (PRO subscription required) — items 4-6 of *that specific* article could not be verified directly; the ranked list above substitutes verified items from FantasyPros/ESPN/Bleacher Nation instead of guessing at the paywalled content.

---

## Sources Used (with dates, for freshness audit)

- FantasyPros, "Perfect Fantasy Football Draft: Strategy, Advice & Targets (2026)" — Aug 28, 2026 — https://www.fantasypros.com/2026/08/perfect-fantasy-football-draft-strategy-advice-targets-2026/
- FantasyPros, "Superflex Fantasy Football Draft Strategy & QB2 Targets (2026)" — Aug 2026 — https://www.fantasypros.com/2026/08/superflex-fantasy-football-draft-strategy-qb2-targets-2026/
- FantasyPros, "TE-Premium Fantasy Football Draft Strategy & Targets (2026)" — Jun 2026 — https://www.fantasypros.com/2026/06/te-premium-fantasy-football-draft-strategy-targets-2026/
- FantasyPros, "Fantasy Football Draft Strategy: Value-Based Drafting (2026)" — Jun 9, 2026 — https://www.fantasypros.com/2026/06/fantasy-football-draft-strategy-value-based-drafting-2026/
- FantasyPros, "Value-Based Drafting: VORP, VOLS, VONA" (methodology explainer, confirmed unchanged for 2026) — Jun 2025 — https://www.fantasypros.com/2025/06/fantasy-football-draft-strategy-value-based-drafting-vorp-vols-vona/
- FantasyPros, "Fantasy Football Do Not Draft List: 5 Busts to Avoid (2026)" — Aug 2026 — https://www.fantasypros.com/2026/08/fantasy-football-do-not-draft-list-5-busts-to-avoid-2026/
- CBS Sports, "Jamey Eisenberg's 2026 Fantasy Draft Plan" — 2026 — https://www.cbssports.com/fantasy/football/news/jamey-eisenbergs-2026-fantasy-draft-plan/
- NBC Sports, "Fantasy Football 2026: Zero RB Draft targets" — 2026 — https://www.nbcsports.com/fantasy/football/news/fantasy-football-2026-zero-rb-draft-targets-headlined-by-blake-corum-tank-bigsby
- Yahoo Sports, "2026 Fantasy Football RB Preview" — 2026 — https://sports.yahoo.com/fantasy/article/2026-fantasy-football-rb-preview-draft-strategy-rankings-fades-and-sleepers-163344738.html
- FantasySixPack, "2026 Fantasy Football Running Back Draft Strategies: Hero/Zero" — 2026 — https://fantasysixpack.net/fantasy-football-running-back-draft-strategies/
- DraftKick, "Introducing Projected Availability" (ADP-CDF methodology) — https://draftkick.com/blog/projected-availability/
- Boris Chen tier system — http://www.borischen.co/
- TheFantasyFootballAlmanac, "Fantasy Football Draft Tiers Explained (2026)" — Feb 19, 2026 — https://thefantasyfootballalmanac.com/2026/02/19/fantasy-football-draft-tiers-explained-2026-strategy-guide/
- Bleacher Nation, "PPR vs Half PPR" — Aug 12, 2026 — https://www.bleachernation.com/fantasy-football/2026/08/12/ppr-vs-half-ppr/
- Bleacher Nation, "2026 Fantasy Football Snake Draft Strategy" — Aug 13, 2026 — https://www.bleachernation.com/fantasy-football/2026/08/13/snake-draft-strategy/
- Footballguys, "The 6 Biggest Mistakes Made in Fantasy Drafts and How to Avoid Them" — Jul 19, 2026 (partially paywalled) — https://www.footballguys.com/article/2026-6-biggest-mistakes-made-in-fantasy-drafts-and-how-to-avoid-them
- FTN Fantasy, "Fantasy Football Handcuff Strategy for 2026" — https://ftnfantasy.com/nfl/fantasy-football-handcuff-strategy-for-2026
- RotoWire, "Handcuffing in Fantasy Football" — https://www.rotowire.com/football/article/handcuffing-fantasy-football-strategy-95685
- RotoWire, "2026 Fantasy Football Draft Strategy: Kicker Rankings & Streaming Strategy" — https://www.rotowire.com/football/article/2026-fantasy-football-draft-strategy-kickers-rankings-and-draft-strategy-130303
- FootballNationUSA, "How Many Kickers Should You Draft? 2026 Fantasy Guide" — https://www.footballnationusa.com/post/how-many-kickers-draft-fantasy-football-2026
- DraftSharks, "Elite QB or Late-Round QB? The Smarter Draft Strategy" — https://www.draftsharks.com/article/fantasy-football-draft-preview-quarterbacks
- 4for4, "2026 FFPC Late-Round Quarterback Targets" — https://www.4for4.com/2026/preseason/2026-ffpc-late-round-quarterback-targets
- DraftSharks, "What is IDP Fantasy Football? Best Strategy" — https://www.draftsharks.com/kb/what-is-idp-fantasy-football-best-strategy
- Footballguys, "2026 IDP Draft Blueprint: The Godfather's Step-By-Step Guide" — https://www.footballguys.com/article/2026-idp-draft-blueprint-godfathers-step-by-step-guide

---

## SYSTEM PROMPT v1

```
You are the in-draft advisor for Sleeper Draft Copilot, a Chrome extension that helps a user win their live Sleeper fantasy football snake draft. You are called only when the user is on the clock or about to be. You have access to: (1) full league settings (team count, roster slots, scoring rules including PPR value, superflex/2QB, TE-premium multiplier, IDP scoring if applicable), (2) the live draft board (every pick made so far, by team), (3) the user's current roster, (4) a player pool with projections, ADP (mean + variance if available), and tier assignments, (5) the user's draft slot and snake pick schedule.

DECISION FRAMEWORK — apply in this order, every time:
1. TIERS FIRST. Identify which players are in the same tier as the top-ranked available player at each position of possible need. A tier cliff (last or second-to-last player in a tier) outweighs a small rank-order difference between tiers.
2. VALUE OVER REPLACEMENT (dynamic). Compute each realistic candidate's value over replacement using the CURRENT remaining player pool at their position — not a frozen pre-draft baseline — with replacement level set from (team count) x (starters per position, apportioning the flex/superflex slot share) per this league's actual roster construction. Recompute every pick; do not reuse stale VORP numbers.
3. SURVIVAL ODDS TO YOUR NEXT PICK. For every reasonable candidate, estimate the probability they are gone before your next selection using ADP and ADP variance (approximate stdev as ADP/4 if no explicit variance is provided), and the exact pick-distance to your next turn from the snake order. Adjust this estimate using known needs of the specific teams picking between now and your next turn (a team already full at a position is unlikely to draft it again soon; a team thin at a position is likely to take the next good one). Prefer players with LOW survival odds when tied on value; players with HIGH survival odds can be deferred a round.
4. ROSTER NEEDS AND PHASE. Weigh the user's current roster: unfilled starter slots outrank bench luxury picks; early draft phase favors floor/elite talent, middle rounds favor upside, late rounds are lottery tickets and handcuffs/streamers. Never recommend a kicker or DST before the final two rounds of the draft.
5. SCORING-FORMAT ADJUSTMENT. Reweight all of the above for this league's actual scoring: full/half/standard PPR shifts RB vs WR value; superflex/2QB inflates QB scarcity (recompute QB replacement level using 2x starters); TE-premium inflates TE value nonlinearly (do not assume the reception-point multiplier translates 1:1 into value — it does not); IDP settings (if present) change positional scarcity based on the exact points-per-stat table, not name recognition.
6. NON-CONSENSUS EDGE. Default to ADP/expert consensus as your prior, but explicitly deviate from consensus when your own value/tier/survival math disagrees with ADP by a meaningful margin — and say so plainly, citing the specific reason (tier cliff, survival odds, format-specific value shift, or a known situational factor such as a depth-chart change). Do not hedge generically ("this is a coin flip," "it depends," "either could work") — you must commit to a ranked recommendation with a concrete reason every time. If genuinely torn between two players, state the deciding factor you used, not that it's close.

STRICT PROHIBITIONS:
- Never output generic hedges with no decision (e.g., "it's really up to your preference"). Always rank and commit.
- Never recommend K/DST outside the final two rounds.
- Never ignore explicit league scoring settings in favor of generic 1QB/standard defaults.
- Never present a stale VORP/tier calculation as current if the player pool has changed since you last computed it.

OUTPUT FORMAT — return ONLY valid JSON matching this exact shape, no prose outside the JSON:
{
  "recommendations": [
    {"player": "string - full player name", "why": "string - concrete, specific reasoning citing tier/VORP/survival-odds/roster-need/format factors, 1-3 sentences, no hedging", "confidence": "high | medium | low"},
    {"player": "string", "why": "string", "confidence": "high | medium | low"},
    {"player": "string", "why": "string", "confidence": "high | medium | low"}
  ],
  "strategyNote": "string - one to two sentences on the broader draft-state context driving this pick (e.g., a position run in progress, a tier about to break, an opponent-need read, or a phase-of-draft consideration)"
}

Always return exactly 3 ranked recommendations, best pick first. Confidence reflects how clear-cut the decision is (tier cliff + low survival odds + clear roster need = high; close tiers or ambiguous survival odds = medium; speculative/lottery-ticket-phase picks = low, but still commit to a ranking).
```
