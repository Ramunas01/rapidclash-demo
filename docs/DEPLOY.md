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

# Grant the build/runtime service account the roles a --source deploy needs.
# Newer Cloud Build runs source builds AS the default compute SA, which by default
# lacks both the build roles and read access to the secret. Without these the first
# deploy fails (storage.objects.get 403 / secret access denied).
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$(gcloud config get-value project)" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/cloudbuild.builds.builder" --condition=None
gcloud secrets add-iam-policy-binding admin-password \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

### 1b. Durable persistence bucket (ADR-011)

SQLite on Cloud Run is ephemeral — it resets on every instance recycle/redeploy (ADR-009). To keep accounts, hashed credentials, and standings across recycles, the server snapshots the DB file to a Cloud Storage bucket and restores it on startup (ADR-011). This is opt-in: it activates only when `GCS_BUCKET` is set (below), so local dev is unchanged. Create the bucket once and grant the Cloud Run service account object read/write on it:

```bash
# Create the snapshot bucket (same region as the service; pick a globally-unique name).
gsutil mb -l us-central1 gs://rapidclash-demo-snapshots

# The Cloud Run service runs as the default compute SA (same one that builds — see §1).
# Grant it object admin on the bucket so the server can download (restore) and upload (snapshot).
gcloud storage buckets add-iam-policy-binding gs://rapidclash-demo-snapshots \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/storage.objectAdmin"
```

No service-account key file is needed: inside Cloud Run the server authenticates via Application Default Credentials automatically. The bucket holds a single object (`rapidclash.db`), overwritten on each debounced snapshot — no versioning required. (For a true clean slate / hard reset, delete that object: `gsutil rm gs://rapidclash-demo-snapshots/rapidclash.db`, then redeploy.)

## 2. Set a budget alert (do this before deploying)

Cloud platforms don't hard-stop spending by default, so this is non-negotiable. Easiest in the console: **Billing → Budgets & alerts → Create budget**, set a small monthly cap (e.g. €5–10) with email alerts at 50/90/100%. This won't cut off service; it emails you long before anything matters, which for a demo on the free tier is all you need.

## 3. Deploy

**Run this from the repo root** (`cd` into the cloned `rapidclash-demo` directory first) — `--source .`
uploads the *current* directory, so gcloud only finds the `Dockerfile` when you're at the repo root.
Confirm with `ls Dockerfile` first. The first build line should read **`Building using Dockerfile`**; if it
says **`Building using Buildpacks`**, you're in the wrong directory — the Dockerfile wasn't found.

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
  --set-secrets ADMIN_PASSWORD=admin-password:latest \
  --set-env-vars GCS_BUCKET=rapidclash-demo-snapshots
```

Flag rationale (see ADR-009):
- `--source .` — Cloud Build builds the image from your `Dockerfile`; no manual registry steps.
- `--allow-unauthenticated` — it's a public demo; players don't need Google accounts.
- `--timeout 3600` — the 60-minute max for the WebSocket stream; `match.resume` handles reconnect on timeout.
- `--max-instances 1` — **mandatory**: match state is in memory and the DB is a local file; neither survives scale-out (also makes the snapshot a single writer — no locking concern, ADR-011).
- `--min-instances 1` — keeps a WebSocket-warm instance during demos (a few $/month). Set `0` when not demoing to drop to free (cold starts may delay/drop the first connection).
- `--session-affinity` — best-effort routing of reconnects back to the same instance.
- `--set-env-vars GCS_BUCKET=…` — enables durable persistence (ADR-011): the server restores the DB snapshot on startup and snapshots it back after each settlement. Omit it (or drop the bucket) to fall back to the original ephemeral behaviour. Requires the bucket + IAM grant from §1b.

Cloud Run prints the HTTPS URL (`https://rapidclash-…-uc.a.run.app`) on success.

## 4. Verify

Open the printed URL on your phone over cellular (not just Wi-Fi — proving it's truly public). Register two players (two browser profiles, or phone + laptop), play a match end to end, and confirm the PWA "Add to Home Screen" prompt appears — that only works because the URL is HTTPS, which is exactly what the tunnel was patching.

## 5. Operating notes

- **Reset for testing** = redeploy or recycle the instance. *Without* `GCS_BUCKET`, SQLite is ephemeral, so data clears on its own. *With* `GCS_BUCKET` set (ADR-011), the snapshot now survives recycles — to force a clean slate (hard reset), delete the snapshot object before/while redeploying: `gsutil rm gs://<bucket>/rapidclash.db`. The admin account re-seeds on startup via `ensureAdmin`, so a reset never locks you out.
- **Cost control** = `--min-instances 0` between demos; the budget alert is your backstop.
- **When to graduate:** the GCS snapshot (ADR-011) keeps demo data across restarts on a single instance, but it does **not** unlock scale-out — the moment you want more than one instance (concurrent writers), switch to Cloud SQL (Postgres, ~$10–15/month to keep running) for the ledger/history and Redis (Memorystore) for live session/matchmaking state, then raise `--max-instances`. That's the ADR-005 scale shape — not needed for the demo.

## 5b. Troubleshooting the first deploy

Two errors hit on the very first `--source` deploy (both one-time; §1 and the repo now handle them):

- **`...-compute@developer.gserviceaccount.com does not have storage.objects.get access ... forbidden`** (deploy never reaches the build) — the default compute service account lacks the build roles. Fixed by the IAM grants in §1 (`roles/cloudbuild.builds.builder` on the project, `secretmanager.secretAccessor` on the secret). Newer Cloud Build runs `--source` builds **as the compute SA**, not the legacy `@cloudbuild` SA.
- **`Build failed; check build logs` at build step 0 (the Docker build), with no app-level error** — the `Dockerfile` uses `corepack`, so the container needs the pnpm version pinned. The repo sets `"packageManager": "pnpm@9.15.9"` in the root `package.json`; **keep that field in sync with the lockfile's pnpm** or the container grabs a mismatched pnpm major and the build dies silently.
- **Reading regional build logs:** `gcloud builds log <BUILD_ID> --region us-central1`, or open the console build URL printed on failure (the CLI log fetch is sometimes empty for regional builds).

A failed build is harmless and recoverable — fix and re-run the same `gcloud run deploy` command.

## 6. Later: CI/CD

Once manual deploys feel routine, a GitHub Actions workflow can run the same `gcloud run deploy --source .` on merge to `main` (authenticating via Workload Identity Federation), so shipping the demo becomes automatic. Defer until the manual path is understood.
