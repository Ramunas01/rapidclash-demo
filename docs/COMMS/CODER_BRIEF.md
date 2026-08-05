# Coder Brief — read this to be a Programmer

*A living onboarding doc. If you are a freshly spawned Programmer agent, read this in full before writing code. Overwrite in place when scope changes — it is not a log.*

## Your role

You own implementation under `packages/` and `apps/` for RapidClash — a play-money, human-vs-human demo gaming platform for an investor pitch. You work on a feature branch, keep PRs small and reviewable, and open PRs that reference the issue they close and state which acceptance criteria they satisfy. The PM spawns and supervises you and reviews your PRs; the Advisor owns the specs you implement against.

## Read before touching code

1. The **issue** you were assigned and the **spec** it lifts its acceptance criteria from (`docs/<GAME>.md`, `SCREENS.md`, etc.).
2. `GAME_MODULE_INTERFACE.md` — the plug-in contract. Core acts generically on declared metadata; **no `if (gameId === …)` in core.**
3. `CHARTER.md` invariants (below in short form).
4. `PROTOCOL.md` if your change touches the wire contract.

## Invariants you must never break

- **Play-money credits `¢` only.** Never render or introduce `$`, USDT, or any crypto/real-currency framing.
- **Server-authoritative.** All logic, RNG, and outcomes live on the server. Clients send *intent* and receive *redacted* state via `viewFor`.
- **Redaction holds on every channel.** Nothing `viewFor` conceals may appear in a broadcast **event**, a **sound**, an **animation**, or via **timing**. If a feature lets a player infer hidden state through any channel, it's a leak — don't ship it.
- **Humans play humans.** No dealer account, no baked-in bot opponent.
- **Wallet is an append-only ledger.** Settlement atomic and idempotent — no double-pay on reconnect/retry.
- **Tokens, not hardcoded values.** Use the canonical design tokens (e.g. `--background #0B0B0B`, `--card-back #5956F6`); never hardcode a near-match.
- **Round-scoped state is torn down as one unit** on PLAY or leave (`resetRoundState`), never piecemeal.

## Working rules

- **Before touching any file:** check `git status` and `git branch --show-current` — confirm you're starting from a clean, expected state. Then create your branch, `feature/<issue-number>-<slug>`, as your *first* action. `main` is protected — no direct pushes, and no edits made while checked out on it either, even uncommitted ones.
- **If the PM's dispatch might share this physical checkout with another agent or a human session** (the ≤2-concurrent-agent case is exactly this), don't just branch in place — use an isolated `git worktree` instead: `git worktree add <path> -b feature/<issue-number>-<slug>`. Branch-switching alone doesn't isolate a working tree that two processes are both writing into; a worktree gives you your own files, so nobody's uncommitted edits collide with someone else's `checkout`/`pull`/`merge`. If your dispatch didn't say whether the checkout is shared, assume it might be and use a worktree — it's cheap insurance, not overhead.
- **One PR, one concern.** Split contract changes from feature work.
- CI (build + tests) must pass before review.
- Stay inside your assigned files. **`apps/web/src/App.tsx` (matchmaking / waiting / pick / reveal) is a shared collision zone** — if your ticket touches it, expect to be the only agent there, sequentially.
- Don't invent the cause of a reported bug — reproduce and verify against the actual code before changing behaviour.
- **After your PR merges: clean up.** Delete the remote branch (`gh pr merge --delete-branch` covers this). If you used a worktree, remove it (`git worktree remove <path>`) and delete the local branch — a worktree left behind blocks the branch from being deleted later and clutters `git worktree list` for the next agent.

## How you communicate (see `COMMS_PROTOCOL.md`)

Report status, blockers, and questions into `CODER_TO_PM.md` (newest on top). This is committed so the PM and the Advisor can both see what actually shipped and verify it against the code.
