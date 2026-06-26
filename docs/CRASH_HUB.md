# Crash — arena UI polish (demo)

Polish brief for the Crash **play/arena** screen, for the investor demo. This **upgrades the "basic is fine" Interface note in `CRASH.md`** — the logic is unchanged; this is purely the visual layer. Crash is the most *visual* game in the canon, and the live build currently shows a bare "ALTITUDE XXm" number where the entire drama should be. The rising curve is the game; building it is the priority.

Two reconciliations from `CRASH.md` that constrain everything below:
- **The climb is a client-side render of the deterministic curve — not a new server tick loop.** Altitude is `scale·(e^(growth·s) − 1)` of elapsed time `s`, anchored to `startedAt`, with the client aligned to the server clock (`serverClockOffset`). The animation must be driven by that exact function so **what the player watches equals what the server banks on eject**. No server changes.
- **Redaction (`viewFor`): the shared climb is public; each player's eject is hidden until terminal.** So the curve itself is visible to both players, but the animation must **never** render the opponent's eject point (or their pre-set auto-eject) during the climb. The opponent's locked altitude appears only at the end-of-round reveal.

## 1. The rising curve — priority 1 (missing from the live build)

Replace the bare altitude text with a **coordinate field containing an animated rising curve** that fills the main panel (Ramunas' edit: the rocket drawing the curve like a pencil on a paper in logarithmic coordinates, until the curve ends with explosion 💥 replacing the rocket image). Build this first — without it there is nothing to watch and no tension about when to eject.

- **Y = altitude, X = time.** A trail climbs in real time with an **orange → pink → purple gradient**, the **rocket riding the tip** (as in the mock, see the ~/projects/rapidclash-demo/design-ref/crash-hub/'_Crash_ after (needed result).png').
- The trail is the climb history; it grows from the origin as `s` increases, following the slow-start exponential (first ~1–2 s barely move, then it accelerates).
- Account for the round phases already built (#121): a ~3 s **SETUP** "get ready" window and ~1 s **ignition** precede the climb — during those the rocket sits at the origin (nothing climbs on the pad); the trail begins at `startedAt`.

## 2. Float the altitude number over the curve (don't replace it)

Keep the big live altitude number, but **overlay it on the chart in one fixed location** (as the mock's floating "900m"), not in place of the graph. The live build's mistake is showing the number *instead of* the curve. The number must read the same deterministic altitude as the rocket tip.

## 3. Axes

- **X-axis — time markers**, as in the mock (e.g. 2.8s, 6.8s, 11.7s, 19.6s, 45.0s). Note these are an **illustrative snapshot of a compressing axis**: the gaps grow, so later seconds are squashed and a long climb stays framed. Tick values are **dynamic** (auto-rescaling), not fixed.
- **Y-axis — altitude markers, with the designer's labels corrected.** The mock's drawn values are buggy — they read roughly `100, 700, 300, 700, 1100, 2000` bottom-to-top, which has a **duplicate 700 and 300 out of order**. Use **clean monotonic ascending** values (e.g. `0, 300, 700, 1100, 2000`), no duplicates. The scale should **auto-compress as the rocket climbs** so the curve stays framed while it accelerates — so, like X, the Y ticks are dynamic, not the fixed numbers drawn.

## 4. Keep the moon (low priority)

The moon in the top corner is a nice climb target / destination — keep it. Low priority, but it works and costs nothing (moon_transparent.png located in design-ref/crash-hub directory.

## 5. Primary action button — state machine

The single primary action control moves through states (reuse the existing disabled-button styling for the inert states):
- **Pre-round / commit:** `PLAY`.
- **SETUP / ignition:** a brief `GET READY…` (or a 3-2-1 countdown), disabled — the climb hasn't started.
- **Climbing, not yet ejected:** `EJECT` — enabled, prominent (this is the live build's existing label; keep it here).
- **After you eject, waiting for the crash/opponent:** `Locked at {A}m · waiting…`, **disabled**.
- **Terminal:** hand off to the reveal (below).

(v1 is **live-EJECT only** for humans per `CRASH.md` — no numeric auto-eject input to surface here; the server capability stays for bots.)

## 6. End-of-round reveal — the payoff

Because ejects are hidden, the reveal *is* the drama, and it's the one moment redaction lifts. On terminal, show both locked altitudes **side by side** with the verdict, then the pot result:

> **You 900m vs Povcrazy 740m → You win** → *+{pot − rake} credits*

A crashed player shows as busted (0 m) rather than an altitude. This side-by-side reveal is a **reusable template** for the other hidden-commit games (Limbo's targets, Mines, Keno) — worth building so it generalises.

## 7. Crashed state

When the shared climb reaches the hidden crash altitude `C`: **explosion at the crash point + the curve snaps red.** A player still aboard at `C` busts to **0 m** ("rocket exploded → {C}m"). If you had already ejected, your locked altitude stands; the explosion is the shared event that ends the round and triggers the reveal.

---

## Notes

- **Money framing:** the bet chips (1¢…100¢) and the 1,000¢ wallet are play-money **credits** — correct and consistent (no real-currency symbols). No change.
- **Template vs instance:** the curve, axes, moon, and crash explosion are **Crash-specific** arena content. The **button state machine** (PLAY → action → disabled-waiting) and the **side-by-side reveal** are template-shaped — flag them for reuse across the other duel hubs rather than re-inventing per game. The standard game-hub chrome (slot pills, Open Games, related games, footer, Searching reassurance) already applies to Crash's hub and is unchanged by this brief.
- **Build order:** curve first (item 1) — it's the demo. Then the floating number (2) and axes (3), then the button states (5), reveal (6), and crash visual (7). Moon (4) last.
