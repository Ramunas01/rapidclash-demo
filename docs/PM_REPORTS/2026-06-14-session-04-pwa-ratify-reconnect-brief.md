# PM Session Report — 2026-06-14 — Session 4 (PWA ratified, #10 briefed)

> Continuity note: this Claude Code session has assumed the **Project Manager** role
> (the prior PM session that bootstrapped Slice 1 was disrupted). This report exists so
> the next PM session can resume from here without loss. Read it first, then
> `docs/PM_REPORTS/2026-06-14-session-03-slice1-endgame.md` for the slice scorecard.

## What happened this session

### Issue #9 (PWA client) — RATIFIED on `main`, with a process flag
Programmer B's subagent **committed the PWA client directly to `main` (`5637ea4`),
bypassing the PR review gate**, and pushed it to origin. Issue #9 auto-closed via
"closes #9". I did **not** rubber-stamp it and did **not** force-rewrite protected `main`
(destructive, risks the other merged work). Instead I reviewed it retroactively:

- **All S1–S7 client-side criteria pass.** Critically, **S5 hidden-information is correctly
  enforced** — `apps/web/src/screens/Play.tsx` only reveals the opponent's move when the
  server-sent state is terminal (renders `🤫` otherwise), backed by a test. No Charter
  invariant violated.
- **CI green** on `5637ea4` (`build-and-test` → success).
- **Independently re-verified locally:** `pnpm build` (0 errors), `pnpm lint` (0 warnings),
  `pnpm test` → **115/115 across 13 files**.
- Decision: as a clean, CI-green, **implementation-only** change it was PM-approvable had it
  arrived as a PR, so I **ratified it in place** and documented the breach on the record.
- Full review checklist posted: issue #9 comment
  (https://github.com/Ramunas01/rapidclash-demo/issues/9#issuecomment-4702647854).

### Branch-protection gap — found, flagged, Owner decided
A direct push to a "protected" branch was possible because (`gh api .../branches/main/protection`):
- `enforce_admins: false` — the admin identity the agents act through (Ramunas01) bypasses protection.
- `required_approving_review_count: 0` — even via PR, GitHub requires **zero** approvals.
- → The PM review gate is **convention-only, not an enforced control.**

**Owner decision (this session): LEAVE AS-IS.** Keep admin bypass + 0 required reviews;
rely on the convention that programmers open PRs. **Do not re-raise this as a `needs-owner`
question.** (Also recorded in PM memory: `main-branch-protection-gap`.)

### Issue #10 (Reconnect) — brief issued
Posted the PM brief as an issue comment (branch `feature/10-reconnect`, **PR required**):
https://github.com/Ramunas01/rapidclash-demo/issues/10#issuecomment-4702650265
Scope was narrowed by the #9 review:
- `apps/web/src/ws.ts` already auto-sends `match.resume` on a **transient** socket
  reconnect — verify, don't rebuild. Server-side resume + settlement idempotency landed
  under #7 — confirm + add tests.
- **Gap to close:** `currentMatchId` lives only in React state + the `WsClient` instance,
  so a **full page reload** mid-match loses it and auto-resume won't fire. #10 must persist
  it to session/localStorage. This is what satisfies the issue's "stored in session" box.
- Hard requirement: automated disconnect-mid-move → resume → **no-double-payout** test
  (invariant #3).

## Slice 1 scorecard (unchanged except #9)

| Issue | Status |
|-------|--------|
| #1–#8, #12, #13 | ✓ merged |
| **#9 PWA client** | ✓ **ratified on `main`** (`5637ea4`; direct-push, reviewed retroactively) |
| #10 Reconnect | **briefed — awaiting PR on `feature/10-reconnect`** |
| #11 Demo runbook | blocked on #10 — closes Slice 1 |

**115 tests passing** across 13 files.

## Next session starting point (do this in order)

1. The next work is being run by **two parallel Claude Code programmer agents** — one on
   #10 (code), one drafting #11 (docs/DEMO.md). Their full opening prompts are preserved in
   the **Appendix** below.
2. **Review the two PRs in dependency order — merge #10 FIRST**, then have the #11 agent
   reconcile/verify the S8 (reconnect) section of `docs/DEMO.md` against the merged #10
   behavior before merging #11.
3. Review #10 against **S8**: redacted resume state (S5/#2), terminal-resume → `match.end`
   with **no duplicate ledger entries** (#3, must be a test), and the page-reload resume gap.
4. Review #11 against the **S1–S9 checklist** and the Charter 8-step experience; confirm the
   runbook actually runs.
5. **Once #11 merges:** declare Slice 1 done, write the final slice report, and STOP — no
   second game (Coinflip) until the Owner confirms S1–S9 all pass.

## Operational reminders
- Merge: `gh pr merge N --repo Ramunas01/rapidclash-demo --squash --delete-branch --admin`.
- If CI doesn't fire on a PR, push an empty commit; if still nothing, verify locally
  (`pnpm install && pnpm run build && pnpm run lint && pnpm run test`), merge `--admin`,
  note local verification in the PR.
- Node path: `export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- `gh issue view` default fails with a Projects-classic GraphQL error — use
  `--json title,body,state` / `--comments` instead.
- Leave a PM review comment (criteria checklist) on every PR before merging. Because the
  review gate is unenforced (see above), keep requiring PRs by convention; if work lands on
  `main` unreviewed again, review it retroactively and document on the issue.
- PM memory lives in `~/.claude-team/projects/-home-ramunas-projects-rapidclash-demo/memory/`.

---

## Appendix — handoff prompts for the two parallel programmer agents

### Agent A — Issue #10 (Reconnect)

```
You are a Programmer on RapidClash, a human-vs-human gaming demo. GitHub repo:
Ramunas01/rapidclash-demo — the single source of truth. You own implementation under
packages/ and apps/. Your job this session: implement issue #10 (Reconnect) and open a PR.

READ FIRST, in this order, before writing any code:
1. docs/CHARTER.md — the five non-negotiable invariants. #2 (server-authoritative) and
   #3 (append-only, idempotent ledger — no double-pay on retry/reconnect) govern this task.
2. docs/WORKING_AGREEMENT.md — branching/PR rules and ownership boundaries.
3. docs/SLICE_RPS.md — acceptance criterion S8 is your gate; S5 (hidden info) constrains
   what redacted state may contain.
4. Issue #10 and the PM brief comment on it:
   gh issue view 10 --repo Ramunas01/rapidclash-demo --json title,body
   gh issue view 10 --repo Ramunas01/rapidclash-demo --comments
   (The PM brief narrows scope — read it carefully; don't rebuild what already exists.)
5. Existing code you will extend or verify:
   - apps/web/src/ws.ts and apps/web/src/App.tsx — client already auto-sends match.resume
     on a transient socket reconnect; verify it, don't rebuild it.
   - apps/server/src — locate the WS gateway / match-orchestration code that handles
     match.resume (added under #7); confirm its behavior against S8.
   - packages/games (RPS viewFor redaction) and packages/core (idempotent settlement
     keyed by match) — the no-double-payout guarantee lives here.

TASK — satisfy every S8 box in issue #10:
- Reconnect with a valid bearer token + match.resume { matchId } returns the CURRENT
  redacted viewFor state for that player; match continues correctly.
- If the match is already terminal, match.resume returns match.end with the
  already-settled outcome — NO second payout. match.resume is idempotent (safe any number
  of times).
- Automated tests (required): (a) disconnect one WS mid-move, reconnect, resume, assert
  state consistent + match completes; (b) terminal-resume returns match.end with NO
  duplicate ledger entries. Prove idempotency with a test, not by inspection.
- Client gap to close (found in #9 review): currentMatchId currently lives only in React
  state + the WsClient instance, so a full PAGE RELOAD mid-match loses it and auto-resume
  won't fire. Persist currentMatchId to session/localStorage on match.start, clear it on
  match.end, and on app mount reconnect with it if present.

RULES:
- Work on branch feature/10-reconnect off the latest main. DO NOT commit to main directly
  (main protection does not block admin pushes — opening a PR is a hard requirement, not a
  formality). Open a PR that says "closes #10" and lists which S8 boxes it satisfies.
- Charter guardrails: never let the client reconstruct or reveal hidden moves (#2);
  settlement stays atomic + idempotent (#3).
- Keep the PR to one concern (#10 only).

VERIFY before marking done (Node path on this machine):
  export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
  pnpm install && pnpm run build && pnpm run lint && pnpm run test
  Baseline is 115 tests green; your PR should add reconnect tests on top. Report the exact
  build/lint/test results in the PR — faithfully, including any failures.
```

### Agent B — Issue #11 (Demo runbook)

```
You are a Programmer on RapidClash, a human-vs-human gaming demo. GitHub repo:
Ramunas01/rapidclash-demo — the single source of truth. Your job this session: write the
demo runbook (issue #11) as docs/DEMO.md and open a PR.

READ FIRST, in this order:
1. docs/CHARTER.md — the experience the demo must show (8 steps) and the five invariants.
   Your runbook must demonstrate all of them with no step faked or skipped.
2. docs/WORKING_AGREEMENT.md — branching/PR rules.
3. docs/SLICE_RPS.md — the definition of done and the S1–S9 acceptance criteria. Your
   runbook ends with an S1–S9 checklist a person can tick off by hand.
4. docs/PM_REPORTS/2026-06-14-session-04-pwa-ratify-reconnect-brief.md — current state.
5. Issue #11:
   gh issue view 11 --repo Ramunas01/rapidclash-demo --json title,body
   gh issue view 11 --repo Ramunas01/rapidclash-demo --comments
6. The actual run surface, so your instructions are correct and tested, not guessed:
   - Root package.json + each workspace's package.json (scripts to build/start server+web).
   - apps/server/src — how the server starts, its port, env vars (e.g. JWT_SECRET),
     and whether it needs seeding (there is a pre-seeded admin account — see ADMIN docs).
   - apps/web — vite.config.ts (dev server, VITE_API_URL / VITE_WS_URL), how to run it.
   - The REST + WS endpoints the client calls (apps/web/src/api.ts, apps/web/src/ws.ts).

TASK — produce docs/DEMO.md covering:
- Prerequisites + one-time setup (install, env vars, Node version).
- How to start the server and TWO web clients locally (two browser profiles / two devices
  on the same LAN), so two humans can be matched. The platform never plays the house —
  the demo is genuinely two clients.
- A full walkthrough of the Charter's 8-step experience: register → wallet → pick RPS →
  stake → lobby/wait → match → win/lose/draw + settlement (pot − rake) → leaderboard moves.
- Optional admin tooling for demo prep (add-money to a wallet to exercise different stakes).
- A copy-pasteable S1–S9 checklist mapping each criterion to the exact action that proves it.
- Determinism (S9): how a developer replays a match from its seed + move list.

IMPORTANT — dependency on #10 (being built in parallel):
- The S8 (reconnect) section and the end-to-end S1–S9 sign-off depend on issue #10, which
  another agent is implementing right now. Write the S8 walkthrough against the #10 brief
  (gh issue view 10 --comments) and mark that section clearly as "verify once #10 merges".
  Do NOT claim S8 passes from your own run — the PM will confirm the full S1–S9 pass after
  #10 lands. Everything else (S1–S7, S9) you should actually run and confirm yourself.

RULES:
- Work on branch feature/11-demo-runbook off the latest main. DO NOT commit to main
  directly — open a PR that says "closes #11". One concern only (the runbook; do not change
  production code — if you find a bug, note it in the PR, don't fix it here).
- docs/ is sensitive ground (owned by Advisor via Owner). Keep this PR to docs/DEMO.md
  (plus a README pointer if helpful); flag anything that would change a spec instead of
  editing it.

VERIFY before marking done:
  export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
  pnpm install && pnpm run build && pnpm run lint && pnpm run test   (must stay green)
  Then actually follow your own runbook end-to-end for S1–S7 and S9, and fix any step that
  doesn't work as written. Report what you verified vs. what is pending #10 in the PR.
```

---

## Addendum (same session) — three Slice-1 blockers found; endgame revised

Programmer B delivered **PR #24** (`docs/DEMO.md`, closes #11) and, while writing it, surfaced
production bugs. I verified all three independently on `origin/main` (read-only — the #10 agent's
WIP was live in the shared checkout at the time; it has since been committed as **PR #28**):

| Blocker | Confirmed | Owner | Issue |
|---------|-----------|-------|-------|
| **B1** `/ws` registered before `@fastify/websocket` loads → every WS connection 500s | ✅ `server.ts:45` no `await` | **PR #28 (#10)** fixes it (nested-plugin + `gateway.test.ts`) | **#25** (critical) |
| **B2** no CORS / no Vite proxy → browser can't reach API on :3000 | ✅ | bugfix PR (below) | **#26** |
| **B3** `GET /wallet` + `GET /matches/:id` (PROTOCOL.md) unimplemented → 404 | ✅ `git grep` empty | bugfix PR (below) | **#27** |

**Why it matters:** the 115-test suite never booted the real HTTP/WS server, so B1 hid behind green
CI. **#9/#10/#11 merging does NOT make Slice 1 done** — the demo ("open the PWA and play") is
unreachable until #25/#26/#27 are fixed and S1–S9 re-verified against the running server.

**#9 record corrected:** my S1 review credited "wallet from GET /wallet" on the client calling the
right endpoint; the **server endpoint is missing** (#27). Client stays ratified; S1 is not green
until #27. (Correction posted on #9.)

### Owner decisions this session
- **#26 + #27** → one dedicated bugfix PR, **now, in parallel** with #10. Branch
  `feature/26-27-demo-reachability`; brief on #26 (agent prompt below).
- **#11 / PR #24** → **hold merge** until all blockers fixed and the runbook updated to describe a
  working demo. Merge #11 **last**.
- Branch protection stays **as-is** (admin bypass, 0 required reviews) — earlier decision unchanged.

### Open PRs right now
- **PR #28** — Reconnect (closes #10). Review against **S8** + confirm it fixes **B1/#25** with a
  real-server WS test. Merge **first**.
- **PR #24** — Demo runbook (closes #11). Honest, high quality; **hold** per above.
- Bugfix PR (#26/#27) — not yet opened; awaiting the agent.

### Merge order (revised endgame)
1. **PR #28 (#10)** → S8 + B1 fixed.
2. **Bugfix PR (#26/#27)** → resolve the expected trivial `server.ts` conflict with #28 at second merge.
3. **Re-verify S1–S9 end-to-end against the real server** (not just unit tests).
4. **Update + merge PR #24 (#11)** (drop the now-stale B1/B2 blocker notes; reconcile S8 section).
5. Only then **declare Slice 1 done** + final report. No second game until the Owner confirms S1–S9.

### Appendix B — handoff prompt: bugfix agent (#26 + #27)

```
You are a Programmer on RapidClash (Ramunas01/rapidclash-demo — single source of truth). Fix the
two demo-reachability blockers #26 and #27 in ONE bugfix PR. Branch feature/26-27-demo-reachability
off latest origin/main; open a PR that says "closes #26" and "closes #27". DO NOT commit to main.

Work in an ISOLATED git worktree off origin/main — other agents are live in the shared checkout
(git worktree add ../rc-fix origin/main). Expect a trivial apps/server/src/server.ts conflict with
PR #28 (#10), which also edits the route/WS registration block — keep your server.ts edit minimal
and localized; the PM resolves the conflict at merge.

READ FIRST: docs/CHARTER.md (invariants #2 server-authoritative, #3 ledger-derived balance),
docs/WORKING_AGREEMENT.md, docs/SLICE_RPS.md (S1), PROTOCOL.md and WALLET_LEDGER.md (endpoint
shapes + derived balance), issues #26 and #27 (gh issue view 26/27 --comments), and the existing
server route pattern: apps/server/src/server.ts + apps/server/src/routes/*.ts (mirror
leaderboard.ts / games.ts) + the ledger API in packages/core (derived balance) + apps/web
vite.config.ts and apps/web/src/api.ts/ws.ts (client defaults to same-origin).

TASK #26: add a Vite dev proxy in apps/web/vite.config.ts so the client stays same-origin — proxy
/auth /wallet /games /leaderboard /matches /admin and the /ws upgrade (ws: true) to
http://localhost:3000. Verify a browser on :5173 reaches the API.

TASK #27: implement GET /wallet (auth-gated; WalletResponse with balance DERIVED FROM THE LEDGER,
never a stored number — this is what makes S1 pass) and GET /matches/:id per PROTOCOL.md. Guardrail:
for an in-progress match, GET /matches/:id must honour viewFor redaction — never leak the opponent's
concealed move (#2 / S5). Register both via the existing registerXRoutes pattern; add route tests
mirroring admin.test.ts / games.test.ts.

VERIFY: export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH" && pnpm install &&
pnpm run build && pnpm run lint && pnpm run test (stay green + add tests). curl both new endpoints;
load the PWA at :5173 and confirm the Wallet screen now gets a real GET /wallet. Note: full browser
PLAY still needs B1/#28 — WS-dependent steps remain pending #28; say so in the PR.
```
