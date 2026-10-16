# players-2026.json — dataset notes

- **Scoring basis:** Full PPR (all ADP = FantasyFootballCalculator 12-team PPR composite, Aug 23–30, 2026).
- **Source files:** `research/players-rb-wr.md`, `research/players-qb-te.md` (both compiled 2026-08-30). Rankings/tiers preserved verbatim; compiler did not re-rank.
- **Coverage:** 255 players — RB 71, WR 90, QB 35, TE 29, K 15, DEF 15. Bye weeks for all 32 teams (from players-qb-te.md §8).
- **Known gaps:**
  - K (15) and DEF (15) have `adp:null` by design — research gave projected points, not ADP (proj pts kept in `note`). No tiers exist for K/DEF → `tier:null`.
  - Skill players lacking ADP (6): QB Kirk Cousins (sample ADP 228 was rookie Mendoza's, not his), Anthony Richardson, Michael Penix Jr., Shedeur Sanders; TE Eli Stowers, Eli Raridon (all "outside ADP sample").
  - Tiers absent in source → `tier:null`: WR ranks 51–90, QB ranks 33–35, TE ranks 26–29.
  - Notes empty (46): most WR 61–90 and low-tier QB/TE rows — research gave only name/team/ADP there (WR 61–90 risk/role not individually source-checked per rb-wr §Gaps).
  - Not carried in (in source but not in a ranked positional table): rookie-only names from qb-te §5 (Ty Simpson, Kaytron Allen, Nicholas Singleton, Brenen Thompson, Elijah Saratt, Chris Bell, Fernando Mendoza) and the vague TE row "Will Dissly/other streaming TEs".
  - Josh Jacobs: rb-wr table says "no suspension yet"; qb-te §6/§7 says he is on the Commissioner's Exempt List (likely misses ≥Wk1). Note flags the conflict; engine should treat as live SUSP.
  - Josh Downs (IND): source flags an internally inconsistent riser/faller signal (a WR citing a RB as new competition) — verify Colts depth chart live.

## Market-disagreement players (carried verbatim from players-rb-wr.md §3 — engine should surface these)

| Player | Direction | Argument |
|---|---|---|
| Chase Brown (CIN) | SMASH | CBS ADP Review (8/14): should be a Round 1 pick; 22.3 PPR pts/gm final 6 w/ healthy Burrow. Counter: ~1 half-season sample. |
| Tony Pollard (TEN) | SMASH | ClutchPoints (8/24): four straight 1,000-yd seasons, undisputed starter, priced like a committee back. |
| Rico Dowdle (PIT) | SMASH | ClutchPoints (8/24): heavy 1B, back-to-back 1,000-yd seasons, goal-line/receiving equity if Warren misses time. |
| D'Andre Swift (CHI) | SMASH | ClutchPoints (8/24): PFF grades him clearly ahead of injured Monangai; discount on a bell-cow-adjacent role. |
| Christian McCaffrey (SF) | SMASH (contested) | ClutchPoints (8/24): 102-catch PPR floor outweighs age-30/injury; directly conflicts with standard age-cliff caution — genuine split. |
| Jonathon Brooks (CAR) | SMASH (speculative) | ClutchPoints (8/24) undervalued + FantasyPros (8/12) riser; limited-2025-snaps back returning from injury, high variance. |
| Jordan Mason vs Aaron Jones (MIN) | SPLIT | CBS (8/14) prefers Mason; FantasyPros (8/30) lists Mason falling. The committee split itself is the uncertainty. |
| Rhamondre Stevenson vs TreVeyon Henderson (NE) | SPLIT | CBS (8/14) prefers Stevenson despite Henderson's higher ADP; near-even role split — Henderson's premium may be unearned. |
| J.K. Dobbins vs RJ Harvey (DEN) | SPLIT | CBS (8/14) prefers vet Dobbins despite Harvey priced higher; injury risk vs unproven touch share. |
| De'Von Achane (MIA) | FADE at cost | ClutchPoints (8/24): worst-projected offense, unproven WR room, questionable QB — context, not talent. |
| Josh Jacobs (GB) | FADE at cost | Legal exposure (court Nov 11) real, already falling; a mid-season suspension makes ADP 31.4 a bad price. |
| Malik Nabers (NYG) | SPLIT, high stakes | ClutchPoints (8/24) overvalued (3 games 2025, ACL, not full speed) vs FantasyPros (8/12) riser — resolve with live injury check. |
| Rashee Rice (KC) | FADE at cost | ClutchPoints (8/24): OC Bieniemy's downfield scheme misfits 4.9-air-yard profile; crowded tree (Kelce/Worthy/Walker). |
| Jameson Williams (DET) | FADE at cost | ClutchPoints (8/24): both big seasons ran through another's absence; LaPorta's return cuts his share (was WR46 pre-injury). |
| Mike Evans (SF) | FADE at cost | ClutchPoints (8/24): age 33, only one top-25 standard week in 2025. |
| Carnell Tate (TEN) | SPLIT | RotoBaller/FantasyLife project 23% target-share WR1; ClutchPoints (8/24) counters Daboll caps WR output + Robinson/Ridley competition. |
| Christian Watson (GB) | SMASH | ClutchPoints/Yahoo (8/24): 6th-round ADP undersells a WR1-week ceiling. |
| A.J. Brown (NE) / Garrett Wilson (NYJ) | SMASH | Same undervalued grouping — opportunity to outperform current ADP. |
| Stefon Diggs (WAS) | SMASH (already moving) | Biggest FantasyPros (8/12) riser (+32.9) post-trade; market already correcting — buy before next move. |
| Josh Downs (IND) | FLAG (noisy) | FantasyPros logged both riser (8/12) and faller (8/30) citing a RB as WR competition — verify Colts depth chart. |
