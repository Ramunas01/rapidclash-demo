// Entry point for the demo bot crowd (ADR-010).
//
// ⚠ DEMO-ONLY. These are clearly-labelled (🤖) ordinary clients on the public
// REST+WS API — there is no "play the house" path in the core, so invariant #1
// ("humans vs humans, never the house") stays mechanically true. Never run this as
// a production liquidity mechanism. See docs/DEMO_PRESENTATION.md and ADR-010.

import { config, ROSTER } from './config.js';
import { makeApi } from './http.js';
import { Bot, type AdminTokenProvider } from './bot.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const api = makeApi(config.serverUrl);

  console.log(`🤖 bot-crowd → ${config.serverUrl} (${ROSTER.length} bots)`);
  console.log('   DEMO-ONLY (ADR-010): bots are ordinary 🤖-labelled clients; never production liquidity.\n');

  // Optional shared admin token for top-ups. If login fails (wrong/unset password),
  // the bots simply run on their signup grant until it is exhausted.
  let adminToken: string | null = null;
  try {
    const res = await api.login({ username: config.admin.username, password: config.admin.password });
    adminToken = res.token;
    console.log(`admin login OK — top-ups enabled (threshold: stake × ${config.lowBalanceFactor})\n`);
  } catch {
    console.log('admin login failed — top-ups disabled; bots run on their signup grant\n');
  }
  const getAdminToken: AdminTokenProvider = () => adminToken;

  const bots = ROSTER.map((cfg) => new Bot(cfg, api, getAdminToken));

  // Bring bots online staggered so a single max-instances=1 server is never hit by a
  // thundering herd of registrations/connections.
  for (const bot of bots) {
    try {
      await bot.start();
    } catch (err) {
      console.error(`failed to start a bot: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(config.startStaggerMs);
  }

  console.log('\nAll bots online. Open challenges should now be visible in the lobby. Ctrl-C to stop.\n');

  const shutdown = () => {
    console.log('\nshutting down — clearing resting challenges…');
    for (const bot of bots) bot.shutdown();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('bot-crowd fatal:', err);
  process.exit(1);
});
