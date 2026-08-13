# Working Agreement

How three contributors — one human and three AI assistants — collaborate through this repository without colliding. GitHub is the single source of truth; if a decision is not in the repo, it did not happen.

## Roles

- **Advisor (Claude — chat or Claude Code; see "Advisor access model" below).** Owns `docs/`. Writes and revises specs and ADRs. Does not write production code. Consulted on architecture and scope changes.
- **Project Manager (WSL AI agent).** Owns the roadmap and the issue tracker. Breaks specs into issues with acceptance criteria, sequences work, reviews PRs against the acceptance criteria, and keeps the board honest. Holds the review gate but not the merge button on direction-level changes.
- **Programmer (Claude Code, WSL).** Owns implementation under `packages/` and `apps/`. Works on feature branches, opens PRs that reference an issue, keeps PRs small and reviewable.
- **Owner (Ramunas).** Final say on direction and scope. Presses merge on anything that changes the charter, an ADR, or the contract. Resolves anything ambiguous.

## Advisor access model

The Advisor role has one boundary (`docs/` only, no production code) but can run on either of two front-ends — check which one you are before assuming a mechanic, since they differ in what they can physically do:

- **Web-chat Claude (no filesystem tool).** Reads the repo via `git clone --depth 1` (needs the repo public, or a fresh export). Cannot write to the working copy or push — produces edited files as chat outputs for the owner/PM to apply and commit. This is the mechanics `ADVISOR_HANDOVER.md` §3 was written for; treat that section as this front-end's manual, not a universal description of "the Advisor."
- **Claude Code running locally (e.g. this CLI on the owner's machine, reaching the repo over a WSL filesystem mount).** Reads and writes the working copy directly — including a private repo — and can run `git` itself: create a branch, commit, and push. The role boundary doesn't change just because the tooling got stronger: still `docs/` only, and a docs-touching branch is **pushed for review, never merged to `main` by the Advisor** (owner approval + merge, per "Branching & PRs" above). Branch before editing, same as any other contributor — don't accumulate uncommitted edits on `main`.

Practical note for the Claude Code front-end (first exercised 2026-08-13, on the welcome-email copy fix in the sibling `rapidclash-landing` repo): if `git` reports **"detected dubious ownership"** on a repo reached through a UNC-style WSL mount (`\\wsl.localhost\...`) from a Windows-side session, don't add a `safe.directory` exception from that side — run git through `wsl.exe -e bash -lc "cd ~/projects/<repo> && git ..."` instead. That executes as the WSL-native user, matches the checkout's real ownership, and sidesteps the mismatch entirely.

## Branching & PRs

- `main` is protected. No direct pushes. It is always in a demoable state.
- Work happens on `feature/<issue-number>-<slug>` branches.
- **Branch before you edit, not after.** Create the feature branch as your first action, before touching any file. Never make changes while checked out on `main` — a shared checkout with uncommitted changes on `main` is a collision waiting to happen for the next `git checkout`/`pull`/`merge` anyone runs there (this has bitten the project twice: an accidental fast-forward push in a stale-branch PM session, and a Programmer editing directly on `main` in a shared WSL checkout).
- **Isolate the working directory when a checkout might be shared.** If more than one agent could touch the same physical clone (the ≤2-concurrent-agent case, or a human and an agent sharing one WSL checkout), each agent works in its own `git worktree` (`git worktree add <path> -b feature/<issue>-<slug>`), not a branch-switch in a shared directory — branching alone doesn't isolate a working tree two processes are both writing into. Before your first commit, sanity-check `git status` and `git branch --show-current` actually show what you expect.
- Every PR references the issue it closes and states which acceptance criteria it satisfies.
- CI must pass (build + tests) before review.
- A PR touching `docs/`, `CODEOWNERS`, or the shared contract requires owner approval. Implementation-only PRs can merge on PM approval.
- One PR, one concern. A PR that changes the contract *and* implements a feature is split.
- **Clean up after merge.** Delete the remote branch on merge (`gh pr merge --delete-branch` or equivalent). If you worked in a `git worktree`, remove it (`git worktree remove <path>`) and delete the local branch — a leftover worktree keeps the branch un-deletable and clutters the next agent's `git worktree list`.

## Issues

- Every unit of work is an issue with a clear "done when…" list lifted from the relevant spec.
- Labels: `slice-1`, `core`, `game`, `client`, `infra`, `spec`, `blocked`, `needs-owner`.
- An issue blocked on a decision gets `needs-owner` and names the exact question. Decisions are not made implicitly in code.

## Ownership boundaries (enforced by CODEOWNERS)

| Path | Primary owner |
|------|---------------|
| `docs/**` | Advisor (via owner) |
| `packages/core/**`, `packages/games/**`, `packages/shared/**`, `apps/**` | Programmer |
| roadmap, issues, project board | PM |
| `CODEOWNERS`, charter, ADRs | Owner |

These boundaries exist so two agents do not edit the same surface in conflicting ways. Cross-boundary changes go through a PR and the owning role's review.

## Changing a decision

The charter, the ADR log, and the game contract are deliberately rigid. Changing one is a normal PR to the relevant doc, labelled `spec`, reviewed by the Advisor and approved by the Owner. This keeps the foundation stable while still letting it evolve — the slice exists partly to surface decisions worth revising.

## A note on AI contributors and attribution

The AI agents act through Git identities configured on the WSL machine; CODEOWNERS entries point at the human owner as the accountable reviewer, since GitHub's review gate ultimately rests on accounts the owner controls. Treat CODEOWNERS as "who must approve," not "who typed it." Commit messages should still attribute the agent that produced the work for traceability.

## Guest mode: the two-repo rule

Guest mode spans two repositories — `rapidclash-demo` (this repo) and `rapidclash-landing` (the marketing/landing site that embeds it). The boundary is the versioned `GUEST_MODE_CONTRACT.md`:

- **`rapidclash-demo` owns all game behaviour** — the guest session type, the Demo-Opponent, ephemeral credits, curated surface, chrome flags, and the embeddability of the entry point.
- **`rapidclash-landing` may only configure and frame it** — the embedding shell, surrounding marketing/CTA, and the contract's config params. It never modifies game logic or styling.
- The moment the landing repo reaches into game logic, the fork this rule exists to prevent has begun. Contract changes are announced at the seam, not made in shared source.

## Comms
Async non-code coordination uses the repo mailbox and role briefs — see COMMS_PROTOCOL.md.
