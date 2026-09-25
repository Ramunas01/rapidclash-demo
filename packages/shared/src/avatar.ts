// packages/shared/src/avatar.ts
// Ticket 2026-09-25#6 (ADVISOR_TO_PM.md): the name→avatar hash formula, shared between the client
// (GameHub.tsx's OpponentSlot, during the matchmaking-search scramble) and the server (gateway.ts's
// simulated-opponent avatar fallback) — same reasoning as guest.ts's own file header: neither side
// may hardcode a value the other must match, or a simulated opponent's avatar would flicker during
// search then jump to a DIFFERENT face the instant the match forms, instead of settling on the same
// one. Previously two independently-maintained copies risked drifting; this is the single source.
import { AVATAR_IDS, type AvatarId } from './protocol.js';

/** The prototype's own `avForName` hash formula, verified directly against its own source
 *  (`Full Spec.html:3132-3136`): `h = (h*31 + charCode) | 0` accumulated over the name. Deliberately
 *  a separate function from any generic string hash used elsewhere (e.g. the client's own per-user
 *  hue derivation) — this one is cited by the ticket specifically by name and exact formula, not
 *  "close enough" to an existing hash; a future consolidation would be a real behavior change (a
 *  different hash reassigns every name to a different avatar), not a refactor. */
export function avForNameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return h;
}

/** Deterministically hashes a name into one of the real (non-`'default'`) `AvatarId` presets,
 *  matching the prototype's own `avId(n) = 'rc-' + ((abs(n) % 24) + 1)`. The SAME name always
 *  hashes to the SAME preset (not random per call) — that determinism is the entire point: it's
 *  what lets a simulated opponent's avatar cohere across the search-scramble → settled-match
 *  boundary, and what lets `AVATAR_IDS`' own declared order double as the canonical pool ordering
 *  (index 0 = `rc-01`, matching the prototype's own 1-indexed `+1`) rather than depending on
 *  whatever order a caller's own asset-mapping object happens to iterate in. */
export function avatarIdForName(name: string): Exclude<AvatarId, 'default'> {
  const ids = AVATAR_IDS.filter((id): id is Exclude<AvatarId, 'default'> => id !== 'default');
  return ids[Math.abs(avForNameHash(name)) % ids.length];
}

/** Ticket 2026-09-25#6, Part 1: strips a leading 🤖 disclosure emoji and any leading `@` from a
 *  raw stored username/scan name — the client's `GameHub.tsx` OpponentSlot uses this for DISPLAY
 *  (the settled-state name and the searching-state scan text each carry a different half of the
 *  "🤖 @name" bug, confirmed by reading both sites directly); the server's own `gateway.ts` uses
 *  the identical function to get the BARE name to feed `avatarIdForName`'s hash for a simulated
 *  opponent's avatar fallback. One shared function so the two can never drift — if they stripped
 *  differently, the server's fallback avatar and the client's own decorative search-scramble hash
 *  could disagree on what "the bare name" even is. Deliberately NOT touching `displayHostName`
 *  (`GamesCarousel.tsx`'s own ADR-010 stripper) or `ProfileHub.tsx`'s own picker-side equivalent —
 *  both are correct for their own callers, which deliberately keep the `@` convention; this is a
 *  new, narrower helper for the one surface (the opponent bar) that deliberately doesn't. */
export function stripBotDisclosure(name: string): string {
  return name.replace(/^🤖\s*/, '').replace(/^@/, '');
}
