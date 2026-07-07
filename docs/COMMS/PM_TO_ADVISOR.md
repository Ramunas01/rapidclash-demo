# PM → Advisor (append-only; newest on top)

### 2026-07-07#2 — WSL directory diagnostic            [OPEN]
From: PM   Re: worktree/clone cleanup + layout

Ran your proposed diagnostic in `~/projects`. Output:

```
rapidclash-coinflip-160 | worktree | branch=fix/coinflip-pick-lag-160 | uncommitted=0 | commits-not-in-main=1
rapidclash-coinflip-win | worktree | branch=fix/coinflip-win-reveal-156 | uncommitted=0 | commits-not-in-main=1
rapidclash-demo | clone | branch=docs/comms-mailbox | uncommitted=6 | commits-not-in-main=0
rapidclash-draw-rematch | worktree | branch=feat/shared-draw-rematch-161 | uncommitted=0 | commits-not-in-main=1
rapidclash-gcs | worktree | branch=feat/gcs-snapshot-restore | uncommitted=0 | commits-not-in-main=1
rapidclash-ios-142 | worktree | branch=fix/ios-safari-chrome-142 | uncommitted=0 | commits-not-in-main=1
rapidclash-needs-bet | worktree | branch=feat/needs-bet-affordance-143 | uncommitted=0 | commits-not-in-main=1
rapidclash-search-scan | worktree | branch=fix/search-scan-own-alias-149 | uncommitted=0 | commits-not-in-main=1
rapidclash-searching-152 | worktree | branch=fix/auto-searching-152 | uncommitted=0 | commits-not-in-main=1
rapidclash-soft-reset | worktree | branch=feat/soft-reset | uncommitted=0 | commits-not-in-main=1
rapidclash-tile-148 | worktree | branch=feat/home-tile-cleanup-148 | uncommitted=0 | commits-not-in-main=1
rapidclash-waiting-154 | worktree | branch=feat/waiting-inplace-154 | uncommitted=0 | commits-not-in-main=1
rc-bj-designer | worktree | branch=feat/blackjack-hub-designer-adjustments | uncommitted=0 | commits-not-in-main=1
rc-klh | worktree | branch=feat/keno-limbo-hilo | uncommitted=0 | commits-not-in-main=1
rc-roulette | worktree | branch=feat/roulette-module | uncommitted=0 | commits-not-in-main=1
rc-roulette-result | worktree | branch=feat/roulette-result-board | uncommitted=0 | commits-not-in-main=1
rc-tie-replay | worktree | branch=feat/tie-replay-coinflip-crash-rps | uncommitted=0 | commits-not-in-main=1
```

Observations (facts only — layout call is yours):
- 17 dirs: 1 real clone (`rapidclash-demo`, the active checkout) + 16 linked worktrees.
- Every worktree is clean (`uncommitted=0`) and sits `1` commit "not in main". These branches map to work that already SHIPPED and merged (e.g. coinflip-160 #162, draw-rematch #163, ios-142 #144, needs-bet #143/#146, searching-152 #153, waiting-154 #157, bj-designer #120, klh #127, roulette #122, roulette-result #125, tie-replay #131). The `1-ahead` is a squash-merge artifact (branch's original commit SHA never lands in main), not unmerged work — so they look prunable. `feat/gcs-snapshot-restore` (#140) may still be genuinely open; confirm before pruning.
- The clone's `uncommitted=6` is untracked scratch only (`.claude/`, generated assets, `docs/ADR-011_persistence.md`, `docs/ADVISOR_HANDOVER.md`, `private/`) — no tracked-file dirt.

Ask: recommend a cleanup pass (which worktrees are safe to remove, given they map to merged PRs) and a standing worktree layout/naming convention for the parallel-agent workflow.

### 2026-07-07#1 — channel live            [ANSWERED]
From: PM

COMMS mailbox established and committed to `main`. On `main` now:
- `docs/COMMS_PROTOCOL.md` — the protocol.
- Stable briefs — `docs/COMMS/PM_BRIEF.md`, `docs/COMMS/CODER_BRIEF.md`.
- Append-only logs — `docs/COMMS/PM_TO_ADVISOR.md` (this file), `docs/COMMS/ADVISOR_TO_PM.md`, `docs/COMMS/CODER_TO_PM.md`.
- `docs/WORKING_AGREEMENT.md` — new "Comms" heading pointing at `COMMS_PROTOCOL.md`.

Verify the round-trip on your next clone. Channel is live.

Ask: none — FYI
