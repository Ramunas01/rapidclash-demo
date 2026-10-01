import type { FastifyInstance } from 'fastify';
import { GRANT_AMOUNT, type Identity, type Ledger, type MatchHistory } from '@rapidclash/core';
import type { AdminCreditBody, AdminPlayerLogResponse, AdminPlayerSummary } from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  ledger: Ledger,
  identity: Identity,
  matchHistory: MatchHistory,
  onWrite?: () => void,
): void {
  const { requireAuth, requireAdmin } = auth;
  const preHandler = [requireAuth, requireAdmin];

  // Ticket 2026-10-01#7: every account (Owner-confirmed: unfiltered by `source` — the frontend
  // owns any "demo-link only" filter toggle, not this endpoint). Guest sessions never reach here
  // at all (they never touch the `accounts` table — identity.ts's own signGuestToken doc comment).
  app.get('/admin/players', { preHandler }, async (_request, reply) => {
    const accounts = identity.listAccounts();
    const players: AdminPlayerSummary[] = accounts.map((a) => {
      const stats = matchHistory.getPlayerStats(a.id);
      return {
        playerId: a.id,
        displayName: a.username,
        source: a.source,
        balance: ledger.getBalance(a.id, 'USD'),
        ...stats,
      };
    });
    reply.code(200).send(players);
  });

  app.get<{ Params: { id: string } }>('/admin/players/:id/log', { preHandler }, async (request, reply) => {
    const { id } = request.params;
    if (!ledger.accountExists(id)) {
      return reply.code(404).send({ error: 'Player not found' });
    }
    // USD-only (matches AdminPlayerLogResponse's own doc comment and getFullMatchLog's own
    // scoping) — this admin view doesn't need multi-currency precision for a demo-activity tool.
    const body: AdminPlayerLogResponse = {
      matches: matchHistory.getFullMatchLog(id),
      ledgerEntries: ledger.getEntries(id).filter((e) => e.currency === 'USD'),
    };
    reply.code(200).send(body);
  });

  app.post<{ Params: { id: string }; Body: AdminCreditBody }>(
    '/admin/players/:id/credit',
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;
      const { amount, idempotencyKey } = request.body;

      if (!Number.isInteger(amount) || amount <= 0) {
        return reply.code(400).send({ error: 'amount must be a positive integer' });
      }

      if (!ledger.accountExists(id)) {
        return reply.code(404).send({ error: 'Player not found' });
      }

      // Ticket 2026-09-27#7 (D69): admin manual credit stays USD-only — not expanding the admin
      // tool's own scope to a currency-selectable feature.
      const entry = ledger.adminCredit(id, amount, idempotencyKey, 'USD');
      // Ledger write — durable-persistence gap (issue #378): fire on the success path only,
      // never from the 400/404 branches above.
      onWrite?.();
      return reply.code(200).send(entry);
    },
  );

  // Password-clear soft reset (ADR-011) — replaces the old remove-account delete.
  // Frees an alias for re-use while preserving the account's match history and
  // leaderboard standings. Steps run in order; each is idempotent on retry.
  app.post<{ Params: { id: string } }>(
    '/admin/players/:id/clear-password',
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;

      // The accounts table is the authority on existence (a player with no ledger
      // entries still exists), so resolve the alias up front and 404 if unknown.
      const username = identity.getUsername(id);
      if (username === undefined) {
        return reply.code(404).send({ error: 'Player not found' });
      }

      // Guard: never strand money in a pot. Refuse while the player is in a live
      // match or holds a resting open challenge (both keep an unsettled escrow).
      if (ledger.hasOpenEscrow(id)) {
        return reply
          .code(409)
          .send({ error: 'Player has an active match or escrowed stake; resolve it before clearing.' });
      }

      // Clear the password hash → the alias becomes re-claimable via /auth/register.
      identity.clearPassword(id);

      // Reset the wallet with a fresh starting grant. The ADMIN_CREDIT entry has a
      // NULL match_id, so it is excluded from net_winnings by construction (ADR-007)
      // — standings are untouched. The deterministic idempotency key makes a retry of
      // this reset a no-op (it never double-credits).
      // Ticket 2026-09-27#7 (D69): soft-reset re-grant deliberately stays USD-only, not
      // expanded to also restore the SOL/USDT starting balances — an admin-tool behavior
      // change beyond what this ticket asks for.
      ledger.adminCredit(id, GRANT_AMOUNT, `soft-reset:${id}`, 'USD');
      const newBalance = ledger.getBalance(id, 'USD');

      return reply.code(200).send({ playerId: id, username, newBalance });
    },
  );

  // The old remove-account delete (#14) is retired in favour of the soft reset above.
  // Left as a 501 stub — its delete-all semantics are intentionally not implemented.
  app.delete<{ Params: { id: string } }>('/admin/players/:id', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });
}
