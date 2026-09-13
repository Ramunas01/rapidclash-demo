# Avatar preset assets — licence record

## Current set: `rc-01`–`rc-10` (ticket 2026-09-13#7, added 2026-09-13)

Ten presets wired into `components/hub-shared/Avatar.tsx`'s `PRESETS` map, selectable via the
Account page's inline avatar strip (`ProfileHub.tsx`). Sourced from the Designer's own prototype
asset export (`design/prototype/assets/avatars/rc-01.png` through `rc-10.png`, part of the
original prototype asset drop, PR #458) — the design tool's own exported assets, same category as
every other UI icon already in use in this repo. **No licensing question for this set** — this
retires the licensing-provenance risk two of the six presets below carried (see "Retired" below).

| File | Source | Licence / use |
|------|--------|---------------|
| `rc-01.png`–`rc-10.png` | Designer's own prototype asset export (`design/prototype/assets/avatars/`) | Design tool's own export — no third-party rights asserted |

## Retired (ticket 2026-09-13#7): the six named presets

The six presets below shipped in earlier tickets (#312, Owner-provided 2026-07-20) but are now
**removed** — `AvatarId`/`AVATAR_IDS` (`packages/shared/src/protocol.ts`) no longer include these
ids, `Avatar.tsx`'s `PRESETS` map no longer references them, and the source image files have been
deleted from `apps/web/src/assets/avatars/`. Replaced outright by the Designer's own official
`rc-01`–`rc-10` export above — not kept alongside it. Any account that had picked one of these six
gracefully resets to `'default'` on next load (`coerceAvatar`, `packages/core/src/identity.ts`,
validates against `AVATAR_IDS` and silently falls back — no migration script needed).

Kept here as a historical record of what shipped and why, not as an active asset list.

| File (deleted) | Former id | Source | Licence / use |
|------|------|--------|---------------|
| `avatar-boy-light.png`  | `boy-light`  | imgbin.com (<https://imgbin.com>) | For commercial use (per source) |
| `avatar-girl-light.png` | `girl-light` | imgbin.com (<https://imgbin.com>) | For commercial use (per source) |
| `avatar-boy-brown.png`  | `boy-brown`  | AI-generated, then modified in-house | No third-party rights asserted |
| `avatar-boy-dark.png`   | `boy-dark`   | AI-generated, then modified in-house | No third-party rights asserted |
| `avatar-hooded-mono.jpg`  | `hooded-mono`  | Designer-supplied, meme-culture image (grayscale hooded/"wojak" figure) | Provenance/licence not independently verified — Owner-accepted risk, now moot (retired) |
| `avatar-hooded-degen.jpg` | `hooded-degen` | Designer-supplied, meme-culture image ("DEGEN"-branded hooded figure) | Provenance/licence not independently verified — Owner-accepted risk, now moot (retired) |

Provided by the Owner (2026-07-20), who **confirmed** the file→source mapping above:
`boy-light`/`girl-light` are the imgbin.com (commercial-use) pair; `boy-brown`/`boy-dark` are
AI-generated and modified in-house.

### `hooded-mono` / `hooded-degen` (added #312, 2026-08-13; retired 2026-09-13#7)

The Designer supplied 5 meme-avatar candidates in chat; the Owner approved shipping only these
two (a grayscale hooded figure and a "DEGEN"-branded hooded figure). The other three candidates
— two Pepe the Frog images and one Doge image — were deliberately excluded and are **not** in this
repo: Pepe is an actively-enforced copyrighted character (creator Matt Furie has a documented
history of action against unauthorized commercial/crypto use, and this is a wagering platform);
Doge derives from a copyrighted photograph. Neither exclusion should be revisited without new
Owner direction.

Like the imgbin.com pair above, the original source/authorship of these two images has not been
independently traced or licence-verified — they were provided as ready-made meme-culture assets,
not sourced by us from a documented origin. Shipping them was an Owner-accepted risk for the
investor demo, not a claim of clean provenance — a risk this retirement (2026-09-13#7) closes,
since the replacement `rc-01`–`rc-10` set above has no such question. Source files (historical):
`docs/design-refs/avatars/` (`Profile-picture-2.jpg` → `hooded-degen`, `Profile-picture-5.jpg` →
`hooded-mono`).
