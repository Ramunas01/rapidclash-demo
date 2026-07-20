import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import boyLight from '../../assets/avatars/avatar-boy-light.png';
import girlLight from '../../assets/avatars/avatar-girl-light.png';
import boyBrown from '../../assets/avatars/avatar-boy-brown.png';
import boyDark from '../../assets/avatars/avatar-boy-dark.png';

/** The avatar identity. `'default'` = the derived disc + person glyph (the only value used in this
 *  PR — no persistence yet, sub-split (ii) supplies the real ids). The four presets are wired but
 *  inert; extend this union when new presets land. */
export type AvatarId = 'default' | 'boy-light' | 'girl-light' | 'boy-brown' | 'boy-dark';

/** avatarId → preset PNG. Licence PENDING (see assets/avatars/CREDITS.md); inert until sub-split (ii). */
const PRESETS: Record<Exclude<AvatarId, 'default'>, string> = {
  'boy-light': boyLight,
  'girl-light': girlLight,
  'boy-brown': boyBrown,
  'boy-dark': boyDark,
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
 * renders its preset PNG covering the disc (inert in this PR — everyone is `'default'`).
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
