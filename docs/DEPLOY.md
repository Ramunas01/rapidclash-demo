# Deploy — demo on Google Cloud Run

The runbook for putting RapidClash on a public HTTPS URL. Decisions are recorded in ADR-009. The result: one `*.run.app` URL that works from any phone, installs as a PWA (HTTPS is built in), and needs no tunnel.

**Shape:** one Cloud Run service runs the Node container, which serves the API, the WebSocket, **and** the built PWA on a single origin. No CORS, no second deployment.

---

## 0. Prerequisites

**Code (one-time, owned by the programmer):**
- The server already listens on `process.env.PORT` and binds `0.0.0.0` — Cloud Run injects `PORT=8080`, so this is done.
- The server must **serve the built PWA** (`apps/web/dist`) with SPA fallback, so the single container delivers both halves. (Tracked as a deploy-prep task — see the PM prompt.)
- A `Dockerfile` that builds the web client, builds the server, and runs the server. (Same task.)

**Account (one-time, owned by you):** a Google Cloud account with billing enabled — see "First-time GCP account" below if you've never set one up.

**Tooling (one-time, on your WSL box):** the `gcloud` CLI — see "Install gcloud" below.

---

## First-time GCP account (skip if you already have one)

1. Go to <https://console.cloud.google.com> and sign in with a Google account.
2. Accept the Free Trial when prompted — it grants **$300 in credit over 90 days** and unlocks the always-free tier. You must add a payment method (card) even for free usage; you are **not** charged unless you exceed the free limits *and* the credit, and never without explicitly upgrading to a paid account.
3. That's the whole activation. The credit and budget alert (step 4 below) are your safety net.

## Install gcloud (on WSL / Ubuntu)

Use the official installer and authenticate (browser auth on WSL needs the no-launch-browser flag, then paste the URL into your Windows browser):

```bash
# install (authoritative steps: https://cloud.google.com/sdk/docs/install)
curl https://sdk.cloud.google.com | bash
exec -l $SHELL                 # reload shell so `gcloud` is on PATH
gcloud auth login --no-launch-browser   # open the printed URL in your browser, paste the code back
```

---

## 1. One-time project setup

Run these once. Replace `rapidclash-demo` with your preferred project id if taken.

```bash
# Create (or select) a project
gcloud projects create rapidclash-demo --name="RapidClash Demo"
gcloud config set project rapidclash-demo
gcloud config set run/region us-central1      # free-tier-eligible region

# Link billing (find your billing account id with: gcloud billing accounts list)
gcloud billing projects link rapidclash-demo --billing-account=XXXXXX-XXXXXX-XXXXXX

# Enable the APIs a source-deploy needs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Store the admin password as a secret (the server reads ADMIN_PASSWORD)
printf 'choose-a-strong-password' | gcloud secrets create admin-password --data-file=-
```

## 2. Set a budget alert (do this before deploying)

Cloud platforms don't hard-stop spending by default, so this is non-negotiable. Easiest in the console: **Billing → Budgets & alerts → Create budget**, set a small monthly cap (e.g. €5–10) with email alerts at 50/90/100%. This won't cut off service; it emails you long before anything matters, which for a demo on the free tier is all you need.

## 3. Deploy

One command builds the container from the repo and deploys it:

```bash
gcloud run deploy rapidclash \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout 3600 \
  --min-instances 1 \
  --max-instances 1 \
  --session-affinity \
  --set-secrets ADMIN_PASSWORD=admin-password:latest
```

Flag rationale (see ADR-009):
- `--source .` — Cloud Build builds the image from your `Dockerfile`; no manual registry steps.
- `--allow-unauthenticated` — it's a public demo; players don't need Google accounts.
- `--timeout 3600` — the 60-minute max for the WebSocket stream; `match.resume` handles reconnect on timeout.
- `--max-instances 1` — **mandatory**: match state is in memory and the DB is a local file; neither survives scale-out.
- `--min-instances 1` — keeps a WebSocket-warm instance during demos (a few $/month). Set `0` when not demoing to drop to free (cold starts may delay/drop the first connection).
- `--session-affinity` — best-effort routing of reconnects back to the same instance.

Cloud Run prints the HTTPS URL (`https://rapidclash-…-uc.a.run.app`) on success.

## 4. Verify

Open the printed URL on your phone over cellular (not just Wi-Fi — proving it's truly public). Register two players (two browser profiles, or phone + laptop), play a match end to end, and confirm the PWA "Add to Home Screen" prompt appears — that only works because the URL is HTTPS, which is exactly what the tunnel was patching.

## 5. Operating notes

- **Reset for testing** = redeploy or recycle the instance; SQLite is ephemeral, so data clears on its own (this is the accepted reset story — see `ADMIN.md`). The admin account re-seeds on startup via `ensureAdmin`, so a reset never locks you out.
- **Cost control** = `--min-instances 0` between demos; the budget alert is your backstop.
- **When to graduate:** the moment you want data to persist across restarts, or more than one instance, switch to Cloud SQL (Postgres, ~$10–15/month to keep running) for the ledger/history and Redis (Memorystore) for live session/matchmaking state, then raise `--max-instances`. That's the ADR-005 scale shape — not needed for the demo.

## 6. Later: CI/CD

Once manual deploys feel routine, a GitHub Actions workflow can run the same `gcloud run deploy --source .` on merge to `main` (authenticating via Workload Identity Federation), so shipping the demo becomes automatic. Defer until the manual path is understood.
