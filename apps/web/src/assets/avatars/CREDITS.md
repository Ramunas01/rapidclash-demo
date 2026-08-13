# Avatar preset assets — licence record

The six preset faces are wired into `components/hub-shared/Avatar.tsx`. They are user-selectable
in the Account picker (`ProfileHub.tsx`'s `PICKER_AVATARS`).

| File | Source | Licence / use |
|------|--------|---------------|
| `avatar-boy-light.png`  | imgbin.com (<https://imgbin.com>) | For commercial use (per source) |
| `avatar-girl-light.png` | imgbin.com (<https://imgbin.com>) | For commercial use (per source) |
| `avatar-boy-brown.png`  | AI-generated, then modified in-house | No third-party rights asserted |
| `avatar-boy-dark.png`   | AI-generated, then modified in-house | No third-party rights asserted |
| `avatar-hooded-mono.jpg`  | Designer-supplied, meme-culture image (grayscale hooded/"wojak" figure) | Provenance/licence not independently verified — Owner-accepted risk |
| `avatar-hooded-degen.jpg` | Designer-supplied, meme-culture image ("DEGEN"-branded hooded figure) | Provenance/licence not independently verified — Owner-accepted risk |

Provided by the Owner (2026-07-20), who **confirmed** the file→source mapping above:
`boy-light`/`girl-light` are the imgbin.com (commercial-use) pair; `boy-brown`/`boy-dark` are
AI-generated and modified in-house.

Note: imgbin.com is a user-upload clip-art aggregator, so per-image commercial-use terms there can
be inconsistent. For the investor demo, keep a copy of the specific source page / licence proof for
the two imgbin files alongside this record so the commercial-use claim is verifiable.

## `hooded-mono` / `hooded-degen` (added #312, 2026-08-13)

The Designer supplied 5 meme-avatar candidates in chat; the Owner approved shipping only these
two (a grayscale hooded figure and a "DEGEN"-branded hooded figure). The other three candidates
— two Pepe the Frog images and one Doge image — were deliberately excluded and are **not** in this
repo: Pepe is an actively-enforced copyrighted character (creator Matt Furie has a documented
history of action against unauthorized commercial/crypto use, and this is a wagering platform);
Doge derives from a copyrighted photograph. Neither exclusion should be revisited without new
Owner direction.

Like the imgbin.com pair above, the original source/authorship of these two images has not been
independently traced or licence-verified — they were provided as ready-made meme-culture assets,
not sourced by us from a documented origin. Shipping them is an Owner-accepted risk for the
investor demo, not a claim of clean provenance. Source files: `docs/design-refs/avatars/`
(`Profile-picture-2.jpg` → `hooded-degen`, `Profile-picture-5.jpg` → `hooded-mono`).
