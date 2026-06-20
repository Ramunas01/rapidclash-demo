import type { AuthRegisterBody, AuthLoginBody, AuthResponse, WalletResponse, GameMeta, LeaderboardEntry, PublicOpenChallenge } from '@rapidclash/shared';

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
  wallet: (token: string) =>
    req<WalletResponse>('GET', '/wallet', undefined, token),
  games: (token: string) =>
    req<GameMeta[]>('GET', '/games', undefined, token),
  /** Public cross-game snapshot of resting open challenges — no token (the logged-out ticker). */
  openChallenges: () =>
    req<PublicOpenChallenge[]>('GET', '/open-challenges'),
  leaderboard: (gameId: string, token: string) =>
    req<LeaderboardEntry[]>('GET', `/leaderboard/${gameId}`, undefined, token),
};
