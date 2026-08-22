import { useEffect, useState } from 'react';
import type { RewardsSnapshot, VipTier } from '@rapidclash/shared';
import { api } from '../api.js';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { BringARival } from '../components/hub-shared/BringARival.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { RcIcon } from '../components/hub-shared/RcIcon.js';
import { HUB_SHELL } from '../components/hub-chrome/layout.js';
import { TIER_ORDER, progressPercent, TierIcon } from '../components/hub-shared/vipTier.js';
import avatarPlaceholder from '../assets/games-and-rewards/avatar-placeholder.jpg';

interface Props {
  token: string;
  username: string | null;
  balance: number;
  /** Logo / Games nav → Home. */
  onHome(): void;
  /** Wallet chip / Account nav → Profile. */
  onOpenProfile(): void;
  /** Rewards nav → stays here (self). */
  onOpenRewards(): void;
  /** Menu overlay's own EARN → "Affiliate program" row (issue #423). */
  onOpenAffiliate(): void;
}

/** The design's `VIP_ROWS` table — static reference data (the same six-tier thresholds/perks
 *  for EVERY viewer, not per-player), transcribed verbatim. Only the highlighted column (the
 *  viewer's own current tier) is real-data-driven — see `tierMarkLeft` in the component below. */
const VIP_ROWS: [string, string[]][] = [
  ['XP required', ['500', '5,000', '25,000', '125,000', '475,000', '1,500,000']],
  ['Rakeback', ['1%', '4%', '7%', '10%', '15%', '20%']],
  ['Weekly & 24h races', ['✓', '✓', '✓', '✓', '✓', '✓']],
  ['Exclusive tournaments', ['—', '—', '✓', '✓', '✓', '✓']],
  ['Higher stake tables', ['—', '—', '—', '✓', '✓', '✓']],
  ['Monthly volume bonus', ['—', '—', '—', '—', '✓', '✓']],
  ['Dedicated VIP host', ['—', '—', '—', '—', '—', '✓']],
];

/** The design's `vbRows2` — the Monthly Volume Bonus accordion's static reference table (the
 *  fixed Emerald/Diamond thresholds, same for every viewer — matches `volumeBonusRate` in
 *  `packages/core/src/rewards.ts` exactly). Not per-player data; no wiring needed. */
const VB_ROWS: { tier: 'Emerald' | 'Diamond'; xp: string; bonus: string }[] = [
  { tier: 'Emerald', xp: '50,000', bonus: '3%' },
  { tier: 'Emerald', xp: '120,000', bonus: '5%' },
  { tier: 'Diamond', xp: '120,000', bonus: '5%' },
  { tier: 'Diamond', xp: '300,000', bonus: '8%' },
];

/** Real monthly-volume-bonus milestones (issue #306's `volumeBonusRate`) — used only to derive
 *  the Volume Bonus card's real "next milestone" progress text; the reference table above stays
 *  static regardless. */
const VOLUME_MILESTONES: Record<'Emerald' | 'Diamond', number[]> = {
  Emerald: [50_000, 120_000],
  Diamond: [120_000, 300_000],
};

/**
 * VIP/Rewards hub (issue #307) — reachable from `HubToolbar`'s Rewards nav item. The VIP PROGRAM
 * content below is the design file's `isRewards` view (design-ref/games-and-rewards/ — gitignored,
 * transcribed verbatim per WORKING_AGREEMENT.md), copied byte-for-byte: no re-implementation, no
 * Tailwind conversion, no DOM restructuring. Real-data hooks are additive only — see the inline
 * notes at each wired figure (avatar/username/XP, VIP progress bar + tier labels, the rakeback
 * claim card, the volume-bonus card, and the VIP_ROWS table's current-tier highlight).
 *
 * TWO CONFIRMED, DOCUMENTED GAPS vs. the issue's own description (flagged per the dispatch's
 * "stop and flag it rather than guessing" instruction, not silently patched over):
 *  1. The issue says a "Quests" section and a second (`TIERS`, PLATINUM) tier list ship here as
 *     static/decorative UI. Both `QUESTS`/`TIERS` ARE computed in the design file's state
 *     function — but neither is ever referenced by any markup in the decoded template (no
 *     `sc-for list="{{ quests }}"` / `{{ tiers }}` anywhere in the file — confirmed by grepping
 *     every `sc-for list=` in the whole document). They are dead state, exactly like the Games
 *     page's `MODES` array (which the spec doc itself already flags as "dead… nothing to wire
 *     for it"). There is no markup to transcribe, so none is added here — inventing a "Quests"
 *     UI from whole cloth would itself violate the verbatim-only discipline this ticket is held
 *     to. Not implemented; flagged in the PR description for the Advisor's next pixel-diff pass.
 *  2. The issue cites "`{ v: '18.4K', k: 'RC WAGERED' }` ~line 1405" as a stat ON the Rewards
 *     page. In the decoded template that object is `accountStats`, rendered only inside the
 *     `isAccount` view's 3-tile stat row (`GAMES PLAYED` / `WIN RATE` / `RC WAGERED`) — it does
 *     not appear anywhere inside the `isRewards` block. This lines up with (and likely explains)
 *     the issue's OWN separate "ProfileHub addition" instruction — that's where this repo's
 *     Account page already lives (`ProfileHub.tsx`) and where the real markup for this stat
 *     actually is. No duplicate "RC WAGERED" stat is added to the Rewards page itself; the real
 *     figure ships once, on ProfileHub, per that addition.
 */
export function RewardsHubScreen({ token, username, balance, onHome, onOpenProfile, onOpenRewards, onOpenAffiliate }: Props) {
  const [liveBalance, setLiveBalance] = useState(balance);
  // Issue #414: the Menu overlay's own open/close/reveal-origin state.
  const menu = useMenuOverlay();
  const [snapshot, setSnapshot] = useState<RewardsSnapshot | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  useEffect(() => { setLiveBalance(balance); }, [balance]);

  useEffect(() => {
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    api.rewards(token).then((r) => { if (alive) setSnapshot(r); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  async function handleClaim() {
    if (claiming || !snapshot || snapshot.claimableBalance <= 0) return;
    setClaiming(true);
    setClaimError('');
    try {
      const res = await api.claimRewards(token);
      setSnapshot((s) => (s ? { ...s, claimableBalance: res.newClaimableBalance } : s));
      setLiveBalance((b) => b + res.credited);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Could not claim');
    } finally {
      setClaiming(false);
    }
  }

  const tier = snapshot?.tier ?? 'Unranked';
  const xpLifetime = snapshot?.xpLifetime ?? 0;
  const nextTier = snapshot?.nextTier;
  const pct = progressPercent(xpLifetime, tier, nextTier);
  const tierIndex = tier === 'Unranked' ? -1 : TIER_ORDER.findIndex((t) => t.tier === tier);

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={liveBalance} onLogo={onHome} onWallet={onOpenProfile} />

      <main data-testid="rewards-hub">
        <div className="mx-auto flex max-w-md flex-col">
          <div style={{ margin: '6px 16px 0 16px', padding: '16px 0 14px 0' }}>
            <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '19px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#FFFFFF' }}>
              VIP PROGRAM
            </span>

            {/* ── Header: avatar (static #304 placeholder) / username / lifetime XP — real. ── */}
            <div style={{ marginTop: '14px', background: '#1A1A2E', borderRadius: '22px', padding: '18px 16px 20px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px' }}>
                <div
                  style={{
                    width: '44px', height: '44px', borderRadius: '999px', flex: '0 0 44px',
                    backgroundColor: '#1B1B2E', backgroundImage: `url(${avatarPlaceholder})`,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                  }}
                />
                <span
                  data-testid="rewards-username"
                  style={{ fontFamily: 'Arial, Helvetica, sans-serif', flex: '1 1 auto', fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#FFFFFF' }}
                >
                  @{username ?? 'Player'}
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flex: '0 0 auto' }}>
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '22px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>XP:</span>
                  <span data-testid="rewards-xp" style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '22px', fontWeight: 700, color: '#34D399' }}>
                    {xpLifetime.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              {/* ── VIP progress bar — real: band-relative % toward `nextTier`. ── */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#FFFFFF' }}>YOUR VIP PROGRESS</span>
                <span data-testid="rewards-progress-pct" style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '15px', fontWeight: 700, color: '#34D399' }}>{pct}%</span>
              </div>
              <div style={{ marginTop: '7px', height: '8px', borderRadius: '999px', background: '#0B0B0B' }}>
                <div
                  data-testid="rewards-progress-bar"
                  style={{ width: `${pct}%`, height: '8px', borderRadius: '999px', background: '#8B45F0', boxShadow: '0 0 12px 2px rgba(139,69,240,0.55)' }}
                />
              </div>
              <div style={{ marginTop: '9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span data-testid="rewards-tier-current" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>{tier.toUpperCase()}</span>
                  <TierIcon tier={tier} size={15} />
                </span>
                <span data-testid="rewards-tier-next" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>
                    {nextTier ? nextTier.tier.toUpperCase() : 'MAX'}
                  </span>
                  {nextTier && <TierIcon tier={nextTier.tier} size={15} />}
                </span>
              </div>
            </div>

            {/* ── YOUR REWARDS — rakeback (real, claimable) + volume bonus (real progress). ── */}
            <SectionHeading icon={<RewardsShieldIcon />}>YOUR REWARDS</SectionHeading>
            <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ background: '#1A1A2E', borderRadius: '22px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF', textAlign: 'center' }}>RAKEBACK</div>
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 4px 0' }}>
                    <RakebackIcon />
                  </div>
                  <div style={{ marginTop: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                    <RcIcon size={15} />
                    <span data-testid="rewards-claimable" style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '20px', fontWeight: 700, color: '#34D399' }}>
                      {(snapshot?.claimableBalance ?? 0).toLocaleString('en-US')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="rewards-claim-button"
                  onClick={handleClaim}
                  disabled={claiming || !snapshot || snapshot.claimableBalance <= 0}
                  style={{
                    background: '#8B45F0', borderRadius: '999px', padding: '11px 0', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none',
                    opacity: !snapshot || snapshot.claimableBalance <= 0 ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', lineHeight: '13px', fontWeight: 'bold', letterSpacing: '0.8px', color: '#FFFFFF' }}>
                    {claiming ? 'CLAIMING…' : 'CLAIM'}
                  </span>
                </button>
              </div>

              <VolumeBonusCard tier={tier} xpMonthly={snapshot?.xpMonthly ?? 0} />
            </div>
            {claimError && (
              <p role="alert" data-testid="rewards-claim-error" style={{ marginTop: '8px', fontSize: '12px', color: '#F0556B' }}>{claimError}</p>
            )}

            {/* ── VIP TIER BENEFITS — the real 6-tier table, current tier highlighted. ── */}
            <SectionHeading icon={<VipShieldOutlineIcon />}>VIP TIER BENEFITS</SectionHeading>
            <VipTierTable currentIndex={tierIndex} />

            <p style={{ margin: '18px 0 0 0', fontSize: '15px', lineHeight: '22px', color: '#FFFFFF', textWrap: 'pretty', fontWeight: 600, textAlign: 'justify' }}>
              The RapidClash VIP program is built for you. You&nbsp;earn&nbsp;XP on every game you play, unlock bigger rewards at every tier, and the next tier is always within reach. There&apos;s someone who thinks they&apos;ll beat you, go prove them wrong.
            </p>

            <XpEngineAccordion />
            <RakebackAccordion />
            <VolumeBonusAccordion />
          </div>

          <BringARival />
        </div>

        <HubFooter onGames={onHome} onRewards={onOpenRewards} />
      </main>

      <HubToolbar
        onGames={menu.wrap(onHome)}
        onAccount={menu.wrap(onOpenProfile)}
        onRewards={menu.wrap(onOpenRewards)}
        onMenu={menu.onMenu}
        active={menu.open ? 'menu' : 'rewards'}
      />
      <MenuOverlay
        open={menu.open}
        anchorRect={menu.anchorRect}
        onClose={menu.close}
        onOpenGames={onHome}
        onOpenRewards={onOpenRewards}
        onOpenAffiliate={onOpenAffiliate}
      />
    </div>
  );
}

/* ── Volume bonus card — locked below Emerald (verbatim), real monthly progress at/above it. ── */

function VolumeBonusCard({ tier, xpMonthly }: { tier: VipTier; xpMonthly: number }) {
  const qualifies = tier === 'Emerald' || tier === 'Diamond';
  const milestones = qualifies ? VOLUME_MILESTONES[tier] : undefined;
  const nextMilestone = milestones?.find((m) => xpMonthly < m);
  return (
    <div style={{ background: '#1A1A2E', borderRadius: '22px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF', textAlign: 'center' }}>VOLUME BONUS</div>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 4px 0' }}>
          <VolumeBonusIcon />
        </div>
        <div data-testid="rewards-volume-progress" style={{ marginTop: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '24px' }}>
          {!qualifies ? (
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', textAlign: 'center' }}>Wager to unlock</span>
          ) : nextMilestone ? (
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', textAlign: 'center' }}>
              {xpMonthly.toLocaleString('en-US')} / {nextMilestone.toLocaleString('en-US')} XP
            </span>
          ) : (
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', textAlign: 'center' }}>Max bonus reached</span>
          )}
        </div>
      </div>
      {/* CLAIM here stays the design's non-interactive locked visual in every state — the design
          file only ever shows this ONE (locked) rendering, and the actual claimable amount
          (rakeback + any swept-in volume bonus) is a single pooled `claimableBalance`, already
          claimed from the RAKEBACK card above. Inventing a second, independently-clickable CLAIM
          here would duplicate that one balance, not reflect a second one. */}
      <div style={{ position: 'relative', background: '#0B0B0B', borderRadius: '999px', padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#83838F" style={{ display: 'block', position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
          <path d="M12 2.5A4.7 4.7 0 0 0 7.3 7.2v2.4h2.4V7.2a2.3 2.3 0 0 1 4.6 0v2.4h2.4V7.2A4.7 4.7 0 0 0 12 2.5z" />
          <rect x="5" y="9.6" width="14" height="11.9" rx="2.6" />
        </svg>
        <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', lineHeight: '13px', fontWeight: 'bold', letterSpacing: '0.8px', color: '#83838F' }}>CLAIM</span>
      </div>
    </div>
  );
}

/* ── VIP tier benefits table — verbatim VIP_ROWS, real current-tier highlight. ── */

function VipTierTable({ currentIndex }: { currentIndex: number }) {
  const tierMarkLeft = currentIndex >= 0 ? `${150 + 76 * currentIndex}px` : undefined;
  return (
    <div data-testid="rewards-vip-table" style={{ position: 'relative', margin: '2px -16px 0 -16px' }}>
      <div style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: '2px', minWidth: '100%', padding: '11px 0' }}>
          {tierMarkLeft && (
            <div
              data-testid="rewards-tier-highlight"
              style={{
                position: 'absolute', top: '10px', bottom: '10px', left: tierMarkLeft, width: '76px', boxSizing: 'border-box',
                border: '3px solid #8B45F0', borderRadius: '38px',
                boxShadow: '0 0 8px 1px rgba(139,69,240,0.32), inset 0 0 8px 1px rgba(139,69,240,0.32)',
                pointerEvents: 'none', zIndex: 1,
              }}
            />
          )}
          <div style={{ height: '62px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
            <span style={{ width: '150px', flex: '0 0 150px', paddingLeft: '18px', boxSizing: 'border-box' }} />
            {TIER_ORDER.map(({ tier }) => (
              <span key={tier} style={{ width: '76px', flex: '0 0 76px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                <TierIcon tier={tier} size={19} />
                <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', color: '#FFFFFF', textAlign: 'center' }}>
                  {tier.toUpperCase()}
                </span>
              </span>
            ))}
          </div>
          {VIP_ROWS.map(([label, cells], i) => (
            <div key={label} style={{ height: '54px', display: 'flex', alignItems: 'center', background: i % 2 === 0 ? '#1A1A2E' : 'transparent', borderRadius: i === 0 ? '26px 26px 0 0' : i === VIP_ROWS.length - 1 ? '0 0 26px 26px' : '0px', boxSizing: 'border-box' }}>
              <span style={{ width: '150px', flex: '0 0 150px', padding: '0 10px 0 18px', boxSizing: 'border-box', fontSize: '12.5px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{label}</span>
              {cells.map((c, j) => {
                const isCheck = c === '✓';
                const isText = c !== '✓' && c !== '—';
                const color = i === 0 ? '#34D399' : i === 1 ? '#8B45F0' : '#FFFFFF';
                const size = i === 1 ? '17px' : i === 0 ? '12.5px' : '14px';
                return (
                  <div key={j} style={{ width: '76px', flex: '0 0 76px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isCheck && <CheckIcon />}
                    {isText && <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: size, fontWeight: 700, color }}>{c}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Collapsible accordions (XP Engine / How Rakeback Works / Monthly Volume Bonus) — all ── */
/* ── static reference content, verbatim; only the open/closed toggle behaviour is real UI. ── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 20px', marginLeft: '2px', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
      <path d="m6 9.5 6 6 6-6" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccordionShell({
  testid, icon, title, open, onToggle, children,
}: {
  testid: string; icon: React.ReactNode; title: string; open: boolean; onToggle(): void; children: React.ReactNode;
}) {
  return (
    <>
      <div style={{ marginTop: '22px', padding: '0 2px' }}>
        <span
          data-testid={testid}
          onClick={onToggle}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
        >
          {icon}
          <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '19px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#FFFFFF' }}>{title}</span>
          <Chevron open={open} />
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: 'grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease' }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
      </div>
    </>
  );
}

const RAKE_XP_ROWS: [string, string, string][] = [
  ['2.5%', '1 XP', '100 XP'],
  ['5%', '2 XP', '200 XP'],
  ['10%', '4 XP', '400 XP'],
];

function XpEngineAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <AccordionShell testid="rewards-xp-engine-toggle" icon={<XpEngineIcon />} title="THE XP ENGINE" open={open} onToggle={() => setOpen((o) => !o)}>
      <p style={{ margin: '14px 0 0 0', fontSize: '14px', lineHeight: '22px', fontWeight: 600, color: '#FFFFFF', textAlign: 'justify', textWrap: 'pretty' }}>
        You earn XP every time you play, based on the rake of the game and the amount you wager. Higher rake games earn XP faster.
      </p>
      <div style={{ margin: '16px 0 0 0', display: 'flex', flexDirection: 'column', gap: '2px', padding: '11px 0' }}>
        <div style={{ height: '44px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
          <span style={{ flex: '1 1 40%', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>RAKE</span>
          <span style={{ flex: '1 1 30%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>XP / 1 <RcIcon size={13} /></span>
          <span style={{ flex: '1 1 30%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>100 <RcIcon size={13} /> WAGERED</span>
        </div>
        <div style={{ borderRadius: '26px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {RAKE_XP_ROWS.map(([rake, xp1, xp100], i) => (
            <div key={rake} style={{ height: '54px', display: 'flex', alignItems: 'center', background: i % 2 === 0 ? '#1A1A2E' : undefined }}>
              <span style={{ flex: '1 1 40%', padding: '0 8px 0 18px', boxSizing: 'border-box', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>{rake}</span>
              <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', fontWeight: 700, color: '#34D399' }}>{xp1}</span>
              <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', fontWeight: 700, color: '#34D399' }}>{xp100}</span>
            </div>
          ))}
        </div>
      </div>
    </AccordionShell>
  );
}

function RakebackAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <AccordionShell testid="rewards-rakeback-toggle" icon={<RakebackFormulaIcon />} title="HOW RAKEBACK WORKS" open={open} onToggle={() => setOpen((o) => !o)}>
      <p style={{ margin: '14px 0 0 0', fontSize: '14px', lineHeight: '22px', fontWeight: 600, color: '#FFFFFF', textAlign: 'justify', textWrap: 'pretty' }}>
        You earn rakeback every time you play, based on the rake of the game and your VIP tier. Higher tiers get a bigger rakeback, so every game pays you more as you climb.
      </p>
      <div style={{ marginTop: '14px', padding: '15px 18px', borderRadius: '20px', background: '#1A1A2E', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '15px', fontWeight: 700, color: '#34D399' }}>
        Rakeback = (Stake × Rake%) × Tier%
      </div>
    </AccordionShell>
  );
}

function VolumeBonusAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <AccordionShell testid="rewards-volume-bonus-toggle" icon={<VolumeBonusFormulaIcon />} title="MONTHLY VOLUME BONUS" open={open} onToggle={() => setOpen((o) => !o)}>
      <p style={{ margin: '14px 0 0 0', fontSize: '14px', lineHeight: '22px', fontWeight: 600, color: '#FFFFFF', textAlign: 'justify', textWrap: 'pretty' }}>
        You earn a volume bonus every month you play, based on the XP you collect and your VIP tier. Higher milestones pay more, and the counter resets on the 1st of each month.
      </p>
      <div style={{ margin: '16px 0 0 0', display: 'flex', flexDirection: 'column', gap: '2px', padding: '11px 0' }}>
        <div style={{ borderRadius: '26px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ height: '46px', display: 'flex', alignItems: 'center', background: '#1A1A2E' }}>
            <span style={{ flex: '1 1 40%', padding: '0 8px 0 18px', boxSizing: 'border-box', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>TIER</span>
            <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>MONTHLY XP</span>
            <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>BONUS</span>
          </div>
          {VB_ROWS.map((v, i) => (
            <div key={`${v.tier}-${v.xp}`} style={{ height: '54px', display: 'flex', alignItems: 'center', background: i % 2 === 0 ? 'transparent' : '#1A1A2E' }}>
              <span style={{ flex: '1 1 40%', padding: '0 8px 0 18px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '7px', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                <TierIcon tier={v.tier} size={16} />
                {v.tier}
              </span>
              <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', fontWeight: 700, color: '#34D399' }}>{v.xp}</span>
              <span style={{ flex: '1 1 30%', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '17px', fontWeight: 700, color: '#8B45F0' }}>{v.bonus}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: '4px', padding: '15px 18px', borderRadius: '20px', background: '#1A1A2E', textAlign: 'center', fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '15px', fontWeight: 700, color: '#34D399' }}>
        Bonus = Month&apos;s rake × Bonus %
      </div>
    </AccordionShell>
  );
}

/* ── Small shared bits ─────────────────────────────────────────────────────────────────────── */

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: '22px', padding: '0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {icon}
        <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '19px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#FFFFFF' }}>{children}</span>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill="#34D399" />
      <path d="m7.5 12.3 3.1 3.1 5.9-6.2" fill="none" stroke="#0B0B0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RewardsShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#8B45F0" style={{ display: 'block', flex: '0 0 26px', overflow: 'visible' }}>
      <g transform="rotate(-9 12 8)">
        <path d="M9.2 1.6c1.3 0 2.3 1.1 2.8 2.3.5-1.2 1.5-2.3 2.8-2.3 1.3 0 2.3 1 2.3 2.3 0 .5-.2 1-.5 1.4h1.9c.8 0 1.5.7 1.5 1.5v1.9c0 .3-.2.5-.5.5H4.5c-.3 0-.5-.2-.5-.5V6.8c0-.8.7-1.5 1.5-1.5h1.9c-.3-.4-.5-.9-.5-1.4 0-1.3 1-2.3 2.3-2.3zm0 1.6a.8.8 0 0 0 0 1.6c.5 0 1-.3 1.4-.8-.4-.5-.9-.8-1.4-.8zm5.6 0c-.5 0-1 .3-1.4.8.4.5.9.8 1.4.8a.8.8 0 0 0 0-1.6z" />
      </g>
      <path d="M5 11.9h5.9c.3 0 .5.2.5.5v8.2c0 .3-.2.5-.5.5H6.5c-.8 0-1.5-.7-1.5-1.5v-7.2c0-.3.2-.5.5-.5zm8.1 0H19c.3 0 .5.2.5.5v7.2c0 .8-.7 1.5-1.5 1.5h-4.4c-.3 0-.5-.2-.5-.5v-8.2c0-.3.2-.5.5-.5z" />
    </svg>
  );
}

function VipShieldOutlineIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#8B45F0" style={{ display: 'block', flex: '0 0 26px' }}>
      <path d="M3.6 7.4c.5-.3 1.1-.2 1.5.2l3 3.1 2.7-5.1c.2-.4.7-.7 1.2-.7s.9.3 1.2.7l2.7 5.1 3-3.1c.4-.4 1-.5 1.5-.2s.7.8.6 1.3l-1.9 8.1c-.1.5-.6.8-1.1.8H6c-.5 0-1-.3-1.1-.8L3 8.7c-.1-.5.1-1 .6-1.3z" />
      <rect x="5.4" y="18.4" width="13.2" height="2.4" rx="1.2" />
    </svg>
  );
}

function RakebackIcon() {
  return (
    <svg width="52" height="52" viewBox="7 6 34 34" style={{ display: 'block' }}>
      <g transform="rotate(45 24 24)">
        <rect x="22" y="5" width="4" height="17" rx="2" fill="#8B45F0" />
        <rect x="22" y="9" width="2" height="13" fill="#A870F0" />
        <path d="M12.5 27V24.5A2.5 2.5 0 0 1 15 22h18a2.5 2.5 0 0 1 2.5 2.5V27z" fill="#D8D3E8" />
        <rect x="12.5" y="26" width="3.4" height="9" rx="1.7" fill="#D8D3E8" />
        <rect x="19" y="26" width="3.4" height="9" rx="1.7" fill="#D8D3E8" />
        <rect x="25.6" y="26" width="3.4" height="9" rx="1.7" fill="#D8D3E8" />
        <rect x="32.1" y="26" width="3.4" height="9" rx="1.7" fill="#D8D3E8" />
      </g>
      <path d="M37 10.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#FFFFFF" />
      <path d="M12 33l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#FFFFFF" />
    </svg>
  );
}

function VolumeBonusIcon() {
  return (
    <svg width="52" height="52" viewBox="7 6 34 34" style={{ display: 'block' }}>
      <g transform="rotate(45 24 24)">
        <path d="M24 7c3.6 3.4 5.6 8 5.6 13v6.2H18.4V20c0-5 2-9.6 5.6-13z" fill="#D8D3E8" />
        <path d="M24 7c3.6 3.4 5.6 8 5.6 13v6.2H24z" fill="#BFB8D6" />
        <circle cx="24" cy="18.4" r="3.2" fill="#8B45F0" />
        <path d="M18.4 21.6l-3.9 4.6a2 2 0 0 0-.5 1.3v3.9l4.4-3z" fill="#8B45F0" />
        <path d="M29.6 21.6l3.9 4.6c.3.4.5.8.5 1.3v3.9l-4.4-3z" fill="#8B45F0" />
        <path d="M20.6 28.2h6.8l-1.3 3.4a1.6 1.6 0 0 1-1.5 1h-1.2a1.6 1.6 0 0 1-1.5-1z" fill="#A870F0" />
        <path d="M24 34.4c1 1.4 1.6 2.6 1.6 3.6a1.6 1.6 0 0 1-3.2 0c0-1 .6-2.2 1.6-3.6z" fill="#D8D3E8" />
      </g>
      <path d="M38.3 12.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="#FFFFFF" />
      <path d="M12.2 21.3l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#FFFFFF" />
      <path d="M32.2 25.9l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="#FFFFFF" />
    </svg>
  );
}

function XpEngineIcon() {
  // The design's XP-bolt glyph (a single large filled path) — kept at its original 351×374
  // viewBox so the path data ports verbatim, just scaled to the 26px display size like every
  // other section icon here.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 351 374" fill="none" width="26" height="26" style={{ display: 'block', flex: '0 0 26px', color: '#8B45F0' }}>
      <path fill="currentColor" d="M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z" />
    </svg>
  );
}

function RakebackFormulaIcon() {
  return (
    <svg width="26" height="26" viewBox="6 6 36 36" style={{ display: 'block', flex: '0 0 26px' }}>
      <g transform="rotate(45 24 24)">
        <rect x="20.9" y="5.4" width="6.2" height="17.6" rx="3.1" fill="#8B45F0" />
        <path d="M12.6 27V24a3.2 3.2 0 0 1 3.2-3.2h16.4A3.2 3.2 0 0 1 35.4 24v3z" fill="#8B45F0" />
        <rect x="12.6" y="26" width="4.6" height="8.8" rx="2.3" fill="#8B45F0" />
        <rect x="19.3" y="26" width="4.6" height="8.8" rx="2.3" fill="#8B45F0" />
        <rect x="24.1" y="26" width="4.6" height="8.8" rx="2.3" fill="#8B45F0" />
        <rect x="30.8" y="26" width="4.6" height="8.8" rx="2.3" fill="#8B45F0" />
        <path d="M12.6 26.5h22.8" fill="none" stroke="#0B0B0B" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

function VolumeBonusFormulaIcon() {
  return (
    <svg width="26" height="26" viewBox="9 7 30 30" style={{ display: 'block', flex: '0 0 26px' }}>
      <g transform="rotate(45 24 24)">
        <path d="M24 5.6c4.6 4 7.2 9.2 7.2 14.8v7.2H16.8V20.4c0-5.6 2.6-10.8 7.2-14.8z" fill="#8B45F0" />
        <circle cx="24" cy="18" r="3.6" fill="#0B0B0B" />
        <path d="M16.8 20.8 11.9 26a2.6 2.6 0 0 0-.7 1.8v5l5.6-3.6z" fill="#8B45F0" stroke="#0B0B0B" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M31.2 20.8 36.1 26c.5.5.7 1.1.7 1.8v5l-5.6-3.6z" fill="#8B45F0" stroke="#0B0B0B" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M19.4 29.4h9.2l-1.7 4.2a2 2 0 0 1-1.9 1.3h-2a2 2 0 0 1-1.9-1.3z" fill="#8B45F0" stroke="#0B0B0B" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M24 35.6c1.4 1.9 2.2 3.5 2.2 4.8a2.2 2.2 0 0 1-4.4 0c0-1.3.8-2.9 2.2-4.8z" fill="#8B45F0" />
      </g>
    </svg>
  );
}

