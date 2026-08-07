# Reserved "Demo" takers — VM setup (plan-B)

A tiny always-available Google Cloud VM that runs the gated `bot-crowd` (3 takers: coinflip / blackjack / chess, answering only the **`Demo`** account at 1¢). Set it up **once**; then for each demo you just **start the VM** (the bots auto-launch on boot) and **stop it** afterwards — so it's off-duty and costs almost nothing the rest of the time.

Prereqs: the `bot-crowd` gating change (ADVISOR_TO_PM 2026-07-11#5) is merged; you have the server admin password; and a way to pull the **private** repo onto the VM (a GitHub read-only token — see Step 4). Project: **`rapidclash-demotaker`**.

Everything below is copy-paste. If a step wedges, hand the PM this doc and the exact error.

---

## 1. Point gcloud at the new project and create the VM

Run locally (where your `gcloud` is set up), or in the project's **Cloud Shell** (the `>_` icon top-right in the console — no local setup needed):

```bash
gcloud config set project rapidclash-demotaker

gcloud compute instances create demo-taker \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=10GB
```

Notes:
- `e2-micro` in `us-central1` / `us-west1` / `us-east1` is in the free tier. We'll keep it **stopped** between demos anyway, so cost is just the 10 GB disk (a few cents/month).
- The bots only make **outbound** connections (they're clients), so **no firewall / open ports** are needed — leave ingress closed.
- If it complains the Compute API isn't enabled, run `gcloud services enable compute.googleapis.com` and retry.

## 2. Connect to the VM

```bash
gcloud compute ssh demo-taker --zone=us-central1-a
```

(Or click **SSH** next to the instance in the console — a browser terminal, handy if you're not at your own machine.)

Everything from here runs **inside the VM**.

## 3. Install Node 20 + pnpm + git

```bash
sudo apt-get update
sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
node -v && corepack prepare pnpm@latest --activate && pnpm -v
```

## 4. Get the repo (it's private) and install

Create a **fine-grained, read-only GitHub token** (github.com → Settings → Developer settings → Personal access tokens → Fine-grained → repo `rapidclash-demo`, Contents: Read-only). Then:

```bash
cd ~
git clone https://<YOUR_TOKEN>@github.com/Ramunas01/rapidclash-demo.git
cd rapidclash-demo
pnpm install
# build the shared types the bot imports (safe even if already built)
pnpm --filter @rapidclash/shared run build
```

Then delete the token from your shell history if you like: `history -c`. (The clone keeps working; the token was only needed to fetch.)

## 5. Create the config file (kept private)

Put the demo config in an env file readable only by you — **do not** bake the admin password into the service file:

```bash
sudo tee /etc/demo-taker.env >/dev/null <<'ENV'
SERVER_URL=https://rapidclash-847070222251.us-central1.run.app
ADMIN_PASSWORD=REPLACE_WITH_SERVER_ADMIN_PASSWORD
TAKER_ONLY_GAMES=coinflip,blackjack,chess
TAKER_ALLOW_NAMES=Demo
TAKER_STAKE=1
ENV
sudo nano /etc/demo-taker.env      # replace the admin password line, save (Ctrl-O, Enter, Ctrl-X)
sudo chmod 600 /etc/demo-taker.env
```

(If you'd rather not use the admin password at all, delete that line — the bots still run on their signup grant; top-ups just turn off.)

## 6. Run it as a service (auto-starts on boot, restarts on crash)

Find your pnpm path and username, then write the service:

```bash
echo "user=$(whoami)  home=$HOME  pnpm=$(command -v pnpm)"
```

```bash
sudo tee /etc/systemd/system/demo-taker.service >/dev/null <<UNIT
[Unit]
Description=RapidClash reserved demo takers (plan-B)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$HOME/rapidclash-demo
EnvironmentFile=/etc/demo-taker.env
ExecStart=$(command -v pnpm) --filter @rapidclash/bot-crowd start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable demo-taker      # start automatically whenever the VM boots
sudo systemctl start demo-taker       # start it now
```

## 7. Verify

```bash
journalctl -u demo-taker -f
```

You should see the three bots register/log in and `All bots online`. Leave that running and, on your phone/laptop: log into the **`Demo`** account (exact spelling), open **Coinflip**, set **1¢**, press **PLAY** — within ~1s a `🤖coinflip-taker` should claim it and the match should settle. Try blackjack and chess too. Press Ctrl-C to leave the log view (the service keeps running).

## 8. Day-to-day: start before a demo, stop after

The VM does **not** need to run between demos. Keep it stopped (off-duty, no idle bots on the live lobby, ~no cost). When a demo needs plan-B:

```bash
gcloud compute instances start demo-taker --zone=us-central1-a     # ~30s; bots auto-launch on boot
# … run the demo …
gcloud compute instances stop  demo-taker --zone=us-central1-a
```

(Both are one-click in the console too — the ⋮ menu on the instance → Start / Stop.) Because the service is `enable`d, a fresh boot brings the takers online on its own; nobody needs to SSH in during the demo.

---

## Troubleshooting

- **Bots start but never take the `Demo` challenge.** Check the account name is exactly `Demo` (case-sensitive) and matches `TAKER_ALLOW_NAMES`; that the bet is **1¢** (matches `TAKER_STAKE=1`); and that you **posted** (pressed PLAY) rather than joined. `journalctl -u demo-taker -e` shows what it sees.
- **`socket closed` / can't connect.** Confirm `SERVER_URL` is the live `https://…run.app` (the WS URL is derived as `wss://…/ws`). The VM needs outbound internet — default on GCE.
- **`admin login failed`.** Wrong/empty `ADMIN_PASSWORD` — harmless: top-ups just disable, bots run on their grant. Fix the env file and `sudo systemctl restart demo-taker` if you want top-ups.
- **Change the config later.** Edit `/etc/demo-taker.env`, then `sudo systemctl restart demo-taker`.
- **Update the code later.** `cd ~/rapidclash-demo && git pull && pnpm install && pnpm --filter @rapidclash/shared run build && sudo systemctl restart demo-taker`.
- **Tear it all down.** `gcloud compute instances delete demo-taker --zone=us-central1-a`.
