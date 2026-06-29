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

## Designer refinement pass — staged states (Preview · Gameplay · Result)

A later designer pass reorganises the arena into three explicit states and fixes two live-build bugs. Where it refines a numbered item above, the delta is called out. **All of it is presentation; the redaction + server-authority reconciliations at the top still bind.**

### Stage 1 — Preview (idle, before PLAY)
Show the **real chart frame at rest**, not a placeholder — the preview should look identical to the in-play screen, frozen at 0 m:
- Full frame: Y-axis (altitude m) + X-axis (time markers), with the **rocket parked at the bottom-left origin (0 m), angled up**, ready to launch — the **proper rocket asset**, not a centred emoji.
- **Moon top-right** (the goal), consistent with in-play.
- Helper text centred over the chart: **"Place your bet and launch."**
- Initial Y labels bottom→top: **0, 100, 300, 700, 1100, 2000** (monotonic ascending — the designer has now fixed the earlier duplicate/disorder, so this supersedes §3's placeholder example). X markers: 2.8s, 6.8s, 11.7s, 19.6s, 45.0s.

(Mirrors the Coinflip preview pattern — the idle tile is the live game at rest.)

### Stage 2 — Gameplay (in-flight) — refines §1, §5
1. **One button that transforms in place — the #1 fix.** PLAY → **EJECT** during flight → back to PLAY after. The live build currently **spawns a second EJECT button**; instead, transform the existing PLAY button. (This is §5 tightened: do not add a second control.) The locked-altitude text moves **off the button onto your pill bar** (Stage 3); after you eject the button goes to a disabled waiting state, then returns to PLAY.
2. **Smooth curve + follow-camera (fixes the bounce).** The curve is currently jagged/stair-stepped, and the rocket flies to the top of the frame then **bounces back down**. Fix: render **one smooth continuous curve** from the analytic altitude(t) function (not stair-stepped samples), gradient trail orange→pink→purple, rocket at the tip. Once the rocket reaches a set screen height it **holds position**, and the *axes* rescale (Y compresses, X extends) to convey continued climb — the world moves, not the rocket. This eliminates the bounce; it's the same idea as §3's auto-compressing axes, now stated as a camera rule.
3. **Altitude readout** floats over the curve in a clean **pill** ("176m"), live (§2).
4. Y/X axes as §3 — compressing Y, non-linear X.
5. **Opponent bar stays blank during flight** — never show their altitude or status mid-flight; it would leak whether they've crashed. (The redaction reconciliation, made concrete.)
6. **Fairness restated:** one shared curve + one crash point; **eject resolves server-side at the server-received time against the authoritative curve, not the client's rendered number** — latency must not grant an edge. This is exactly `CRASH.md`'s model (eject = intent timestamped with `ctx.now`; the display is aligned via `serverClockOffset` so what you see ≈ what banks). No change — just hold the line in the renderer: **never bank the client's number.**

### Stage 3 — Result reveal — refines §6, §7
The reveal moves onto the **slot pills with the outline convention** (consistent with Coinflip/Blackjack), replacing §6's separate side-by-side panel:
1. **On EJECT** → your own pill immediately shows **"Locked {A}m"** (e.g. "Locked 345m"). Opponent's pill stays **blank** (their eject still hidden).
2. **On crash** → round ends, opponent's pill reveals their **"Locked {B}m"** if they ejected, or **"Crashed"** if they never did. Same for your own pill — never ejected → **"Crashed"** (this replaces §7's "0 m" text *on the pill*; the explosion + red curve-snap from §7 remain the in-chart crash visual).
3. **0.5 s after** the opponent's altitude lands → your pill gets the **outline**: green = won, red = lost, orange = draw.
4. **Draw (orange) → instant replay** (fresh seed, no rake) when both crashed, or both locked the exact same altitude — the **universal tie rule** (now also written into `CRASH.md`).
5. **The 0.5 s beat is deliberate:** opponent's number first, a pause, *then* your colour — never simultaneous, so the player reads the altitude before the verdict.

Full beat: eject → your altitude locks on your pill → crash → opponent's altitude (or "Crashed") reveals → 0.5 s pause → your pill outlines green / red / orange.

> **Template:** the *reveal → 0.5 s beat → outline* choreography and the "Locked {x}" / "Crashed" pill states are **reusable** — the same shape fits Coinflip (pick → flip → outline) and the other hidden-commit games. Build the reveal as a shared slot-pill behaviour, not Crash-only.

**Revised build order (supersedes the one in Notes):** (1) smooth curve + follow-camera — the demo centrepiece and the bounce fix; (2) the single transforming button — the main bug; (3) the Preview frozen-chart state; (4) the Stage-3 pill reveal + outline + 0.5 s beat; (5) floating altitude pill + axes; (6) moon.

---

## Notes

- **Money framing:** the bet chips (1¢…100¢) and the 1,000¢ wallet are play-money **credits** — correct and consistent (no real-currency symbols). No change.
- **Template vs instance:** the curve, axes, moon, and crash explosion are **Crash-specific** arena content. The **button state machine** (PLAY → action → disabled-waiting) and the **side-by-side reveal** are template-shaped — flag them for reuse across the other duel hubs rather than re-inventing per game. The standard game-hub chrome (slot pills, Open Games, related games, footer, Searching reassurance) already applies to Crash's hub and is unchanged by this brief.
- **Build order:** curve first (item 1) — it's the demo. Then the floating number (2) and axes (3), then the button states (5), reveal (6), and crash visual (7). Moon (4) last.
