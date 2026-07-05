# Sound effects — the convention

Short UI sound effects for the demo. Built and shipping (chess move); this doc is the contract for adding the rest. Keep it **minimal and tasteful** — a few signature moments per screen, polished for demonstration, never a cacophony.

## The system (as built)

A dependency-free Web Audio wrapper: **`apps/web/src/lib/sound.ts`**.
- **`play(name)`** — play a preloaded clip by name. **Fails silently** in every path (no audio support, not yet unlocked, muted, buffer not decoded) — it must never throw or interrupt gameplay.
- **`unlock()` / `installUnlockOnFirstGesture()`** — iOS/mobile autoplay is blocked until a user gesture resumes an `AudioContext`. Unlock is installed on the first tap/click/keydown, and re-called from PLAY and the mute toggle. **This is the one non-obvious rule — a sound before the first gesture is silently dropped, by design.**
- **Mute:** `isMuted()` / `toggleMute()` / `setMuted()` / `subscribe()`, persisted in `localStorage` (`rc:sound:muted`), **default = ON**. The mute state is **global** (it lives in `sound.ts`); the **`MuteToggle`** (speaker / muted-speaker) is a control over it that reads and writes the module directly and re-renders via `subscribe()`. It lives on the **Account page (`ProfileHub`), next to Log out** — a pure UI location; toggling it applies everywhere. (Audio unlock does **not** depend on this button — `installUnlockOnFirstGesture()` and PLAY cover the first-gesture unlock globally.)
- **Assets:** `apps/web/src/assets/sounds/` — short (`< ~0.5 s`), small clips; may be procedurally generated (see `gen_move_wav.py`) or CC0/royalty-free.
- **Adding a sound = one line** in the `MANIFEST` (import the URL, map a `name`) + one `play('name')` at the render site.

## Trigger model

Sounds are **client-side only**, played at the **moment the event renders** — no server change. The event is already server-authoritative; the client just plays a clip when it draws it. Reference pattern (chess): `ChessHub.tsx` plays `move` on a **board-position change** (`prevFen !== fen`), which fires for **both** the player's own move and the opponent's — the position update is the trigger, so both are covered by one line.

## Sound redaction rule (non-negotiable — the audio arm of the redaction contract)

**A sound may only be triggered by information the player is already allowed to see** — public state, the player's *own* state, or terminal (round-over) state. **Nothing a sound reveals may be something `viewFor` conceals.** Audio is a side channel exactly like broadcast events (see the redaction rule in `GAME_MODULE_INTERFACE.md`); a distinct sound tied to hidden state leaks it just as surely as a visible pill would. Concretely:
- **Crash:** the shared curve is public → `launch` / `crash` are fine, and *your own* `eject` is fine; **never** a sound on the *opponent's* eject (it's hidden until terminal — a sound would leak whether/when they ejected).
- **Blackjack:** a `deal` sound when either player draws is fine (a card was dealt — public); but **no** opponent-specific bust/blackjack sound before terminal (it would leak their hidden total). Outcome sounds fire at the reveal.
- **Coinflip / RPS / Keno / Limbo:** no sound that fires on the opponent's hidden pick/lock before the reveal.
- **Hilo:** no sound on the opponent's advance/bust — that leaks their streak (the same leak the event-redaction fix removed).

If in doubt: a sound is safe only if the player could already *see* what caused it.

## Discipline

- **Mute is respected everywhere**; default ON for the demo; the choice persists.
- **Supplementary, never the sole signal.** Visuals carry the information (accessibility + muted users); sound enhances. Nothing may be conveyed by sound alone.
- **Short, low-volume, no pile-ups.** Pace repeated sounds with their animation (a multi-card deal is a paced sequence, not five clips at once); debounce rapid repeats.
- **Client-only, silent-fail, unlock-on-gesture** — as above.

## Event map — minimal set for the demo

Designer produces minimal, polished clips for these; programmer wires each as `play('name')` at the render site. **Demo** = build for the pitch; **Optional** = nice-to-have if time allows. All must satisfy the redaction rule above.

| Screen / game | Event (trigger) | Clip (name) | Priority |
|---|---|---|---|
| **Chess** | piece move — board position change (own + opponent) | `move` (wood thump) — **shipped** | Demo ✅ |
| **Coinflip** | the coin flip (at reveal) | `flip` (spin/whoosh → soft land) | Demo |
| **Coinflip** | tapping your side | `pick` (soft click) | Optional |
| **Blackjack** | each card dealt (own + opponent — public) | `deal` (card flick), paced with the deal | Demo |
| **Crash** | rocket launch | `launch` (short rise/whoosh) | Demo |
| **Crash** | **your** eject | `eject` (lock/ding) | Demo |
| **Crash** | crash (shared, at the burst) | `crash` (soft thud/pop) | Demo |
| **Matchmaking** | opponent found (`match.start`) | `match-found` (a ping) | Demo |
| **Universal result** | win — with the shared win animation | `win` (short positive chime) | Demo |
| **Universal result** | draw / push — with the shared draw mechanic | `draw` (soft neutral tone) | Demo |
| **Universal result** | loss — with the loss outline | `loss` (subtle low tone — keep quiet) | Optional |
| **Pick window** | last ~3 s of a timed pick | `tick` (soft) | Optional (can annoy) |

**Universal result sounds ride the shared mechanics** — the `win` clip plays with the shared win-animation component and `draw` with the shared draw→auto-rematch flow (`COINFLIP_HUB.md`, `SCREENS.md`), so every game's win/draw *sounds* the same the way it *looks* the same. Add game-specific clips (Mines reveal, Roulette spin, Dice/Baccarat/Keno/Hilo reveals) later on the same pattern; they are out of the demo-minimal set.
