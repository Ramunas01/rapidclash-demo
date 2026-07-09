# CHESS — Draw Offer (offer → accept)

*Spec for the player-initiated draw in chess. **Revision 3 — this replaces the symmetric "both press their own Draw button" mechanic that shipped.** The Designer-final flow is asymmetric: the offerer offers, the opponent accepts via a dedicated pill. Owner-gated (adds one protocol message). Scope: chess only, active match only. Draw terminal reuses the locked chess draw (stakes returned, no rake, no rematch, orange/amber result).*

## Summary

During an active match the idle **Play a Friend** button becomes **Draw request**. Pressing it offers immediately: the offerer's own bar shows a solid-orange **DRAW OFFERED** status pill, their button becomes **Revoke DRAW**, and in the opponent's view the offerer's bar shows a solid-orange **ACCEPT DRAW?** pill. The opponent taps **ACCEPT DRAW?** to agree → draw. The offerer can **Revoke DRAW** to withdraw; the offer also auto-expires after the set move window. Server-authoritative throughout (invariant #2). The offer is public — not hidden state — so no redaction concern; the only per-viewer difference is which control is actionable.

**The two players see different things during a pending offer** (both on the offerer's bar):
- **Offerer** → `DRAW OFFERED` — status, **not** tappable.
- **Opponent** → `ACCEPT DRAW?` — **the accept button**, tappable.

The opponent's own *Draw request* button does **not** accept — it only makes/revokes the opponent's own separate offer. Accepting happens solely via the `ACCEPT DRAW?` pill.

**Why no confirm step (unlike Resign):** an accidental *Draw request* tap is harmless — an offer can't end the game by itself (the opponent must accept) and is revocable. Accepting is a single deliberate tap on a distinct pill. Resign forfeits on one tap, so it needs its in-button confirm; draw does not.

## Visual style (all three elements, one system)

Solid, fully opaque **amber/orange** fill with **dark text** (`bg-amber-400 text-background`) — the existing draw hue (`slotReveal.tsx:48`). No translucent fills, no outline-only style, **no "½" glyph**. Applies to: `DRAW OFFERED` pill, `ACCEPT DRAW?` pill, and the `Revoke DRAW` button — so the whole draw state reads as one orange system. Recommend tokenizing the hue (`--draw` = `#fbbf24`).

## State machine (per player P, active match)

| Viewer sees on the offerer's bar | Condition | Control |
|---|---|---|
| `DRAW OFFERED` | P is the offerer, viewing own offer (`side==='own'`) | status, non-tappable |
| `ACCEPT DRAW?` | P is the opponent of the offerer (`side==='opponent'`) | button → `drawAccept` |

Secondary button, by P's own state: `Play a Friend` (idle) → `Draw request` (in match, P has no offer) → `Revoke DRAW` (P has an active offer) → back on revoke/expiry/agreement → `Play a Friend` (result).

## Lifecycle & edge cases

- **Offer:** `drawOffer` sets P's offer; server broadcasts `drawOffers[P]`. Offerer bar → DRAW OFFERED; opponent's view of it → ACCEPT DRAW?.
- **Accept:** `drawAccept` from the opponent of an active offer → server resolves `{type:'draw'}` → existing chess draw settlement (stakes returned, no rake, no rematch) → orange "Draw" popup + persistent orange bar outlines (`chessResultLine 'Draw'`, `suppressResultOverlay` — **reuse, don't reimplement**).
- **Revoke:** `drawRevoke` clears only the offerer's own offer.
- **Expiry:** unchanged — a pending offer auto-revokes after the set move window (the existing rule/number).
- **Opponent's own button:** never accepts. If the opponent presses *Draw request* while an incoming offer is pending, that creates the opponent's *own* separate offer (the original offerer would then see ACCEPT DRAW? on the opponent's bar). Accepting the incoming offer is only via the pill. *(Optional UX: disabling the opponent's Draw request button while an incoming offer is pending — leave enabled unless the Designer wants it suppressed.)*
- **Decisive result while pending** (checkmate / flag-fall / resign): terminal supersedes; offers discarded.

## Protocol (owner-gated — `packages/shared/src/protocol.ts`)

- **New:** client→server `match.drawAccept` — payload `Record<string, never>`. Resolves the draw when sent by the opponent of an active offer.
- Existing: `match.drawOffer`, `match.drawRevoke`; view field `drawOffers: Record<PlayerId, number>` (who has an active offer + move count for expiry).
- **Change:** remove the "both players offered → auto-draw" completion (the symmetric rule). Completion is now **`drawAccept` only.**
- Keep core generic (no `if gameId==='chess'`); chess declares the capability.

## Server / module (`apps/server` + chess module)

- On `drawOffer`: set sender's offer + broadcast (do **not** auto-complete against an existing opposite offer).
- On `drawAccept`: if the *other* player has an active offer → resolve draw via the existing settlement; else no-op.
- On `drawRevoke`: clear sender's offer.
- Expiry: on the offerer's ply, advance the move counter; at the window clear + broadcast.
- All transitions server-authoritative.

## Client (`apps/web`)

- **`DrawOfferedChip` branches on `side`** (`ChessHub.tsx:96`): `side==='own'` → non-tappable `DRAW OFFERED` status span; `side==='opponent'` → tappable `ACCEPT DRAW?` button dispatching a new `onDrawAccept`. Both solid orange, dark text, no `½`.
- **New `onDrawAccept` handler:** thread `onDrawAccept?()` through `GameHub` props + `areaArgs` (alongside `onDrawOffer`/`onDrawRevoke`, `GameHub.tsx:52-53/412`); add `handleDrawAccept` + `ws.drawAccept` in `App.tsx` (alongside `handleDrawOffer`/`handleDrawRevoke`, `:919-926`).
- `Revoke DRAW` button (`ChessSecondaryAction`, `:363`) → solid orange fill.
- Secondary *Draw request* button no longer participates in accepting (server no longer auto-completes on both-offered).

## PR sequence

1. **Styling PR (client-only, ship now):** `DRAW OFFERED` (own) + `Revoke DRAW` → solid `bg-amber-400 text-background`, remove `½`. No protocol.
2. **This spec** — Owner-approved (protocol change).
3. **Protocol PR** (owner-gated): add `match.drawAccept`; drop the both-offered auto-complete.
4. **Server/module PR:** accept-completes; keep offer/revoke/expiry.
5. **Client PR:** `DrawOfferedChip` per-`side` (DRAW OFFERED vs ACCEPT DRAW? button) + `onDrawAccept` wiring.

## Acceptance criteria

- Offerer: pressing Draw request shows solid-orange `DRAW OFFERED` (non-tappable) on their bar + `Revoke DRAW` button; no `½`.
- Opponent: sees solid-orange `ACCEPT DRAW?` (tappable) on the offerer's bar; tapping it draws the game. Their own Draw request button never accepts.
- Revoke withdraws the offerer's own offer; offer auto-expires per the existing window.
- Draw terminal = stakes returned, no rake, no rematch, orange popup + persistent orange bar outlines (existing path).
- Decisive result supersedes a pending offer. Server-authoritative; offer public (no redaction issue). All three elements share the solid-orange + dark-text style. Only tokens, no hardcoded hex; core stays generic.
