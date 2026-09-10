import type { AuthRegisterBody, AuthLoginBody, AuthResponse, WalletResponse, GameMeta, LeaderboardEntry, PublicOpenChallenge, AvatarId, SetAvatarResponse, RewardsSnapshot, RewardsClaimResponse, RecentMatchesResponse } from '@rapidclash/shared';

const BASE = import.meta.env.VITE_API_URL ?? '';

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  register: (body: AuthRegisterBody) =>
    req<AuthResponse>('POST', '/auth/register', body),
  login: (body: AuthLoginBody) =>
    req<AuthResponse>('POST', '/auth/login', body),
  /** No form fields — mints a fresh, isolated, anonymous guest session (CHARTER.md's guest-mode
   *  exception). Response is AuthResponse-shaped with `isGuest: true`. Body is an explicit `{}`,
   *  not omitted: `req` always sends `Content-Type: application/json`, and a real `fetch()` with
   *  that header but no body is a zero-length body Fastify's JSON parser rejects (400) — the only
   *  body-less POST in this file otherwise. `app.inject()` in tests doesn't set the header without
   *  a payload, so this exact gap doesn't reproduce there unless the header is forced (see the
   *  regression test in guest.gateway.test.ts). */
  guestAuth: () =>
    req<AuthResponse>('POST', '/auth/guest', {}),
  wallet: (token: string) =>
    req<WalletResponse>('GET', '/wallet', undefined, token),
  games: (token: string) =>
    req<GameMeta[]>('GET', '/games', undefined, token),
  /** Public cross-game snapshot of resting open challenges — no token (the logged-out ticker). */
  openChallenges: () =>
    req<PublicOpenChallenge[]>('GET', '/open-challenges'),
  /** Guest-scoped snapshot of the ISOLATED guest world's currently-resting Demo-Opponent
   *  bot-waiters (issue #354, `apps/server/src/routes/guest-open-challenges.ts`) — never the real
   *  aggregate above. No token: the data is identical for every guest session (the shared bot
   *  pools), not viewer-specific — same no-auth shape as `openChallenges`. */
  guestOpenChallenges: () =>
    req<PublicOpenChallenge[]>('GET', '/guest/open-challenges'),
  leaderboard: (gameId: string, token: string) =>
    req<LeaderboardEntry[]>('GET', `/leaderboard/${gameId}`, undefined, token),
  /** Games-hero "Popularity" sort (issue #465) — all-time settled-match count per gameId, keyed
   *  by gameId; a game with no settled matches is simply absent from the map. Public, no token. */
  gamePopularity: () =>
    req<Record<string, number>>('GET', '/games/popularity'),
  /** Set the signed-in player's OWN avatar (presets-only). Auth-required; the server validates
   *  the id and only ever mutates the token-holder's avatar. */
  setAvatar: (avatarId: AvatarId, token: string) =>
    req<SetAvatarResponse>('POST', '/auth/avatar', { avatarId }, token),
  /** The signed-in player's OWN derived rewards snapshot (issue #306/#307) — XP, tier, rakeback
   *  rate, progress to next tier, claimable balance. All computed server-side; the client never
   *  derives any of it itself. */
  rewards: (token: string) =>
    req<RewardsSnapshot>('GET', '/rewards', undefined, token),
  /** Claim the player's OWN whole claimable balance. Idempotent — a repeat call after the
   *  balance is already zero returns `{ credited: 0, newClaimableBalance: 0 }`, not an error. */
  claimRewards: (token: string) =>
    req<RewardsClaimResponse>('POST', '/rewards/claim', {}, token),
  /** The signed-in player's OWN recent match history (issue #400) — opponent, outcome, net
   *  delta, timestamp, newest-settled-first. Backs the redesigned Account page's "recent
   *  games" list (a later, separate ticket wires up the actual UI consumer). `limit`/`offset`
   *  mirror the server's query params; both optional (server applies its own default/cap). */
  recentMatches: (token: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return req<RecentMatchesResponse>('GET', `/matches/recent${qs ? `?${qs}` : ''}`, undefined, token);
  },
};
