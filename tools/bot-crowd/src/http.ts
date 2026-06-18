// REST client for the bots — the same endpoints apps/web/src/api.ts uses, adapted
// for Node (absolute base URL, global fetch on Node 18+) plus the admin credit
// endpoint for optional top-ups. Reuses the shared wire types.

import type {
  AdminCreditBody,
  AuthRegisterBody,
  AuthLoginBody,
  AuthResponse,
  LedgerEntry,
  WalletResponse,
} from '@rapidclash/shared';

/** Error carrying the HTTP status so callers can branch (e.g. 409 → already registered). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function req<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new HttpError(res.status, err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function makeApi(baseUrl: string) {
  return {
    register: (body: AuthRegisterBody) => req<AuthResponse>(baseUrl, 'POST', '/auth/register', body),
    login: (body: AuthLoginBody) => req<AuthResponse>(baseUrl, 'POST', '/auth/login', body),
    wallet: (token: string) => req<WalletResponse>(baseUrl, 'GET', '/wallet', undefined, token),
    adminCredit: (playerId: string, body: AdminCreditBody, adminToken: string) =>
      req<LedgerEntry>(baseUrl, 'POST', `/admin/players/${playerId}/credit`, body, adminToken),
  };
}

export type Api = ReturnType<typeof makeApi>;
