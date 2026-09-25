import type { CSSProperties } from 'react';
import type { AvatarId } from '@rapidclash/shared';
import { avatarIdForName as avatarIdForNameShared } from '@rapidclash/shared';
import { cn } from '@/lib/utils';
import rc01 from '../../assets/avatars/rc-01.png';
import rc02 from '../../assets/avatars/rc-02.png';
import rc03 from '../../assets/avatars/rc-03.png';
import rc04 from '../../assets/avatars/rc-04.png';
import rc05 from '../../assets/avatars/rc-05.png';
import rc06 from '../../assets/avatars/rc-06.png';
import rc07 from '../../assets/avatars/rc-07.png';
import rc08 from '../../assets/avatars/rc-08.png';
import rc09 from '../../assets/avatars/rc-09.png';
import rc10 from '../../assets/avatars/rc-10.png';
import rc11 from '../../assets/avatars/rc-11.png';
import rc12 from '../../assets/avatars/rc-12.png';
import rc13 from '../../assets/avatars/rc-13.png';
import rc14 from '../../assets/avatars/rc-14.png';
import rc15 from '../../assets/avatars/rc-15.png';
import rc16 from '../../assets/avatars/rc-16.png';
import rc17 from '../../assets/avatars/rc-17.png';
import rc18 from '../../assets/avatars/rc-18.png';
import rc19 from '../../assets/avatars/rc-19.png';
import rc20 from '../../assets/avatars/rc-20.png';
import rc21 from '../../assets/avatars/rc-21.png';
import rc22 from '../../assets/avatars/rc-22.png';
import rc23 from '../../assets/avatars/rc-23.png';
import rc24 from '../../assets/avatars/rc-24.png';

/** `AvatarId` is the canonical shared contract type (`@rapidclash/shared`) — the single source of
 *  truth for client + server. Re-exported here so existing `Avatar`-relative imports keep working.
 *  `'default'` = the derived disc + person glyph; the ten `rc-01`-`rc-10` presets map to bundled
 *  images below (ticket 2026-09-13#7 items 1+2 — the Designer's own official export, retiring the
 *  six previously-named presets; see `assets/avatars/CREDITS.md`). */
export type { AvatarId };

/** avatarId → preset PNG — the Designer's own `rc-01`-`rc-10` export (see CREDITS.md). Exported
 *  so `ProfileHub.tsx`'s inline avatar-picker strip can render each preset tile's own
 *  `background-image` directly (the prototype's own div-based tile, ticket 2026-09-13#7 item 2b) —
 *  a single source of truth for the id→asset mapping, not a second enumeration of the same ten
 *  imports. */
export const PRESETS: Record<Exclude<AvatarId, 'default'>, string> = {
  'rc-01': rc01,
  'rc-02': rc02,
  'rc-03': rc03,
  'rc-04': rc04,
  'rc-05': rc05,
  'rc-06': rc06,
  'rc-07': rc07,
  'rc-08': rc08,
  'rc-09': rc09,
  'rc-10': rc10,
  'rc-11': rc11,
  'rc-12': rc12,
  'rc-13': rc13,
  'rc-14': rc14,
  'rc-15': rc15,
  'rc-16': rc16,
  'rc-17': rc17,
  'rc-18': rc18,
  'rc-19': rc19,
  'rc-20': rc20,
  'rc-21': rc21,
  'rc-22': rc22,
  'rc-23': rc23,
  'rc-24': rc24,
};

/** djb2 — a tiny, deterministic, dependency-free string hash. Stable across sessions/machines so a
 *  given username always maps to the same disc colour (the colour is DERIVED, never stored). */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A fixed, desaturated light disc for the NEUTRAL/redacted mode (no username) — visually distinct
 *  from the colourful per-user discs so an anonymous slot (the in-match opponent) reads as anonymous. */
const NEUTRAL_DISC = 'hsl(230, 10%, 88%)';
/** Fixed slate glyph for NEUTRAL mode (a darkened silhouette — white would vanish on the light disc). */
const NEUTRAL_GLYPH = '#3c4054';

/** Per-user LIGHT disc: same hue as the glyph, high lightness so a darkened glyph reads on top. */
export function discColor(username?: string | null): string {
  if (!username) return NEUTRAL_DISC;
  return `hsl(${hashStr(username) % 360}, 55%, 90%)`;
}
/** Per-user darkened glyph: same hue as the disc, low lightness so the silhouette stays legible. */
export function glyphColor(username?: string | null): string {
  if (!username) return NEUTRAL_GLYPH;
  return `hsl(${hashStr(username) % 360}, 45%, 40%)`;
}

/** Ticket 2026-09-15#9 item 3, hash swapped by ticket 2026-09-25#6 (was the generic djb2 `hashStr`
 *  above, used for `discColor`/`glyphColor`'s per-user hue — now the prototype's own `avForName`
 *  formula, verified directly against `Full Spec.html:3132-3136`): hashes a name into one of the 24
 *  real presets. Re-exported from `@rapidclash/shared` (not a local implementation) — the SERVER
 *  needs the exact same hash for its own simulated-opponent avatar fallback (`gateway.ts`), and two
 *  independently-maintained copies would risk drifting; see that shared module's own doc comment
 *  for why that specifically matters here (a simulated opponent's avatar must settle on the SAME
 *  face once matched, not jump to a different one). Used by GameHub.tsx's OpponentSlot so the
 *  avatar flickers in sync with the scrambling scanned name during matchmaking search. Deterministic
 *  per name (the same name always hashes to the same preset), not random per render. */
export const avatarIdForName = avatarIdForNameShared;

/** The person silhouette (relocated from GameHub). Takes a colour via `style.color` / `className`
 *  (fill="currentColor") so it is never hardcoded white — the default glyph must darken on the
 *  light disc, so a fixed white fill would vanish. */
export function PersonGlyph({
  className,
  style,
  'data-testid': testId,
}: {
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} data-testid={testId} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export interface AvatarProps {
  /** Which avatar to render. Defaults to `'default'` (the derived disc + darkened glyph). */
  avatarId?: AvatarId;
  /** The user's display name — drives the per-user disc/glyph hue. `null`/`undefined` ⇒ NEUTRAL
   *  (redacted) mode: the fixed neutral disc + slate glyph (the in-match opponent). */
  username?: string | null;
  /** Diameter in px (the circular slot). Default 32 (the slot bar's `h-8 w-8`). */
  size?: number;
  className?: string;
}

/**
 * The one shared avatar, used everywhere a user is shown. Presentational/pure. A per-user LIGHT
 * disc colour is derived deterministically from the username (never stored); the default glyph is a
 * same-hue DARKENED silhouette (white would vanish on the light disc). NEUTRAL mode (no username) is
 * a fixed neutral disc + slate glyph for the redacted in-match opponent. A non-default `avatarId`
 * renders its preset PNG covering the disc (one of the ten `rc-01`-`rc-10` presets, selectable via
 * the Account page's inline avatar strip, ticket 2026-09-13#7).
 */
export function Avatar({ avatarId = 'default', username, size = 32, className }: AvatarProps) {
  const preset = avatarId !== 'default' ? PRESETS[avatarId] : null;
  const disc = discColor(username);
  const glyph = glyphColor(username);
  const glyphSize = Math.round(size * (18 / 32)); // keep the slot-bar glyph:disc proportion at parity
  return (
    <span
      data-testid="avatar"
      data-avatar-id={avatarId}
      data-disc={disc}
      data-glyph={preset ? undefined : glyph}
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-full', className)}
      style={{ width: size, height: size, backgroundColor: disc }}
    >
      {preset ? (
        <img
          data-testid="avatar-img"
          src={preset}
          alt=""
          aria-hidden="true"
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <PersonGlyph
          data-testid="avatar-glyph"
          style={{ width: glyphSize, height: glyphSize, color: glyph }}
        />
      )}
    </span>
  );
}
