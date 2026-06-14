# Working Agreement

How three contributors — one human and three AI assistants — collaborate through this repository without colliding. GitHub is the single source of truth; if a decision is not in the repo, it did not happen.

## Roles

- **Advisor (Claude, chat).** Owns `docs/`. Writes and revises specs and ADRs. Does not write production code. Consulted on architecture and scope changes.
- **Project Manager (WSL AI agent).** Owns the roadmap and the issue tracker. Breaks specs into issues with acceptance criteria, sequences work, reviews PRs against the acceptance criteria, and keeps the board honest. Holds the review gate but not the merge button on direction-level changes.
- **Programmer (Claude Code, WSL).** Owns implementation under `packages/` and `apps/`. Works on feature branches, opens PRs that reference an issue, keeps PRs small and reviewable.
- **Owner (Ramunas).** Final say on direction and scope. Presses merge on anything that changes the charter, an ADR, or the contract. Resolves anything ambiguous.

## Branching & PRs

- `main` is protected. No direct pushes. It is always in a demoable state.
- Work happens on `feature/<issue-number>-<slug>` branches.
- Every PR references the issue it closes and states which acceptance criteria it satisfies.
- CI must pass (build + tests) before review.
- A PR touching `docs/`, `CODEOWNERS`, or the shared contract requires owner approval. Implementation-only PRs can merge on PM approval.
- One PR, one concern. A PR that changes the contract *and* implements a feature is split.

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
