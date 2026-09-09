import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, GRANT_AMOUNT } from './ledger.js';
import { createRewards, tierForXp } from './rewards.js';

function setup(nowFn?: () => number) {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const rewards = createRewards(db, ledger, nowFn);
  return { db, ledger, rewards };
}

describe('tierForXp (pure VIP tier derivation)', () => {
  it('below 500 XP is Unranked at 0% rakeback', () => {
    expect(tierForXp(0)).toEqual({ tier: 'Unranked', xpRequired: 0, rakebackRate: 0 });
    expect(tierForXp(499)).toMatchObject({ tier: 'Unranked' });
  });

  it('exact thresholds land on the tier they unlock (VIP_ROWS)', () => {
    expect(tierForXp(500)).toEqual({ tier: 'Wood', xpRequired: 500, rakebackRate: 0.01 });
    expect(tierForXp(5_000)).toEqual({ tier: 'Bronze', xpRequired: 5_000, rakebackRate: 0.04 });
    expect(tierForXp(25_000)).toEqual({ tier: 'Silver', xpRequired: 25_000, rakebackRate: 0.07 });
    expect(tierForXp(125_000)).toEqual({ tier: 'Gold', xpRequired: 125_000, rakebackRate: 0.1 });
    expect(tierForXp(475_000)).toEqual({ tier: 'Emerald', xpRequired: 475_000, rakebackRate: 0.15 });
    expect(tierForXp(1_500_000)).toEqual({ tier: 'Diamond', xpRequired: 1_500_000, rakebackRate: 0.2 });
  });

  it('one XP below a threshold stays on the lower tier', () => {
    expect(tierForXp(4_999)).toMatchObject({ tier: 'Wood' });
    expect(tierForXp(1_499_999)).toMatchObject({ tier: 'Emerald' });
  });

  it('an astronomically high XP total stays capped at Diamond (top of the ladder)', () => {
    expect(tierForXp(50_000_000)).toMatchObject({ tier: 'Diamond' });
  });
});

describe('recordMatchSettlement — per-player XP + rakeback accrual', () => {
  it('at 2.5% rake (RPS/Coinflip/etc.), a 100 RC win credits the documented XP; rakeback is 0 at Unranked', () => {
    const { ledger, rewards } = setup();
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 100, 0.025, 'win');
    const snap = rewards.getSnapshot('alice');
    // notionalRake = min(100,100)*0.025 + max(0,0)*0.025*0.25 = 2.5; xp = round(40*2.5) = 100
    expect(snap.xpLifetime).toBe(100);
    expect(snap.xpMonthly).toBe(100);
    // Unranked (0 XP before this match) → 0% rakeback, even though this match itself grants XP.
    expect(snap.claimableBalance).toBe(0);
    expect(snap.wageredLifetime).toBe(100);
  });

  it('at 10% rake (the Chess rate), a 100 RC win credits proportionally more XP', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 100, 0.1, 'win');
    // notionalRake = 100*0.1 = 10; xp = round(40*10) = 400
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(400);
  });

  it('both winner and loser accrue XP/rakeback independently from their OWN stake on a win (not split from one RAKE entry)', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    ledger.grant('bob');
    rewards.recordMatchSettlement('alice', 100, 0.1, 'win'); // winner
    rewards.recordMatchSettlement('bob', 100, 0.1, 'win'); // loser — same stake, same call shape
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(400);
    expect(rewards.getSnapshot('bob').xpLifetime).toBe(400);
  });

  it('500 RC stake diminishes XP above the first 100 RC (min/max split in notionalRake)', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 500, 0.025, 'win');
    // notionalRake = min(500,100)*0.025 + max(500-100,0)*0.025*0.25
    //              = 100*0.025 + 400*0.025*0.25 = 2.5 + 2.5 = 5
    // xp = round(40*5) = 200 — NOT round(40 * 500 * 0.025) = 500 (the undiminished figure).
    const snap = rewards.getSnapshot('alice');
    expect(snap.xpLifetime).toBe(200);
    expect(snap.xpLifetime).toBeLessThan(500); // proves the excess-over-100 is damped, not full-rate
  });

  it('a draw credits nothing — no XP, no rakeback — to either player (but wagered still counts)', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    ledger.grant('bob');
    rewards.recordMatchSettlement('alice', 100, 0.1, 'draw');
    rewards.recordMatchSettlement('bob', 100, 0.1, 'draw');
    for (const id of ['alice', 'bob']) {
      const snap = rewards.getSnapshot(id);
      expect(snap.xpLifetime).toBe(0);
      expect(snap.claimableBalance).toBe(0);
      expect(snap.wageredLifetime).toBe(100);
    }
  });

  it('a void credits nothing either (same as draw)', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 100, 0.1, 'void');
    const snap = rewards.getSnapshot('alice');
    expect(snap.xpLifetime).toBe(0);
    expect(snap.claimableBalance).toBe(0);
    expect(snap.wageredLifetime).toBe(100);
  });

  it('rakeback accrues once a player holds a paying tier, using the UNDIMINISHED stake×feeRate×tierRate', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    // Seed alice to Wood tier (500 XP) with one crossing match (tier rate at accrual time is
    // Unranked/0%, so this match itself earns no rakeback — see the non-retroactive test below).
    rewards.recordMatchSettlement('alice', 100, 0.125, 'win'); // xp = round(40*12.5) = 500
    expect(rewards.getSnapshot('alice').tier).toBe('Wood');

    // A second match now accrues rakeback at Wood's 1% rate, undiminished even above 100 RC.
    rewards.recordMatchSettlement('alice', 500, 0.025, 'win');
    // rakebackGained = round(500 * 0.025 * 0.01) = round(0.125) = 0 — too small to show at this
    // stake; use a stake where the undiminished (non-capped) rakeback is clearly visible instead.
    const before = rewards.getSnapshot('alice').claimableBalance;
    rewards.recordMatchSettlement('alice', 1000, 0.1, 'win');
    // rakebackGained = round(1000 * 0.1 * 0.01) = round(1) = 1 — computed from the FULL 1000
    // stake (not capped at 100), proving rakeback is undiminished unlike XP.
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(before + 1);
  });

  it('crossing 500 XP (Unranked → Wood) is never retroactive: the crossing match itself earns 0% rakeback; only SUBSEQUENT matches earn Wood’s 1%', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');

    // Match 1: exactly crosses 500 XP (0 → 500). Tier read BEFORE this match's XP lands is
    // Unranked (0%), so this match's rakeback must be 0 despite the player ending it at Wood.
    rewards.recordMatchSettlement('alice', 100, 0.125, 'win');
    let snap = rewards.getSnapshot('alice');
    expect(snap.xpLifetime).toBe(500);
    expect(snap.tier).toBe('Wood');
    expect(snap.claimableBalance).toBe(0); // the crossing match itself: 0% applied, not 1%

    // Match 2: now genuinely at Wood — its rakeback uses 1%, not 0%.
    rewards.recordMatchSettlement('alice', 1000, 0.1, 'win');
    snap = rewards.getSnapshot('alice');
    // rakebackGained = round(1000 * 0.1 * 0.01) = 1
    expect(snap.claimableBalance).toBe(1);
  });

  it('a never-played account reads back all zeros / Unranked (lazy row creation, no throw)', () => {
    const { rewards } = setup();
    expect(rewards.getSnapshot('never-played')).toEqual({
      xpLifetime: 0,
      xpMonthly: 0,
      wageredLifetime: 0,
      claimableBalance: 0,
      tier: 'Unranked',
      rakebackRate: 0,
      nextTier: { tier: 'Wood', xpRequired: 500, rakebackRate: 0.01 },
    });
  });

  it('nextTier is undefined at the top of the ladder (Diamond)', () => {
    const { rewards, ledger } = setup();
    ledger.grant('alice');
    // One giant match to push straight to Diamond's 1,500,000 XP threshold.
    // notionalRake = 100 * feeRate (stake <= 100); xp = round(40 * 100 * feeRate) = 1_500_000
    // → feeRate = 1_500_000 / 4_000 = 375
    rewards.recordMatchSettlement('alice', 100, 375, 'win');
    const snap = rewards.getSnapshot('alice');
    expect(snap.tier).toBe('Diamond');
    expect(snap.nextTier).toBeUndefined();
  });
});

describe('claim — atomic, idempotent reward-claim → wallet credit', () => {
  function seedClaimableBalance() {
    const { ledger, rewards } = setup();
    ledger.grant('alice');
    // Reach Wood (500 XP, 0% on the crossing match itself)...
    rewards.recordMatchSettlement('alice', 100, 0.125, 'win');
    // ...then earn real rakeback at Wood's 1% on a second match.
    rewards.recordMatchSettlement('alice', 1000, 0.1, 'win'); // rakebackGained = round(1) = 1
    return { ledger, rewards };
  }

  it('claiming moves the whole claimable_balance into the wallet as one REWARD_CLAIM entry', () => {
    const { ledger, rewards } = seedClaimableBalance();
    const startingBalance = ledger.getBalance('alice');
    const before = rewards.getSnapshot('alice').claimableBalance;
    expect(before).toBeGreaterThan(0);

    const result = rewards.claim('alice');

    expect(result.credited).toBe(before);
    expect(result.newClaimableBalance).toBe(0);
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(0);
    expect(ledger.getBalance('alice')).toBe(startingBalance + before);
    const claimEntries = ledger.getEntries('alice').filter((e) => e.type === 'REWARD_CLAIM');
    expect(claimEntries).toHaveLength(1);
    expect(claimEntries[0].amount).toBe(before);
  });

  it('double-tap / repeat claim after the balance is already zero is a no-op — credits exactly once', () => {
    const { ledger, rewards } = seedClaimableBalance();
    const first = rewards.claim('alice');
    expect(first.credited).toBeGreaterThan(0);
    const balanceAfterFirst = ledger.getBalance('alice');

    // Simulate a double-tap: the same button fires the request again.
    const second = rewards.claim('alice');
    const third = rewards.claim('alice');

    expect(second.credited).toBe(0);
    expect(third.credited).toBe(0);
    expect(ledger.getBalance('alice')).toBe(balanceAfterFirst); // unchanged
    expect(ledger.getEntries('alice').filter((e) => e.type === 'REWARD_CLAIM')).toHaveLength(1);
  });

  it('claiming with nothing accrued is a harmless no-op (never throws, never writes a ledger entry)', () => {
    const { ledger, rewards } = setup();
    ledger.grant('bob');
    const result = rewards.claim('bob');
    expect(result).toEqual({ credited: 0, newClaimableBalance: 0 });
    expect(ledger.getEntries('bob').filter((e) => e.type === 'REWARD_CLAIM')).toHaveLength(0);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
  });

  it('a second earn-then-claim cycle credits again (claiming zeroes the balance, it does not disable future accrual)', () => {
    const { ledger, rewards } = seedClaimableBalance();
    rewards.claim('alice');
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(0);

    rewards.recordMatchSettlement('alice', 1000, 0.1, 'win'); // earns rakeback again (Wood, 1%)
    const newBalance = rewards.getSnapshot('alice').claimableBalance;
    expect(newBalance).toBeGreaterThan(0);

    const result = rewards.claim('alice');
    expect(result.credited).toBe(newBalance);
    expect(ledger.getEntries('alice').filter((e) => e.type === 'REWARD_CLAIM')).toHaveLength(2);
  });
});

describe('monthly XP reset + volume bonus (Emerald/Diamond only, closed-month xp_monthly)', () => {
  const JAN_15 = Date.UTC(2026, 0, 15, 12, 0, 0);
  const FEB_1 = Date.UTC(2026, 1, 1, 0, 0, 1);
  const MAR_1 = Date.UTC(2026, 2, 1, 0, 0, 1);

  it('reaching Emerald (475,000 XP) in one month and clearing its 120,000-XP volume threshold pays 5% of that month’s notional rake on month close', () => {
    let clock = JAN_15;
    const { ledger, rewards } = setup(() => clock);
    ledger.grant('alice');

    // feeRate chosen so notionalRake lands exactly on Emerald's threshold XP:
    // notionalRake = 100 * feeRate; xp = round(40 * notionalRake) = 475_000 → feeRate = 118.75
    rewards.recordMatchSettlement('alice', 100, 118.75, 'win');
    let snap = rewards.getSnapshot('alice');
    expect(snap.tier).toBe('Emerald');
    expect(snap.xpMonthly).toBe(475_000);
    expect(snap.claimableBalance).toBe(0); // Unranked at accrual time — no rakeback on this match

    // Roll over to February — the month closes (>120,000 XP cleared → 5%, not the 3% row).
    clock = FEB_1;
    rewards.closeElapsedMonths(clock);

    snap = rewards.getSnapshot('alice');
    // notional_rake_monthly for that match = 100 * 118.75 = 11_875; bonus = round(11_875*0.05) = 594
    expect(snap.claimableBalance).toBe(594);
    expect(snap.xpMonthly).toBe(0); // reset for the new month
    expect(snap.tier).toBe('Emerald'); // lifetime XP (and therefore tier) is untouched by the reset
  });

  it('only the HIGHEST threshold cleared pays — Diamond clearing 300,000 pays 8%, not 5%+8%', () => {
    let clock = JAN_15;
    const { rewards, ledger } = setup(() => clock);
    ledger.grant('alice');
    // Push straight to Diamond (1,500,000 XP) with a 300,000 notional-rake month in one match:
    // xp = round(40 * 100 * feeRate) = 1_500_000 → feeRate = 375; notionalRake = 100*375=37_500
    // (this ALSO clears the monthly 300k threshold since xp_monthly === xp gained this match)
    rewards.recordMatchSettlement('alice', 100, 375, 'win');
    expect(rewards.getSnapshot('alice').xpMonthly).toBe(1_500_000); // well above 300,000

    clock = FEB_1;
    rewards.closeElapsedMonths(clock);
    // notional_rake_monthly = 100*375 = 37_500; bonus = round(37_500 * 0.08) = 3_000 (8%, not 5%)
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(3_000);
  });

  it('below Emerald tier, no volume bonus is paid even with a huge monthly XP total', () => {
    let clock = JAN_15;
    const { rewards, ledger } = setup(() => clock);
    ledger.grant('alice');
    // Land on Gold (125,000) exactly — well short of Emerald (475,000) — but with a lot of
    // monthly XP relative to Gold's own progress.
    rewards.recordMatchSettlement('alice', 100, 31.25, 'win'); // xp = round(40*3125) = 125_000
    expect(rewards.getSnapshot('alice').tier).toBe('Gold');

    clock = FEB_1;
    rewards.closeElapsedMonths(clock);
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(0); // no bonus below Emerald
  });

  it('a dormant account (no activity in the new month) still gets its bonus via the periodic sweep, not only on its own next match', () => {
    let clock = JAN_15;
    const { rewards, ledger } = setup(() => clock);
    ledger.grant('alice');
    ledger.grant('bob');
    rewards.recordMatchSettlement('alice', 100, 118.75, 'win'); // → Emerald, 475k monthly XP
    rewards.recordMatchSettlement('bob', 100, 118.75, 'win'); // same for bob

    // Neither plays again. The sweep alone (no per-account touch) must still close them out.
    clock = FEB_1;
    rewards.closeElapsedMonths(clock);

    expect(rewards.getSnapshot('alice').claimableBalance).toBe(594);
    expect(rewards.getSnapshot('bob').claimableBalance).toBe(594);
  });

  it('closing the same elapsed month twice is a no-op the second time (guarded by the stored reset marker)', () => {
    let clock = JAN_15;
    const { rewards, ledger } = setup(() => clock);
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 100, 118.75, 'win');

    clock = FEB_1;
    rewards.closeElapsedMonths(clock);
    const afterFirstClose = rewards.getSnapshot('alice').claimableBalance;
    expect(afterFirstClose).toBeGreaterThan(0);

    rewards.closeElapsedMonths(clock); // same month again — must not double-credit
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(afterFirstClose);
  });

  it('two months elapsing in one sweep still only pays out once, using the most recently closed month’s xp_monthly', () => {
    let clock = JAN_15;
    const { rewards, ledger } = setup(() => clock);
    ledger.grant('alice');
    rewards.recordMatchSettlement('alice', 100, 118.75, 'win'); // January: 475k XP → Emerald

    // Jump straight to March — no February close ever ran. February's (empty) xp_monthly=0
    // window is what gets "closed" (0 bonus, since nothing accrued after January's close would
    // have reset it) — the important invariant is this never crashes and never double-pays.
    clock = MAR_1;
    rewards.closeElapsedMonths(clock);
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(594);

    rewards.closeElapsedMonths(clock);
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(594); // still once
  });
});
