# PM Report — 2026-06-15 — Deployment milestone: RapidClash is LIVE

RapidClash is deployed to a public HTTPS URL and verified end to end. Both slices plus the
single-origin deploy are shipped.

**Live URL:** `https://rapidclash-847070222251.us-central1.run.app`
**Admin login:** `admin` / (password in Secret Manager `admin-password`, relayed to the owner — not stored here).

## What's live
- **Slice 1** — register, ledger wallet, FIFO matchmaking, two-player RPS, settlement (pot − rake), leaderboard, reconnect, determinism.
- **Slice 2** — Coinflip (seeded flip, hidden until terminal), generic `net_winnings` leaderboard, the open-challenges lobby (atomic claim, 90s TTL), active-game leaderboard.
- **Single-origin container** — one Cloud Run service serves API + WebSocket + the built PWA (ADR-009); HTTPS ⇒ PWA-installable, no tunnel.

## Verified on the real URL (PM smoke)
`GET /` → 200 (PWA) · `GET /games` → RPS + Coinflip · register → balance 1000 · **`wss://…/ws` → `queue.join` → `queue.waiting`** (matchmaking + 90s TTL alive) · SPA route `/lobby` → 200 (app shell) · `sw.js` → 200 `application/javascript` (installable) · unknown API → JSON 404. The Dockerfile built via Cloud Build (the real container test) and serves everything on one origin.

## Deploy environment
- Project `project-a0d71bfe-e59e-4c88-ad7` ("Rapidclash"), region `us-central1`, billing linked, budget alert set.
- `--min-instances 1 --max-instances 1` (mandatory — in-memory match state + local SQLite), `--session-affinity`, `--timeout 3600`, `--allow-unauthenticated`, `ADMIN_PASSWORD` via Secret Manager.

## Two first-deploy gotchas (now baked into DEPLOY.md via PR #52)
1. **`gcloud run deploy --source .` 403 before building** — newer Cloud Build runs source builds as the **default compute SA**, which lacked the roles. Fixed by granting it `roles/cloudbuild.builds.builder` (project) + `secretmanager.secretAccessor` (the secret).
2. **Container build (step 0) failed silently** — the Dockerfile uses `corepack` but `package.json` had no `packageManager` field → wrong pnpm major. Fixed by pinning `"packageManager": "pnpm@9.15.9"` (commit `5fe5402`). Regional Cloud Build logs weren't retrievable via CLI; diagnosed by inspection.

## How to deploy / operate (read `docs/DEPLOY.md` — hardened in PR #52)
- **Redeploy** (after merging to `main`): the §3 `gcloud run deploy rapidclash --source . …` command.
- **Cost control between demos:** `gcloud run services update rapidclash --min-instances 0 --region us-central1` (free; cold start on first connect). Back to warm: `--min-instances 1`.
- **Reset:** redeploy/recycle — SQLite is ephemeral; admin re-seeds via `ensureAdmin`.

## State of the board
- ✅ Slice 1 (signed off), ✅ Slice 2 (feature-complete), ✅ deployed live.
- **Open (polish, non-blocking):** PR #52 (deploy-runbook hardening, owner-merge); UX/robustness backlog — #33 stake input, #34 own-alias (needs `AuthResponse` username), #30 idle WS reconnect, #31 turn-timeout / orphaned escrow.

## Recommended next steps
1. Merge **PR #52** (your followable deploy runbook).
2. Drop `--min-instances 0` if not actively demoing (saves the monthly cost).
3. Optional polish sprint: #33/#34 (visible UX wins) then #30/#31 (unhappy-path robustness). #34's username also rounds out the alias display the open-challenges/leaderboard work started.
4. Optional later: CI/CD auto-deploy on merge to `main` (DEPLOY.md §6) — deferred until manual deploys feel routine.
