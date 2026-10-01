import type { FastifyInstance } from 'fastify';
import type { Identity } from '@rapidclash/core';
import { getAllBalances } from '@rapidclash/core';
import type { AuthResponse } from '@rapidclash/shared';
import type { GuestServices } from '../guest/index.js';
import { mintGuestId } from '../guest/index.js';

// 5/minute/IP (issue #270): a real visitor clicking "Play as guest" once, or reloading a
// few times, stays well under this; a scripted hammer minting sessions in a loop does not.
// Requires @fastify/rate-limit registered with `global: false` (server.ts) so this `config`
// is the only route it applies to — every other route is untouched.
const GUEST_AUTH_RATE_LIMIT_MAX = 5;
const GUEST_AUTH_RATE_LIMIT_WINDOW = '1 minute';

/**
 * `POST /auth/guest` — mints a new, isolated, anonymous guest session. No form fields, no
 * accounts-table row: `identity.signGuestToken` is a pure `jwt.sign` (identity.ts's own
 * guarantee) and `guest.ledger` is the in-memory ephemeral ledger from
 * `apps/server/src/guest/index.ts` — neither writes to the real `accounts`/`ledger_entry`
 * tables. Contract-touching (new endpoint) — see PROTOCOL.md; Owner-gated per issue #267.
 */
export function registerGuestAuthRoutes(app: FastifyInstance, identity: Identity, guest: GuestServices): void {
  app.post(
    '/auth/guest',
    {
      config: {
        rateLimit: {
          max: GUEST_AUTH_RATE_LIMIT_MAX,
          timeWindow: GUEST_AUTH_RATE_LIMIT_WINDOW,
        },
      },
    },
    async (_request, reply) => {
      const playerId = mintGuestId();
      guest.ledger.grant(playerId);
      // Ticket 2026-09-27#7 (D69): PR 3 — full balances map (guest's grant() still only ever
      // seeds USD, per ephemeral-ledger.ts's own top doc comment, so every other currency reads
      // 0 here — that's the correct, intentional value, not a placeholder).
      const balances = getAllBalances(guest.ledger, playerId);
      const token = identity.signGuestToken(playerId);
      const body: AuthResponse = {
        token,
        playerId,
        balances,
        username: 'Guest',
        avatarId: 'default',
        isGuest: true,
        role: 'guest',
      };
      reply.code(201).send(body);
    },
  );
}
