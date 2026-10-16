# Sleeper Draft Copilot — Extension Architecture & Claude API Integration Research

Compiled: 2026-08-30. All primary-source claims cite official Chrome (developer.chrome.com) and Anthropic (platform.claude.com) documentation as fetched on this date. Where docs.anthropic.com is referenced in third-party posts, note that Anthropic's developer docs now live at **platform.claude.com** (docs.anthropic.com content appears to have migrated there — verified by successfully fetching platform.claude.com/docs/... pages directly).

---

## 1. Manifest V3 service worker lifecycle & keeping a poll loop alive for 2-4 hours

**Idle shutdown.** Chrome terminates an extension service worker after ~30 seconds of inactivity (no pending events/callbacks). It also force-kills a worker if a single event handler/API call blocks >5 minutes, or if a network request (e.g. `fetch`) takes >30 seconds to resolve. Source: [The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) (Chrome for Developers, current).

**chrome.alarms minimum period.** Since Chrome 120, MV3 extensions can use `chrome.alarms` with delays/periods as low as **30 seconds** (previously 60s minimum was enforced for packed/production extensions; unpacked/debug-loaded extensions have no minimum). Setting `delayInMinutes`/`periodInMinutes` below 0.5 is silently clamped to 0.5 with a console warning. Source: [chrome.alarms API reference](https://developer.chrome.com/docs/extensions/reference/api/alarms) (Chrome for Developers, current) — directly confirms "Chrome limits alarms to at most once every 30 seconds."

**Alarms wake a dormant service worker.** `chrome.alarms.onAlarm` firing will restart a terminated service worker — this is the officially sanctioned wake mechanism (as opposed to polling loops with `setInterval`, which die when the worker is killed).

**Keepalive alternatives evaluated:**
- **Port-based keepalive** (open a `chrome.runtime.connect()` port from a content script or extension page and keep it alive, reconnecting before Chrome's ~5-minute port timeout) — keeps the SW alive continuously, but is fragile: requires a page/tab to stay open and reconnect logic, and Chrome has tightened enforcement against pure keepalive abuse over time.
- **Offscreen document** (`chrome.offscreen`, stable since Chrome 109) — can hold a persistent connection (e.g., WebSocket) and is not itself subject to the service-worker idle timeout; messaging from the offscreen doc to the SW can incidentally keep the SW alive too.
- **Polling in the content script instead of the service worker** — a content script injected into the live sleeper.com draft-room tab runs in the page's own lifecycle (alive as long as the tab is open/visible), sidestepping SW idle-kill entirely.

**Recommendation for this project: primary polling loop = `chrome.alarms` at 30s cadence, driving the service worker; content script is used only for DOM/UI injection and forwarding page context, not as the poll driver.**
Rationale: a Sleeper draft runs 2-4 hours and the user's `sleeper.com` tab may be backgrounded, occluded, or the user may alt-tab to check rankings elsewhere — a content-script-driven poll would stop or throttle when the tab isn't foregrounded/visible (background tab timer throttling also applies to content scripts, since they run in the page's JS context, which Chrome throttles). `chrome.alarms` is the only mechanism Chrome explicitly documents as designed to reliably wake a terminated worker on a schedule, and 30s is fast enough for pick-detection without a 2-4hr persistent connection or hacky port-reconnect juggling. Use the offscreen-document approach only if/when true sub-30s reactivity is later required (e.g., WebSocket push instead of polling) — not needed for v1 since Sleeper's draft picks endpoint is a simple polled REST call.
Sources: [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [chrome.alarms reference](https://developer.chrome.com/docs/extensions/reference/api/alarms), community docs on offscreen documents (chrome.offscreen shipped Chrome 109; officially documented at [developer.chrome.com/docs/extensions/reference/api/offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — not independently refetched this session, flagged as light-verification below).

**Messaging patterns** (verified via [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), Chrome for Developers, current):
- One-off request/response: `chrome.runtime.sendMessage()` / `chrome.tabs.sendMessage()` — returns a Promise; for async responses the listener must return `true` (or a Promise, supported Chrome 148+, or be declared `async`) to keep the channel open for a later `sendResponse`.
- Long-lived connections: `chrome.runtime.connect()` / `chrome.tabs.connect()` return a `runtime.Port` for bidirectional streaming — appropriate for popup/side-panel ↔ service-worker live updates during the draft.
- Routes covered: content script ↔ service worker, content script ↔ extension pages (popup/side panel), service worker ↔ extension pages, plus `externally_connectable` for web-page-to-extension and `onMessageExternal`/`onConnectExternal` cross-extension.
- Caveats: ports disconnect on tab/frame unload or explicit `disconnect()`; the well-known "Could not establish connection. Receiving end does not exist" error fires when the receiving side isn't listening (e.g., SW just got killed) — always wrap `sendMessage` calls in error handling/retry. Max message size 64 MiB (irrelevant here).

**chrome.storage.local vs chrome.storage.session for the API key:**
- `chrome.storage.local`: persists to disk, survives browser restarts, cleared on extension uninstall, default quota 10 MB (5 MB pre-Chrome 113), raisable via `unlimitedStorage` permission.
- `chrome.storage.session`: in-memory only, cleared when the browser session ends (browser or extension effectively restarted), never written to disk; supports an `access_level` restriction (can be scoped to trusted contexts only, e.g. excluding content scripts).
- Source: [chrome.storage API reference](https://developer.chrome.com/docs/extensions/reference/api/storage) (Chrome for Developers).
- **Recommendation**: use `chrome.storage.local` for the pasted API key so the user doesn't have to re-paste it every browser restart (acceptable for a personal-use tool), but set `chrome.storage.session` with `access_level: 'TRUSTED_CONTEXTS'` as an option for security-conscious users who prefer re-entering the key each session and want it inaccessible to content-script-level code even in theory. Document both in-extension.

**Side Panel API vs shadow-DOM overlay injected into sleeper.com:**
- Side Panel API (`chrome.sidePanel`, stable since Chrome 114) gives a persistent extension-owned surface that stays open across tab navigation, has full Chrome API access (unlike a content-script overlay), and can be scoped to only show on sleeper.com — avoiding broad host-permission warnings. Source: [Create a side panel](https://developer.chrome.com/docs/extensions/develop/ui/create-a-side-panel) and [chrome.sidePanel API reference](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) (Chrome for Developers).
- Shadow-DOM content-script overlay gives tighter visual integration with the Sleeper draft board (e.g., overlaying pick recommendations directly next to player rows) but runs inside the host page's execution context, is subject to CSP/tokenizer conflicts with the host page's own styles, and is more fragile to Sleeper UI changes.
- **Recommendation: Side Panel as the primary UI.** It is the officially blessed MV3 pattern for "persistent companion UI," gets full extension-page privileges (can call `chrome.storage`, message the SW without the indirection of content-script relaying), and isn't at the mercy of Sleeper's DOM structure. Use a **minimal content script** only for reading page context (e.g., confirming which draft/tab is active, optionally reading the on-screen "on the clock" indicator as a redundant signal) and, optionally, a light shadow-DOM badge/highlight injected next to the recommended player — but keep the full recommendation UI in the side panel.

---

## 2. Cross-origin fetches in MV3

Verified directly via [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) (Chrome for Developers, current):

- **From the service worker (or any extension page, e.g. side panel/popup):** YES — a `fetch()` to a host listed in `host_permissions` bypasses the page-level same-origin/CORS restriction. Quoted: *"A script executing in an extension service worker or foreground tab can talk to remote servers outside of its origin, as long as the extension requests host permissions."* This works regardless of whether the target server sends CORS headers back, because the browser is granting the extension's privileged context an exemption, not relying on the server's CORS policy.
- **From a content script:** NO — content scripts execute "on behalf of" the origin they're injected into and remain subject to that origin's same-origin/CORS rules even if the extension declares `host_permissions` for the target. Quoted: *"Content scripts initiate requests on behalf of the web origin that the content script has been injected into and therefore content scripts are also subject to the same origin policy."* Practical implication: content scripts must relay fetch requests to the service worker via messaging rather than fetching cross-origin domains directly.
- Gap: the doc I fetched did not explicitly cover `Cross-Origin-Resource-Policy` header interactions, credentialed-request nuances, or opaque-response edge cases — flagged as unverified detail, low risk for this project since Sleeper's API is public read-only JSON with no cookies/credentials involved.

**Implication for architecture:** all `api.sleeper.app` polling calls and all Claude API calls must originate from the service worker (or side panel, another extension page) — never from the content script. `host_permissions` in `manifest.json` must list `https://api.sleeper.app/*` and `https://api.anthropic.com/*`.

**api.sleeper.app specifics:** Base URL `https://api.sleeper.app/v1/`. Public, read-only, no authentication required. Documentation states "stay under 1000 API calls per minute" to avoid IP-blocking (unofficial guidance from third-party guide, not an Anthropic/Sleeper-style formal SLA); a 30-second poll cadence (2/min) is trivially within any reasonable limit. Relevant draft endpoints: `GET /draft/<draft_id>/picks`, `GET /draft/<draft_id>`, `GET /draft/<draft_id>/traded_picks`, `GET /state/nfl`. Source: [docs.sleeper.com](https://docs.sleeper.com/) (fetched 2026-08-30). **Gap: could not verify Sleeper's actual CORS response headers directly (no live draft to test against); the docs page is silent on CORS.** Since all Sleeper calls will originate from the service worker under `host_permissions`, CORS headers from Sleeper's server are irrelevant per the MV3 exemption described above — this should hold regardless of what Sleeper's server sends.

---

## 3. Anthropic API from a browser context

Verified directly against current platform.claude.com docs (fetched 2026-08-30):

- **`anthropic-version` header**: current value is **`2023-06-01`**, unchanged since that release; it is the only version in the active version history (`2023-01-01` was the initial release, since superseded). Source: [Versions](https://platform.claude.com/docs/en/api/versioning). The TypeScript SDK sends this automatically; a raw `fetch()` call from the service worker must set it manually.
- **Messages API request shape** (`POST https://api.anthropic.com/v1/messages`), verified via [API overview](https://platform.claude.com/docs/en/api/overview) and [Messages API reference](https://platform.claude.com/docs/en/api/messages/create):
  - Required headers: `x-api-key` (or `Authorization: Bearer <token>` for Workload Identity Federation — not relevant for a personal-key extension), `anthropic-version: 2023-06-01`, `content-type: application/json`.
  - Required body fields: `model`, `max_tokens`, `messages` (array of `{role, content}`).
  - Optional: `system` (string or content-block array), `tools`, `stream`.
  - Max request size for Messages: 32 MB (irrelevant at our scale).
- **`anthropic-dangerous-direct-browser-access` header / browser CORS opt-in**: confirmed still functionally supported — the current TypeScript SDK docs page explicitly documents a `dangerouslyAllowBrowser: true` client option, stating browsers are "disabled by default to avoid exposing your secret API credentials" and must be explicitly opted in. Source: [TypeScript SDK — Runtime support / Browser usage](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) (platform.claude.com, fetched 2026-08-30). The SDK doc frames this as acceptable for "internal tools" used by trusted users and "development/debugging" with short-lived/rotated credentials — a BYOK personal-use extension matches this profile.
  - **Caveat/gap**: the current official page documents the SDK-level `dangerouslyAllowBrowser` flag but does **not**, in the text I fetched, spell out the raw HTTP header name (`anthropic-dangerous-direct-browser-access`) the SDK sets under the hood. That literal header name is attested in numerous 2024-2026 third-party/community sources (Simon Willison's original write-up, GitHub issues) as the mechanism the SDK flag triggers, but I could not pull up an official platform.claude.com page that prints the exact header string verbatim in this session. **Treat the header name as reliable via secondary-source corroboration, not as directly quoted from a primary source** — if a raw (non-SDK) `fetch()` call from the extension is used, test empirically that setting `anthropic-dangerous-direct-browser-access: true` on the request unblocks the browser CORS preflight, and fall back to the official `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` if it doesn't.
- **Does calling from an MV3 service worker with `host_permissions` avoid needing the CORS opt-in entirely?** Yes, by the same mechanism described in Section 2: `host_permissions` covering `https://api.anthropic.com/*` lets the service worker's `fetch()` bypass the page-level CORS check the browser would otherwise apply — this is a browser-side exemption, independent of whether Anthropic's server sends the browser-access header or CORS-permissive headers back. **This is the recommended integration path**: call the Messages API directly from the service worker with `host_permissions`, set `x-api-key`/`anthropic-version`/`content-type` manually via `fetch()`, and skip the `dangerouslyAllowBrowser`/CORS-header dance entirely, since that mechanism exists specifically for *web pages* (no extension privileges) calling Anthropic directly — not needed once you're inside an MV3 service worker. Recommend testing early in a spike, since the interaction between MV3 host_permissions exemption and Anthropic's own CORS gate is inferred from Chrome's documented general behavior, not something Anthropic's docs discuss extension-specific behavior for (Anthropic's docs don't mention Chrome extensions).

---

## 4. Current Claude model lineup & pricing (verified 2026-08-30, platform.claude.com)

Directly fetched from [Models overview](https://platform.claude.com/docs/en/models/overview) and [Pricing](https://platform.claude.com/docs/en/about-claude/pricing):

| Model | Claude API ID | Input $/MTok | Output $/MTok | Context | Max output | Notes |
|---|---|---|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`) | $1 | $5 | 200K | 64K | fastest, "near-frontier intelligence" |
| Claude Sonnet 5 | `claude-sonnet-5` | $2 | $10 | 1M | 128K | "best combination of speed and intelligence"; $2/$10 confirmed as the **standing price**, not introductory (the planned Sept 1 2026 hike to $3/$15 was cancelled per an explicit pricing-page note) |
| Claude Opus 5 | `claude-opus-5` | $5 | $25 | 1M | 128K | complex agentic/enterprise tier |
| Claude Fable 5 | `claude-fable-5` | $10 | $50 | 1M | 128K | top-of-lineup "long-running agents" tier |

(Legacy still-available: Opus 4.8/4.7/4.6/4.5 at same $5/$25 as Opus 5; Sonnet 4.6/4.5 at $3/$15; Haiku 3.5 retired except Bedrock/Google Cloud at $0.80/$4.)

**Recommendation for the on-the-clock advisor call: Claude Sonnet 5 (`claude-sonnet-5`)** as the default — cheap enough for dozens of calls/draft, smart enough for weighing roster construction/ADP/value tradeoffs, and priced identically to Haiku-tier-adjacent economics relative to its capability jump. **One tier up: Claude Opus 5 (`claude-opus-5`)** for a "deep analysis" button (e.g., user explicitly requests a fuller trade-analysis or a tricky decision point) at $5/$25.

**Cost estimate for a 15-round snake draft**, ~5,000 input + 500 output tokens per on-the-clock call (assume the copilot fires 15 times, once per user turn in a 10-12 team league — actual pick count depends on league size but 15 rounds is the round count, not pick count; using 15 as a stand-in for "how many times you're on the clock" per the brief's stated assumption), plus a handful (assume 5) of speculative pre-computations at the same token shape:

- Total calls: 15 (on-the-clock) + 5 (speculative) = 20 calls
- Input: 20 × 5,000 = 100,000 tokens
- Output: 20 × 500 = 10,000 tokens

| Model | Input cost | Output cost | Total per draft |
|---|---|---|---|
| Sonnet 5 | 100,000 × $2/1M = $0.20 | 10,000 × $10/1M = $0.10 | **$0.30** |
| Opus 5 | 100,000 × $5/1M = $0.50 | 10,000 × $25/1M = $0.25 | **$0.75** |

Both are trivially cheap for personal use even run every draft of a multi-league season. Prompt caching (5-min write at 1.25x base, reads at 0.1x base) could reduce cost further if the system prompt / full roster context is large and reused across calls within the same draft — worth implementing if the static context (rankings, rules) exceeds ~1-2K tokens repeated every call. Source for caching multipliers: [Pricing — Prompt caching](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching).

---

## 5. Security hygiene for a personal-use extension holding a pasted API key

**Threat model:**
- Local: another local process/extension reading `chrome.storage.local` (only other extensions with explicit permission or someone with filesystem access to the profile directory can read it; not exposed to the open web).
- Page-level: if using a content-script-adjacent injection method, a malicious or compromised sleeper.com page script could theoretically probe extension internals — mitigated by keeping the key only in service-worker/side-panel contexts (never passed into the content script) and, if desired, using `chrome.storage.session` with `access_level: 'TRUSTED_CONTEXTS'` (per Section 1) to make it structurally unreadable from content-script-adjacent code.
- Exfiltration via extension bugs: any XSS-like bug in the side panel UI (e.g., improperly sanitized recommendation text rendered as HTML) could exfiltrate the key if it's reachable from that page's JS context — keep rendering strictly text-based/React-escaped, and avoid `innerHTML` with untrusted content.
- Anthropic-key-specific: since Sonnet/Opus keys pasted by the user are billed to *their own* Anthropic account, the primary risk is *this extension* leaking the key to a third party (e.g., accidental logging, telemetry, or a compromised dependency) — not the browser-CORS "anyone can read it in devtools" risk that `dangerouslyAllowBrowser` docs warn about for *public-facing* apps (this is a single-user, locally-installed tool, so the user *is* the only one with devtools access to their own browser).

**Why not hardcode the key:** an extension is distributed (even "load unpacked" can be shared/zipped), and any hardcoded secret in source is trivially extracted from the packed `.crx`/source tree; it would also bind the extension to one person's billing account, defeating personal-use portability, and risks accidental commits to a public repo.

**Spend-limit advice:** set a hard monthly spend cap on the Claude Console's Billing/Rate-limits page ([platform.claude.com/settings/limits](https://platform.claude.com/settings/limits) — official self-service control, confirmed present in [API overview](https://platform.claude.com/docs/en/api/overview) rate-limits section) scoped to a dedicated Workspace created just for this key, so a bug (e.g., an infinite retry loop) can't runaway-bill the user's main workspace. Given the ~$0.30-0.75/draft estimate above, a $5-10/month cap comfortably covers heavy use with margin for mistakes while capping worst-case exposure.

---

## 6. Load-unpacked install & MV3 gotchas

**Install steps** (verified via multiple current guides converging on the same flow; primary mechanism is standard and stable): go to `chrome://extensions`, toggle **Developer mode** (top-right), click **Load unpacked**, select the folder containing `manifest.json`.

**Common MV3 gotchas:**
- **Service worker dying mid-`await`:** any `fetch()` or long `await` chain in the SW can be interrupted if the SW is torn down for an unrelated reason (e.g., idle timer elapsing while awaiting a slow Sleeper/Anthropic response beyond 30s). Keep individual awaited operations short, and design the poll/advisor-call flow to be safely resumable/idempotent (e.g., persist "last known draft state" in `chrome.storage.local` so a killed-and-restarted SW picks up where it left off rather than losing state).
- **CSP for injected UI:** MV3's default `extension_pages` CSP disallows remote code execution and eval; CSS-in-JS libraries (styled-components/Emotion-style runtime `<style>` injection) can trip inline-style restrictions unless nonced, and some component libraries fall back to `style=""` attributes that need `style-src-attr 'unsafe-inline'` (a CSP weakening you should avoid if possible — prefer static CSS/Tailwind compiled at build time). If injecting a shadow-DOM overlay into sleeper.com, note that Tailwind v4's `@property`-based CSS variables don't work inside a shadow root — compile with Tailwind v3 output or inject via `adoptedStyleSheets` if that path is used. (Source: aggregated from multiple 2026 developer blog posts on MV3 CSP + shadow DOM; not an Anthropic/Chrome primary-source citation — flagged as secondary-source-only guidance, worth spike-testing before committing to a UI stack.)
- **chrome.storage quota:** `chrome.storage.local` defaults to 10 MB (5 MB pre-Chrome-113); this is generous for draft state + rankings cache but request `unlimitedStorage` permission if caching full player-pool/ranking datasets across seasons.
- **Debugging the inactive service worker:** `chrome://extensions` shows "service worker (inactive)" as expected idle behavior, not a bug — click it to open devtools and inspect, but remember to close devtools afterward, since an open devtools panel keeps the SW artificially alive and can mask idle-kill bugs that would occur in normal use. Source: [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) + community debugging guidance.

---

## RECOMMENDED ARCHITECTURE

```
sleeper-draft-copilot/
├── manifest.json                  (MV3; host_permissions: api.sleeper.app/*, api.anthropic.com/*;
│                                    side_panel.default_path; permissions: storage, alarms, sidePanel)
├── background/
│   └── service-worker.js          Owns: poll loop (chrome.alarms, 30s cadence), Sleeper fetches,
│                                   Anthropic fetches, draft-state cache in chrome.storage.local.
│                                   Wakes on alarm -> fetch /draft/<id>/picks -> diff against last
│                                   known state -> if "user is on the clock" detected, build prompt
│                                   context and call Messages API -> push result via chrome.runtime
│                                   .sendMessage to the open side panel port.
├── content-script/
│   └── content.js                 Injected only on sleeper.com/draft/*. Responsibilities: (1) read
│                                   draft_id from page URL/DOM, relay to SW via sendMessage on load;
│                                   (2) optional lightweight shadow-DOM badge next to the recommended
│                                   player row (visual convenience only, not required for function);
│                                   (3) NEVER holds the API key, NEVER calls fetch() cross-origin —
│                                   all data requests relayed through the SW via messaging.
├── sidepanel/
│   ├── sidepanel.html/.js/.css    Primary UI. Extension page (full API access). Opens a long-lived
│                                   chrome.runtime.connect() port to the SW on load; renders live
│                                   draft state, recommended pick + rationale, "on the clock" alert,
│                                   manual "deep analysis" button (fires Opus 5 call).
│                                   Reads/writes API key via chrome.storage.local from an options
│                                   view (paste-once, masked input, "clear key" button, spend-cap
│                                   reminder link to platform.claude.com/settings/limits).
├── options/ (or folded into sidepanel settings tab)
│   └── options.html/.js           API key entry, model tier toggle (Sonnet 5 default / Opus 5
│                                   deep-dive), spend-guardrail messaging.
└── shared/
    ├── sleeper-client.js          Wraps fetch() calls to api.sleeper.app (SW-context only).
    ├── anthropic-client.js        Wraps fetch() to api.anthropic.com/v1/messages, sets
    │                               x-api-key / anthropic-version: 2023-06-01 / content-type headers
    │                               manually (no SDK dependency needed since we're in a host-
    │                               permissioned SW context, not a public webpage).
    └── draft-state.js             Shared shape for cached draft state, diffing logic.
```

**Message flows:**
1. Content script → SW (`sendMessage`): "draft_id detected on page load" (one-shot).
2. SW → itself (alarm-triggered, 30s): poll `GET /draft/<id>/picks` + `GET /draft/<id>` → diff vs. cached state in `chrome.storage.local`.
3. On diff indicating "user now on the clock": SW builds prompt (roster context + available players + league settings) → `POST /v1/messages` (Sonnet 5) → cache recommendation.
4. SW → side panel (via open `Port`, or `sendMessage` if panel closed/reopens and re-subscribes): push new recommendation / on-the-clock alert.
5. Side panel → SW (`sendMessage`): "user clicked Deep Analysis" → SW fires an Opus 5 call, returns richer result over the same port.
6. Side panel → `chrome.storage.local` (direct, no SW hop needed since side panel is itself a full extension page): read/write API key and settings.

**Poll cadence:** 30s baseline via `chrome.alarms` (Chrome's documented floor for MV3). No sub-30s reactivity needed for a human-paced snake draft; if faster reactivity is later desired, swap the alarm-poll for an offscreen-document-held WebSocket/long-poll (Sleeper doesn't publicly document a WebSocket draft-push API as of this research — REST polling is the confirmed-available mechanism).

---

## Sources used (10 primary/official, 3 secondary, dates as fetched 2026-08-30)

Primary (developer.chrome.com / platform.claude.com, all fetched directly this session):
1. https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
2. https://developer.chrome.com/docs/extensions/reference/api/alarms
3. https://developer.chrome.com/docs/extensions/develop/ui/create-a-side-panel / https://developer.chrome.com/docs/extensions/reference/api/sidePanel
4. https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
5. https://developer.chrome.com/docs/extensions/develop/concepts/messaging
6. https://developer.chrome.com/docs/extensions/reference/api/storage
7. https://platform.claude.com/docs/en/api/versioning
8. https://platform.claude.com/docs/en/api/overview
9. https://platform.claude.com/docs/en/about-claude/pricing
10. https://platform.claude.com/docs/en/models/overview
11. https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
12. https://docs.sleeper.com/ (Sleeper's own docs — primary for that API)

Secondary (used for corroboration/context only, not load-bearing on their own):
- Simon Willison's original 2024 write-up on `anthropic-dangerous-direct-browser-access` (header-name corroboration)
- Multiple 2026 dev-blog posts on MV3 CSP + shadow-DOM/Tailwind v4 interaction
- Third-party Sleeper API rate-limit guidance (Zuplo guide)
