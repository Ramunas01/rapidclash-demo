# Gated demo-taker VM setup (plan-B)

A small, **always-on** Google Cloud VM that runs `tools/bot-crowd` in its **gated** mode: for each curated game it stands up one allowlist-gated **taker** plus a **weighted resting pool** (`gameId:N` in `TAKER_ONLY_GAMES`, issue #393 — `N` resters per game, default 1 if omitted), currently 32 bots across all 12 non-Ships-Battle games. Any self-registered account whose name starts with `Demo` (e.g. `DemoAcme`, `DemoGM`) gets a near-instant, honestly-labelled `🤖` opponent at almost any stake, any time of day — no VM start/stop, no Owner action needed once it's running. Project: **`rapidclash-demotaker`**.

**Standing policy (confirmed with the Owner): leave this VM running always. Do not stop it between demos.** It replaced the old start-before/stop-after plan-B — see §8.

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
- `e2-micro` in `us-central1` / `us-west1` / `us-east1` is in the free tier — negligible cost running continuously.
- The bots only make **outbound** connections (they're clients), so **no firewall / open ports** are needed — leave ingress closed.
- If it complains the Compute API isn't enabled, run `gcloud services enable compute.googleapis.com` and retry.

## 2. Connect to the VM

```bash
gcloud compute ssh demo-taker --zone=us-central1-a --ssh-key-file ~/.ssh/demo_taker_wsl
```

From WSL, pass `--ssh-key-file ~/.ssh/demo_taker_wsl` explicitly — the default key doesn't match what's registered for this instance. (Or click **SSH** next to the instance in the console — a browser terminal, no key needed.)

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

## 4. Get the repo (it's private) via a read-only deploy key

Use a **dedicated, read-only GitHub deploy key** — not an embedded PAT in the remote URL (a PAT in the URL sits in shell history/`.git/config` in plaintext and needs manual rotation; a deploy key doesn't).

On the VM, generate a key and print the public half:
```bash
ssh-keygen -t ed25519 -C "rapidclash-demotaker" -f ~/.ssh/rapidclash_deploy -N ""
cat ~/.ssh/rapidclash_deploy.pub
```
Add it on GitHub: repo → **Settings → Deploy keys → Add deploy key** — paste the printed key, leave **"Allow write access" unchecked** (read-only). Then, on the VM:
```bash
cat >> ~/.ssh/config <<'CFG'
Host github.com
  IdentityFile ~/.ssh/rapidclash_deploy
  IdentitiesOnly yes
CFG
cd ~
git clone git@github.com:Ramunas01/rapidclash-demo.git
cd rapidclash-demo
pnpm install
# build the shared types the bot imports (safe even if already built)
pnpm --filter @rapidclash/shared run build
```

## 5. Create the config file (kept private)

Put the demo config in an env file readable only by you — **do not** bake the admin password into the service file:

```bash
sudo tee /etc/demo-taker.env >/dev/null <<'ENV'
SERVER_URL=https://rapidclash-847070222251.us-central1.run.app
ADMIN_PASSWORD=REPLACE_WITH_SERVER_ADMIN_PASSWORD
TAKER_ONLY_GAMES=coinflip:3,blackjack:3,chess:3,rps:3,mines,crash,roulette,dice,baccarat,keno,limbo,hilo
TAKER_ALLOW_PREFIX=Demo
ENV
sudo nano /etc/demo-taker.env      # replace the admin password line, save (Ctrl-O, Enter, Ctrl-X)
sudo chmod 600 /etc/demo-taker.env
```

**`TAKER_ONLY_GAMES` weight suffix (issue #393).** Each entry is `gameId[:N]` — `N` is the number of resting bot-waiters for that game (a bare `gameId` with no suffix defaults to `N=1`). Every listed game gets exactly one taker regardless of weight; weight only controls rester count/variety. The whole roster is capped at a fixed 34-name budget (`GATED_ROSTER_NAMES` in `src/config.ts`) — games are allocated in list order, and the instant a game's block (`1 + weight`) doesn't fit what's left, that game **and every game after it in the list** are silently dropped (one informational log line at startup, not an error). Put the games you most need on-screen first. The example above (32 of 34 identities) is the live config as of 2026-08-21 — change it as the Owner's/Designer's presence preferences change, it's not a fixed prescription.

**Do not set `TAKER_STAKE`.** Leaving it unset (the default, `0`) means "claim any non-reserved stake" — the whole point of this setup. Setting it to a fixed value (e.g. `TAKER_STAKE=1`) is a real bug that has bitten this VM before: a leftover `TAKER_STAKE=1` from the old single-stake plan-B silently stopped 5¢/10¢ bets from ever being taken, with only 1¢ working. If you're rebuilding this VM from an older snapshot or notes, check `/etc/demo-taker.env` doesn't have this line.

**`TAKER_ALLOW_PREFIX`, not `TAKER_ALLOW_NAMES`.** The old exact-name allowlist (`TAKER_ALLOW_NAMES=Demo`) was replaced outright — any account starting with `Demo` now qualifies automatically, no need to pre-register specific accounts. This must be **set explicitly** (it defaults to empty/any-human, on purpose, so the *general* 26-bot roster elsewhere never accidentally narrows to `Demo*` too).

Optional: `TAKER_EXCLUDE_STAKE=<n>` reserves one more stake so two `Demo*` accounts can deliberately play *each other* without the gated taker sniping it. Not currently set on this VM (the Owner has held off on activating the reserved-account-pairing feature) — see `tools/bot-crowd/src/config.ts`'s doc comment on `takerExcludeStake` before turning it on; no single value is *guaranteed* free of the resting pool's randomized lanes anymore, only a best-effort pick.

(If you'd rather not use the admin password at all, delete that line — the bots still run on their signup grant; top-ups just turn off.)

## 6. Run it as a service (auto-starts on boot, restarts on crash)

Find your pnpm path and username, then write the service:

```bash
echo "user=$(whoami)  home=$HOME  pnpm=$(command -v pnpm)"
```

```bash
sudo tee /etc/systemd/system/demo-taker.service >/dev/null <<UNIT
[Unit]
Description=RapidClash gated demo takers (plan-B, always-on)
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

You should see bots come online for every game in `TAKER_ONLY_GAMES` — one `🤖@<handle>` taker plus its configured number of resters per game (each rester's stake is drawn randomly at boot, so exact numbers vary run to run) — ending in `All bots online`. With the example config above that's **32 bots**. Bot names are human-sounding handles (e.g. `🤖@knightfall`), not game-coded names.

On your phone/laptop: **register a new account whose name starts with `Demo`** (e.g. `DemoTest`, exact case — the prefix match is case-sensitive), open Coinflip, set **any stake except `2¢`** (the one human-reserved tier — reachable via a tap-again gesture on the `1¢` preset, not its own button), press **PLAY** — within ~1s a gated taker should claim it and the match should settle. Posting at `2¢` instead should sit unclaimed, waiting for a real second `Demo*` account to join it — that's deliberate (see §9). Try blackjack and chess too. Press Ctrl-C to leave the log view (the service keeps running).

## 8. Day-to-day: always-on, no start/stop

**This VM stays running continuously — do not stop it between demos.** This is a deliberate change from the original plan-B (which had the Owner start it before each demo and stop it after): an investor can now show up at any hour, self-register a `Demo*`-prefixed account, and immediately have a bot opponent, with zero prep. `e2-micro` costs are negligible running 24/7.

**Restart the bot service after every main-app deploy.** The Cloud Run deploy creates a new revision; the VM's WebSocket connections keep talking to whatever revision they connected to, which becomes invisible/stale once a new one is live. After deploying `rapidclash-demo`, always:
```bash
gcloud compute ssh demo-taker --zone=us-central1-a --ssh-key-file ~/.ssh/demo_taker_wsl \
  --command "sudo systemctl restart demo-taker"
```
This isn't optional cleanup — skipping it means the bots silently stop responding to new challenges until someone notices and restarts manually.

If you ever do need to fully retire it: `gcloud compute instances stop demo-taker --zone=us-central1-a` (or `delete`, §"Tear it all down" below).

## 9. Why one stake is never taken

One stake tier is reserved for human-vs-human testing — a taker will never claim a challenge there, and no resting bot ever posts there either, so any open challenge you see at this stake in the lobby is genuinely human-posted:
- **`2¢`** (issue #381): reachable only via a **tap-again gesture** on the `1¢` preset in the bet UI (`apps/web/src/screens/GameHub.tsx`) — deliberately not its own preset button, so it stays a "testers who know about it" tier rather than a visible option.

This lets two `Demo*`-prefixed testers line up a genuine human-vs-human match (e.g. to demo real matchmaking, not just the bot) by both posting/joining at `2¢` — the gated taker leaves it alone.

**`100¢` was released back to normal bot-claimable use by issue #384** (shipped and live on this VM): it was the original reserved tier, but now that `2¢` covers the human-only-testing role on its own, `100¢` no longer needs to be off-limits — the taker claims it like any other stake, and resters draw it like any other non-reserved value (issue #393 removed the old fixed 3-lane stake system in favor of each rester independently drawing from the same pool the general roster uses). Current authoritative value: `tools/bot-crowd/src/config.ts`'s `HUMAN_RESERVED_STAKES` (should read `[2]`).

---

## Troubleshooting

- **Bots start but never take a `Demo*` challenge.** Check the account name genuinely starts with `Demo` (case-sensitive) and that `TAKER_ALLOW_PREFIX=Demo` is actually set in `/etc/demo-taker.env` (it does **not** default to `Demo` — it defaults to empty/any-human, and must be set explicitly on this VM). Check the stake isn't `2¢` (§9 — reserved, never taken by design). Check you **posted** (pressed PLAY) rather than joined. `journalctl -u demo-taker -e` shows what it saw.
- **Only `1¢` bets get taken, nothing else.** This is the `TAKER_STAKE=1` leftover bug (§5) — check `/etc/demo-taker.env` for a `TAKER_STAKE` line and delete it, then `sudo systemctl restart demo-taker`.
- **Bots go dark a while after the VM's been up, then reconnect on their own.** Expected and self-healing (issues #372/#373): Cloud Run's `--timeout 3600` force-closes every WebSocket at the 1-hour mark regardless of activity; the bots now detect this and automatically re-rest/re-take on reconnect. No action needed — if a bot stays dark for more than a minute or two after that, something else is wrong; check the log.
- **Bots went dark right after a main-app deploy and don't recover on their own.** This is the stale-revision issue (§8), not the hourly reconnect above — restart the service manually.
- **`socket closed` / can't connect.** Confirm `SERVER_URL` is the live `https://…run.app` (the WS URL is derived as `wss://…/ws`). The VM needs outbound internet — default on GCE.
- **`admin login failed`.** Wrong/empty `ADMIN_PASSWORD` — harmless: top-ups just disable, bots run on their grant. Fix the env file and `sudo systemctl restart demo-taker` if you want top-ups.
- **Change the config later.** Edit `/etc/demo-taker.env`, then `sudo systemctl restart demo-taker`.
- **Update the code later.** `cd ~/rapidclash-demo && git pull && pnpm install && pnpm --filter @rapidclash/shared run build && sudo systemctl restart demo-taker` — pulls over the SSH deploy key set up in §4, no token to manage.
- **Tear it all down.** `gcloud compute instances delete demo-taker --zone=us-central1-a`.
