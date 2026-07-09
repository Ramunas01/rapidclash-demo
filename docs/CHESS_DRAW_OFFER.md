# CHESS — Draw Offer (symmetric mutual request)

*Spec for the player-initiated draw in chess. **This replaces the earlier two-tap propose→accept version** — the Designer-blessed mechanic is symmetric: each player has a Draw button; pressing it offers immediately, and the draw completes when both sides have offered. Owner-gated: adds protocol messages + match state. Scope: chess only, active match only. Draw terminal reuses the existing locked chess draw (stakes returned, no rake, no rematch, amber/orange result).*

## Summary

During an active match the idle **Play a Friend** button becomes **Draw request**. Pressing it **sends an offer immediately** and the button becomes **Revoke DRAW**; a "Draw offered" indicator appears on the offerer's bar (visible on both screens, next to the offerer's name). The draw completes the moment **both** players have an active offer — i.e. if you press *Draw request* while the opponent's offer is already pending, the game draws at once. You can withdraw your own pending offer with *Revoke DRAW*. Server-authoritative throughout (invariant #2); the client sends intent only. The offer is public by design — not hidden state, so no redaction concern.

**Why no confirm step (unlike Resign):** an accidental single tap on *Draw request* is harmless — an offer alone can't end the game or cost the stake, it needs the opponent's matching offer, and it's revocable. Resign needs a confirm because one tap forfeits the stake; a draw offer does not. The two controls intentionally differ for this reason.

## The control + indicator

- **Secondary button** (the Play-a-Friend slot), by state: `Play a Friend` (idle) → `Draw request` (in match, no offer) → `Revoke DRAW` (after you offer) → back to `Draw request` on revoke/expiry/decline → `Play a Friend` (result/idle).
- **"Draw offered" indicator** on the offering player's bar, next to their name. It is one piece of state (this player has an active offer) rendered on that player's slot, so it shows on **both screens** — the offerer sees it on their own bar, the opponent sees it next to the offerer's name. Amber family (reuse the existing draw hue — the result already uses `amber-400`, `slotReveal.tsx:48`). Not a separate pressable pill; the action is the button.

## State machine (per player P, active match)

| State | Trigger | Button (secondary) | P's bar indicator | Server msg |
|---|---|---|---|---|
| **IDLE** | match active, no offer by P | `Draw request` (active) | none | — |
| **OFFERED** | P taps *Draw request* (opponent has no active offer) | `Revoke DRAW` (active) | "Draw offered" (both screens) | **`drawOffer`** |
| **(completion)** | P taps *Draw request* while the **opponent** is OFFERED | — → draw terminal | — | **`drawOffer`** → server resolves draw |
| **(revoke)** | P taps *Revoke DRAW* | back to `Draw request` | indicator clears | **`drawRevoke`** |

Symmetric: there is no distinct "accept". Pressing your Draw button either **creates** your offer (opponent not yet offered) or **completes** the draw (opponent already offered). Both-offered = draw.

## Lifecycle & edge cases

- **Completion:** server resolves `{type:'draw'}` the instant both players hold an active offer → existing chess draw settlement (stakes returned, no rake, no rematch) → amber/orange "Draw" popup + amber/orange bar outlines on both names (`chessResultLine 'Draw'`, `suppressResultOverlay` — existing path, **reuse, don't reimplement**).
- **Revoke:** clears only the revoker's own offer; the opponent's state (if any) is untouched.
- **Decisive result while an offer is pending** (checkmate / flag-fall / resign): the terminal supersedes; offers are discarded, no draw.
- **Simultaneous** double-offer resolves to a draw (both offers active).
- **⚠ Auto-expiry — open question.** The original brief had the offer auto-expire after ~2 moves; this corrected version adds explicit **Revoke** but is silent on auto-expiry. Recommend keeping a **backstop expiry** (a pending offer lapses after N of the offerer's own moves) so a forgotten offer doesn't linger indefinitely, *in addition to* manual Revoke. **Confirm with Designer:** keep the backstop (and pin N), or rely on manual Revoke only?

## Protocol (owner-gated — `packages/shared/src/protocol.ts`)

- Client→server `match.drawOffer` — payload `Record<string, never>`. On receipt: if the opponent's offer is active → resolve draw; else set the sender's offer active + broadcast.
- Client→server `match.drawRevoke` — payload `Record<string, never>`. Clears the sender's offer + broadcast.
- Server→client: `drawOffer: { [playerId]: boolean }` (or `offeredBy: PlayerId[]`) in the broadcast match/chess view — public; both clients render it.
- Terminal: existing `{ type: 'draw' }` outcome → existing chess draw settlement.
- Keep core generic (plug-in invariant — no `if (gameId === 'chess')`). Chess declares a "supports draw offers" capability; core routes generically. Chess opts in only.

## Server / module (`apps/server` + chess module)

- Match holds a per-player offer flag (+ move-count-since-offer if the backstop expiry is kept).
- `drawOffer`: validate active match + sender is a participant. If opponent flag set → resolve draw; else set sender flag + broadcast.
- `drawRevoke`: clear sender flag + broadcast.
- (If backstop kept) on the offerer's ply, increment; at N clear + broadcast.
- All transitions server-authoritative; client state is presentational.

## Client (`apps/web`)

- **New GameHub hook `renderSecondaryAction(args)`** (mirror of `renderPrimaryAction` @140/463) to override the Play-a-Friend button in-match — this hook does not exist yet. Idle/result → default Play a Friend; chess supplies `Draw request` ⇄ `Revoke DRAW`.
- **Indicator:** render the amber "Draw offered" indicator on the offering player's slot (via the slot aside / bar), keyed off the public `drawOffer` view state so it appears on both screens next to that player's name.
- Pressing *Draw request* dispatches `drawOffer`; if the opponent already offered, the server returns the draw terminal (existing result path renders). Pressing *Revoke DRAW* dispatches `drawRevoke`.

## Tokens

Reuse the existing draw hue (`amber-400`, `slotReveal.tsx:48`) for the "Draw offered" indicator; recommend tokenizing it (`--draw` = `#fbbf24`). Result treatment unchanged. No hardcoded hex.

## PR sequence

1. **This spec** — Owner-approved (protocol change).
2. **Protocol PR** (owner-gated): `match.drawOffer` / `match.drawRevoke` + `drawOffer` view field + chess capability flag.
3. **Server/module PR**: per-player offer flags, both-offered→draw via existing settlement, optional backstop expiry.
4. **Client PR**: `renderSecondaryAction` hook + `Draw request`⇄`Revoke DRAW` + "Draw offered" indicator + `--draw` token.

## Acceptance criteria

- Play a Friend ⇄ Draw request only during an active match; idle/result show Play a Friend.
- Pressing Draw request offers immediately and flips the button to Revoke DRAW; a "Draw offered" indicator shows on the offerer's bar on **both** screens.
- Pressing Draw request while the opponent's offer is pending draws the game at once; both offers simultaneously = draw.
- Revoke clears only your own offer.
- Draw terminal = stakes returned, no rake, no rematch, amber/orange popup + amber/orange bar outlines (existing chess draw path).
- Decisive result supersedes pending offers. Server-authoritative throughout; offer state public (no redaction issue). Only tokens, no hardcoded hex; core stays generic (no chess special-casing).
