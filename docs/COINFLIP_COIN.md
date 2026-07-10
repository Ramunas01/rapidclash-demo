# COINFLIP — Coin & flip (3D cylinder, vertical axis)

*Spec for the coinflip coin. **Supersedes the flat `scaleX` squash** currently in `FlatCoin.tsx`. The coin becomes a real 3D cylinder (Three.js) spinning on a **vertical axis**, landing on the server-decided face. Client-only / presentational — the server still decides the outcome; the flip only animates to it, so redaction and timing are unchanged. Validated by the `coinflip-prototype-vertical.html` reference.*

## Why the rebuild

The shipped coin fakes a flip with `scaleX:[1,0,1]` on a flat SVG whose face is drawn as an ellipse (`rx38/ry44`) and whose colour is preset to the winner. That produces the Designer's four defects: not round, zero thickness at the midpoint, result visible from frame one. A real cylinder under one light fixes all four for free and gives realistic edge shading + motion blur cheaply.

## The coin (Three.js)

- **Geometry:** `CylinderGeometry(1, 1, ~0.26, 96)` (thickness ≈ 13% of diameter — the Designer's ~10–12% + a hair), `geometry.rotateX(π/2)` so the caps face the camera (±Z). *(r128 note: use `CylinderGeometry`; do not use `CapsuleGeometry`.)*
- **Materials** (`MeshStandardMaterial`, order `[side, topCap, bottomCap]`): topCap = **heads**, bottomCap = **tails**, side = **edge**. Metalness ~0.55, roughness ~0.3–0.45.
- **Faces = gold / silver** (prototype: heads `#E8B84B`, tails `#C9CDD6`), edge a warm mid-tone (`#B9905A`) that sits acceptably next to both. **Tokenise** as `--coin-*-face/-edge` (see palette flag below).
- **Bolt stamp:** stamp the shared `BOLT_PATH` (card-back mark) tone-on-tone on each cap, so the coin matches the card backs — via a small cap texture or a thin mesh. *(The prototype omitted this; it's a small add.)*
- **Lighting:** one white key light (upper-front) + a subtle purple brand rim light. The key light on the curved side **produces the two-tone edge banding automatically** as the coin turns — no hand-placed shade colours. Ambient ~0.55 so faces stay readable.

## The flip

- **Axis: vertical (Y).** Rotate `coin.rotation.y`; edge-on midpoint is a **vertical band** of the edge colour (matches the Designer's "thin vertical ellipse").
- **Landing (server-authoritative):** the server sends the outcome as today; the client spins to it. `rotation.y ≡ 0 (mod 2π)` → heads/gold up; `≡ π` → tails/silver up. Compute the target angle from the server face — **never recolour** to fake the result.
- **Chance feel:** random **5–7 full turns** per flip (10–14 half-turns); **ease-out cubic** so it decelerates and settles; duration **~1.8–2.4 s**.
- **Colours never change** during the spin — heads/tails alternate purely by geometry, so the outcome is unknowable until the settle.
- **Motion blur:** a **CSS `filter: blur()` on the canvas element**, radius ∝ current angular velocity → heavy while fast, clears as it settles. Near-free; no post-processing pass.

## States & integration

- **Keep the `FlatCoin` API** (`face: CoinFace|null` → null = resting heads, set = flip-to; `size`) so `CoinflipHub`'s idle / in-match / terminal / draw-flip choreography is untouched. Swap the internals to Three.js. *(Optional tidy: rename the export to `Coin` and update the two `CoinflipHub` imports.)*
- **Idle / preview:** static coin, heads face, perfect circle, no spin (Designer: resting = a perfect circle).
- **Result:** settle on the landed face; the player-bar result signal is unchanged.
- **Tile thumbnail:** keep a **static image** for `assets/games/coinflip.webp` — do **not** put a live WebGL canvas in the small tile.
- **Performance:** render only while animating (and one frame on state change); **pause the rAF loop when the coin is static** to avoid a constant GPU draw. One WebGL context (the hub arena) only.
- **Reduced motion:** honour `prefers-reduced-motion` — short/skipped spin that still lands on the correct face.

## Flags to resolve (Designer / Owner)

1. **Palette shift gold/silver vs orange/blue.** The shipped coin is **orange heads / blue tails**, and the **H/T pick pills mirror those tokens** (`COIN_FACE_TOKENS`, `CoinflipHub.tsx:15`). Going gold/silver means the pills should follow to keep "pill colour = face colour." Because the pills read the tokens, **redefining `--coin-*-face` to gold/silver updates the pills automatically** — confirm the Designer wants the pills to become gold/silver too (recommended for consistency).
2. **Flip duration lengthens** from `COIN_FLIP_DURATION_S = 1.1 s` to ~1.8–2.4 s. Verify the reveal/hold beat (`holdResultMs`, draw-flip `drawBeat`) still feels right; bump the hold if needed.
3. **Three.js dependency** (~150 KB gzip core) added to `apps/web`. Fine for a pitch build, but it's a bundle bump — Owner OK. (The no-dependency angle-driven SVG alternative exists but gives a flatter edge; the Designer chose the 3D look.)

## Acceptance test (film the flip, step frames)

- Resting coin is a **perfect circle**.
- At every edge-on moment a **visible vertical thickness band** of the edge colour appears.
- Heads/tails (gold/silver) **alternate throughout** the spin; the result is **unknowable until the settle**.
- Two consecutive flips have **different turn counts**; the spin **decelerates** into place.
- The landed face **matches the server outcome** every time; **no colour is ever changed** — only rotation. Motion blur tracks spin speed. Tokens only, no hardcoded hex.
