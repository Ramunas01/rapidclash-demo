import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { HUB_SHELL } from '../components/hub-chrome/layout.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { RcIcon } from '../components/hub-shared/RcIcon.js';

/**
 * Affiliate Program (issue #423) — the last of the four Designer handoff packages (Account →
 * Navbar → Menu → Affiliate). Owner-confirmed scope: this ENTIRE section is session-local,
 * client-side mock state — a client-minted referral code, campaigns created into local React
 * state, a static commission-tier table, a seeded non-zero mock claimable balance so CLAIM is
 * actually pressable. No new server endpoint, no new `packages/core` entity, nothing persisted
 * (not even localStorage — unlike Preferences, nothing here needs to survive a reload). Real,
 * live interactivity where it doesn't require a backend: real `navigator.clipboard.writeText`,
 * real blur validation, real toasts.
 *
 * Design source: docs/design-refs/design_handoff_affiliate/ (README.md + screenshots/ +
 * `Affiliate Page.dc.html`). Recreated in this app's own React/Tailwind primitives and resolved
 * tokens (`bg-background`, `bg-surface`, `text-brand`/`bg-brand` for the design's `#8B45F0`)
 * rather than the handoff's literal (stale) hex values — same rule as every prior handoff
 * ticket. Dark-only (no app-wide light/dark theme exists yet — same scoping call as Menu/Preferences).
 */

const SPACE_GROTESK = "'Space Grotesk', Arial, Helvetica, sans-serif";
const ARIAL = 'Arial, Helvetica, sans-serif';

/** How long a toast (copy/campaign-created/claim/placeholder) stays up — same hold every other
 *  screen's own toast copy uses (ProfileHub.tsx/MenuOverlay.tsx). */
const TOAST_MS = 2200;

const TABS = ['OVERVIEW', 'REFERRED USERS', 'CAMPAIGNS', 'EARNINGS', 'MATERIAL'] as const;
type AffTab = (typeof TABS)[number];

function tabSlug(t: AffTab): string {
  return t.toLowerCase().replace(/\s+/g, '-');
}

/** Static commission-tier config (README §"VIP-style commission table") — a static config array,
 *  NOT a reuse of the real player-facing VIP-tier system (`vipTier.ts`): different metric
 *  entirely (affiliate-referred wagered volume vs. the player's own). Bronze is the base rate
 *  shown on the Overview hero and on every campaign card (issue's own non-blocking note: wire
 *  the campaign-card rate to the real tier rate instead of hardcoding 20%). */
interface Tier { tier: string; wagered: string; rate: string }
const TIERS: Tier[] = [
  { tier: 'BRONZE', wagered: '0 – 10,000', rate: '20%' },
  { tier: 'SILVER', wagered: '10,000 – 50,000', rate: '25%' },
  { tier: 'GOLD', wagered: '50,000 – 150,000', rate: '30%' },
  { tier: 'DIAMOND', wagered: '150,000+', rate: '35%' },
];
const BASE_COMMISSION_RATE = TIERS[0]!.rate;

/** A small non-zero seeded claimable balance (Advisor's explicit recommendation, issue #423) —
 *  deliberately NOT the prototype's permanently-disabled 0.00 default, so CLAIM is actually
 *  pressable in an investor demo. */
const SEEDED_CLAIMABLE = 84.2;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomSuffix(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}
/** Minted once per session (not globally unique, not persisted — session-local mock per scope). */
function mintReferralCode(username: string | null): string {
  const base = (username ?? 'RC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'RC';
  return `${base}-${randomSuffix(4)}`;
}
function mintCampaignCode(name: string): string {
  const base = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return base ? `${base}-${randomSuffix(4)}` : randomSuffix(6);
}

interface Campaign {
  id: string;
  name: string;
  code: string;
  signups: number;
  earned: number;
}

interface ClaimEntry {
  id: string;
  date: string;
  amount: number;
  status: string;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  username: string | null;
  balance: number;
  /** Back button → Account (ProfileHub), matching the header pattern PreferencesHub.tsx already uses. */
  onBack(): void;
  /** Logo / Games nav. */
  onHome(): void;
  /** Wallet chip / Account nav. */
  onOpenProfile(): void;
  onOpenRewards(): void;
  /** Menu overlay's own EARN → "Affiliate program" row (and this screen's self-loop while already
   *  showing) — the same navigation callback threaded from App.tsx everywhere else. */
  onOpenAffiliate(): void;
}

export function AffiliateHubScreen({ username, balance, onBack, onHome, onOpenProfile, onOpenRewards, onOpenAffiliate }: Props) {
  const menu = useMenuOverlay();

  const [tab, setTab] = useState<AffTab>('OVERVIEW');
  const [leftFade, setLeftFade] = useState(0);
  const [rightFade, setRightFade] = useState(1);
  const tabRefs = useRef(new Map<AffTab, HTMLButtonElement>());

  const [refCode] = useState(() => mintReferralCode(username));

  // OVERVIEW expandable rows.
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [step1Open, setStep1Open] = useState(false);
  const [step2Open, setStep2Open] = useState(false);
  const [step3Open, setStep3Open] = useState(false);

  // CAMPAIGNS — seeded per screenshots/campaigns-01-list.png (two pre-existing campaigns, both
  // at 0 commission earned) rather than an empty list; the first campaign's code intentionally
  // matches this session's own referral code (mirrors the prototype's own `bobbylee`/`KAI-9F2C` pairing).
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => [
    { id: 'seed-1', name: 'bobbylee', code: refCode, signups: 0, earned: 0 },
    { id: 'seed-2', name: 'winorgohome', code: 'WINORGOHOME', signups: 0, earned: 0 },
  ]);
  const [campaignOpen, setCampaignOpen] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampCode, setNewCampCode] = useState('');
  const [campNameTouched, setCampNameTouched] = useState(false);

  // EARNINGS.
  const [claimed, setClaimed] = useState(0);
  const [claimable, setClaimable] = useState(SEEDED_CLAIMABLE);
  const [claimHistory, setClaimHistory] = useState<ClaimEntry[]>([]);

  // This screen's own toast — a third copy of the same mechanism ProfileHub.tsx/MenuOverlay.tsx
  // each already have (issue's own instruction: reuse the pattern, not a shared component).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, TOAST_MS);
  }, []);

  const handleCopy = useCallback((value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard API unavailable');
      const write = navigator.clipboard.writeText(value);
      write.catch(() => showToast('COPY FAILED'));
      showToast('COPIED TO CLIPBOARD');
    } catch {
      showToast('COPY FAILED');
    }
  }, [showToast]);

  function onRailScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const max = el.scrollWidth - el.clientWidth;
    setLeftFade(Math.min(1, el.scrollLeft / 24));
    setRightFade(max <= 0 ? 0 : Math.min(1, (max - el.scrollLeft) / 24));
  }

  const pickTab = useCallback((t: AffTab) => {
    setTab(t);
    const btn = tabRefs.current.get(t);
    try {
      btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } catch {
      /* jsdom doesn't implement smooth-scroll geometry — harmless in tests */
    }
  }, []);

  function toggleCampaign(id: string) {
    setCampaignOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openCreateSheet() {
    setNewCampName('');
    setNewCampCode(mintCampaignCode(''));
    setCampNameTouched(false);
    setCreateOpen(true);
  }
  function closeCreateSheet() {
    setCreateOpen(false);
  }
  function changeCampName(v: string) {
    setNewCampName(v);
    setNewCampCode(mintCampaignCode(v));
  }
  function blurCampName() {
    setCampNameTouched(true);
  }
  function submitCreateCampaign() {
    const name = newCampName.trim();
    if (!name) {
      setCampNameTouched(true);
      return;
    }
    const campaign: Campaign = { id: `camp-${Date.now()}`, name, code: newCampCode || mintCampaignCode(name), signups: 0, earned: 0 };
    setCampaigns((prev) => [...prev, campaign]);
    setCreateOpen(false);
    showToast('CAMPAIGN CREATED');
  }

  const canClaim = claimable > 0;
  function handleClaim() {
    if (!canClaim) return;
    const amount = claimable;
    setClaimed((prev) => prev + amount);
    setClaimable(0);
    setClaimHistory((prev) => [{ id: `claim-${Date.now()}`, date: formatDate(new Date()), amount, status: 'Paid' }, ...prev]);
    showToast('COMMISSION CLAIMED');
  }

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={balance} onLogo={onHome} onWallet={onOpenProfile} />

      <main data-testid="affiliate-hub">
        <div className="mx-auto flex max-w-md flex-col px-4 pb-8 pt-1.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to Account"
              data-testid="affiliate-back"
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface text-foreground transition-opacity hover:opacity-80"
            >
              <BackChevron />
            </button>
            <h1 className="text-[19px] font-bold uppercase tracking-[0.6px] text-foreground">Affiliate Program</h1>
          </div>

          <div className="relative mt-3.5">
            <div
              role="tablist"
              aria-label="Affiliate program sections"
              onScroll={onRailScroll}
              className="no-scrollbar flex flex-nowrap items-center gap-[9px] overflow-x-auto px-0.5"
            >
              {TABS.map((t) => (
                <button
                  key={t}
                  ref={(el) => { if (el) tabRefs.current.set(t, el); }}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  data-testid={`affiliate-tab-${tabSlug(t)}`}
                  onClick={() => pickTab(t)}
                  className={cn(
                    'flex-none whitespace-nowrap rounded-full px-4 py-[11px] text-[12px] font-bold uppercase tracking-[0.8px] transition-colors',
                    tab === t ? 'bg-brand text-white' : 'bg-surface text-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-0.5 -top-px -bottom-px w-[38px]"
              style={{ opacity: leftFade, transition: 'opacity 180ms ease', background: 'linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background)) 12%, transparent 100%)' }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-0.5 -top-px -bottom-px w-[54px]"
              style={{ opacity: rightFade, transition: 'opacity 180ms ease', background: 'linear-gradient(to left, hsl(var(--background)) 0%, hsl(var(--background)) 12%, transparent 100%)' }}
            />
          </div>

          {tab === 'OVERVIEW' && (
            <OverviewTab
              refCode={refCode}
              onCopyLink={() => handleCopy(`https://rapidclash.com/r/${refCode}`)}
              onCopyCode={() => handleCopy(refCode)}
              commissionOpen={commissionOpen}
              onToggleCommission={() => setCommissionOpen((v) => !v)}
              step1Open={step1Open}
              onToggleStep1={() => setStep1Open((v) => !v)}
              step2Open={step2Open}
              onToggleStep2={() => setStep2Open((v) => !v)}
              step3Open={step3Open}
              onToggleStep3={() => setStep3Open((v) => !v)}
              playersOpen={playersOpen}
              onTogglePlayers={() => setPlayersOpen((v) => !v)}
              partnerOpen={partnerOpen}
              onTogglePartner={() => setPartnerOpen((v) => !v)}
              promoOpen={promoOpen}
              onTogglePromo={() => setPromoOpen((v) => !v)}
              onContactUs={() => showToast('CONTACT US — COMING SOON')}
              onGetMaterials={() => showToast('GET MATERIALS — COMING SOON')}
              onViewCampaigns={() => pickTab('CAMPAIGNS')}
            />
          )}
          {tab === 'REFERRED USERS' && <ReferredUsersTab />}
          {tab === 'CAMPAIGNS' && (
            <CampaignsTab
              campaigns={campaigns}
              openMap={campaignOpen}
              onToggle={toggleCampaign}
              onCopy={handleCopy}
              onCreateOpen={openCreateSheet}
            />
          )}
          {tab === 'EARNINGS' && (
            <EarningsTab claimed={claimed} claimable={claimable} canClaim={canClaim} onClaim={handleClaim} history={claimHistory} />
          )}
          {tab === 'MATERIAL' && <MaterialTab />}
        </div>

        <HubFooter onGames={onHome} onRewards={onOpenRewards} />
      </main>

      <HubToolbar
        onGames={menu.wrap(onHome)}
        onAccount={menu.wrap(onOpenProfile)}
        onRewards={menu.wrap(onOpenRewards)}
        onMenu={menu.onMenu}
        active={menu.open ? 'menu' : 'account'}
      />
      <MenuOverlay
        open={menu.open}
        anchorRect={menu.anchorRect}
        onClose={menu.close}
        onOpenGames={onHome}
        onOpenRewards={onOpenRewards}
        onOpenAffiliate={onOpenAffiliate}
      />

      <CreateCampaignSheet
        open={createOpen}
        name={newCampName}
        code={newCampCode}
        touched={campNameTouched}
        onChangeName={changeCampName}
        onBlurName={blurCampName}
        onClose={closeCreateSheet}
        onSubmit={submitCreateCampaign}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="affiliate-toast"
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 bottom-[calc(2.75rem_+_0.75rem_+_env(safe-area-inset-bottom))]"
        >
          <div className="whitespace-nowrap rounded-full bg-brand px-5 py-2.5 text-[13px] font-semibold text-white">{toast}</div>
        </div>
      )}
    </div>
  );
}

// ── Shared row / chrome primitives ──────────────────────────────────────────────────────────

function BackChevron() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
      <path d="M7.6 2.2 2.6 7 7.6 11.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Triangle({ open, small }: { open: boolean; small?: boolean }) {
  const size = small ? { w: 8, h: 12 } : { w: 13, h: 19 };
  return (
    <svg
      width={size.w}
      height={size.h}
      viewBox="0 0 8 12"
      className="flex-none text-muted-foreground"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 300ms cubic-bezier(0.22,0.61,0.36,1)' }}
      aria-hidden="true"
    >
      <path d="M1.4 1.6 6.6 6 1.4 10.4z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="flex-none" aria-hidden="true">
      <rect x="8.4" y="3" width="12.6" height="15.4" rx="3.2" fill="#FFFFFF" />
      <path d="M6.2 6.6H5.4A2.4 2.4 0 0 0 3 9v9.6A2.4 2.4 0 0 0 5.4 21h8.2a2.4 2.4 0 0 0 2.4-2.4v-.6H8.6a2.4 2.4 0 0 1-2.4-2.4z" fill="#FFFFFF" />
    </svg>
  );
}

function SectionHeadline({ icon, title, size = 19 }: { icon: ReactNode; title: string; size?: 19 | 22 }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <span className={cn('font-bold uppercase tracking-[0.6px] text-foreground', size === 22 ? 'text-[22px]' : 'text-[19px]')} style={{ fontFamily: ARIAL }}>
        {title}
      </span>
    </div>
  );
}

function RowHeadline({ children }: { children: ReactNode }) {
  return <span className="text-[21px] font-black uppercase leading-[1.05] tracking-[0.4px] text-success">{children}</span>;
}

function InlinePill({ testid, onClick, children }: { testid: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded-full bg-brand px-6 py-3 text-[12px] font-bold uppercase tracking-[0.8px] text-white"
    >
      {children}
    </button>
  );
}

function ExpandableRow({
  testid, icon, headline, open, onToggle, action, children,
}: {
  testid: string;
  icon: ReactNode;
  headline: ReactNode;
  open: boolean;
  onToggle(): void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[34px] bg-surface">
      <div
        role="button"
        tabIndex={0}
        data-testid={testid}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer items-center gap-4 px-[18px] py-[22px]"
      >
        <span className="flex-none">{icon}</span>
        <div className="flex flex-1 flex-col items-start gap-3">
          {headline}
          {action}
        </div>
        <Triangle open={open} />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 330ms cubic-bezier(0.22,0.61,0.36,1)' }}>
        <div className="overflow-hidden">
          <div style={{ opacity: open ? 1 : 0, transition: 'opacity 260ms ease' }} className="px-[18px] pb-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRow({ testid, n, title, open, onToggle, children }: { testid: string; n: number; title: string; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[26px] bg-surface">
      <div
        role="button"
        tabIndex={0}
        data-testid={testid}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3.5 px-[18px] py-3.5"
      >
        <span className="text-[15px] font-bold leading-[1.3] text-foreground">
          <span className="text-success">Step {n}:</span> {title}
        </span>
        <Triangle open={open} small />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 330ms cubic-bezier(0.22,0.61,0.36,1)' }}>
        <div className="overflow-hidden">
          <div style={{ opacity: open ? 1 : 0, transition: 'opacity 260ms ease' }} className="px-[18px] pb-4 text-[14px] leading-[20px] text-foreground/90">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function RcAmount({ value, size = 15, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} style={{ fontFamily: SPACE_GROTESK }}>
      <RcIcon size={size} />
      {value.toFixed(2)}
    </span>
  );
}

function CopyField({ testid, label, value, onCopy }: { testid: string; label: string; value: string; onCopy(): void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[46px] min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-full bg-surface px-[18px]">
        <span className="flex-none text-[11px] font-bold uppercase tracking-[1.2px] text-foreground">{label}</span>
        <span
          data-testid={`${testid}-value`}
          className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[14px] font-bold tracking-[0.6px] text-foreground"
          style={{ fontFamily: SPACE_GROTESK }}
        >
          {value}
        </span>
      </div>
      <button
        type="button"
        data-testid={testid}
        onClick={onCopy}
        className="flex h-[46px] flex-none items-center gap-2 rounded-full bg-brand px-5 text-[12px] font-bold uppercase tracking-[0.8px] text-white"
      >
        <CopyIcon /> Copy
      </button>
    </div>
  );
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  refCode, onCopyLink, onCopyCode,
  commissionOpen, onToggleCommission,
  step1Open, onToggleStep1, step2Open, onToggleStep2, step3Open, onToggleStep3,
  playersOpen, onTogglePlayers, partnerOpen, onTogglePartner, promoOpen, onTogglePromo,
  onContactUs, onGetMaterials, onViewCampaigns,
}: {
  refCode: string;
  onCopyLink(): void;
  onCopyCode(): void;
  commissionOpen: boolean;
  onToggleCommission(): void;
  step1Open: boolean;
  onToggleStep1(): void;
  step2Open: boolean;
  onToggleStep2(): void;
  step3Open: boolean;
  onToggleStep3(): void;
  playersOpen: boolean;
  onTogglePlayers(): void;
  partnerOpen: boolean;
  onTogglePartner(): void;
  promoOpen: boolean;
  onTogglePromo(): void;
  onContactUs(): void;
  onGetMaterials(): void;
  onViewCampaigns(): void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="rounded-[26px] bg-surface p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[42px] font-bold leading-none text-success" style={{ fontFamily: SPACE_GROTESK }}>{BASE_COMMISSION_RATE}</span>
          <span className="text-[17px] font-bold uppercase leading-[1.25] text-success">
            Commission
            <br />
            Rate
          </span>
        </div>
        <p className="mt-3 text-[21px] font-bold leading-[1.2] text-foreground">Earn double the market standard</p>
        <p className="mt-2.5 text-[14px] leading-[20px] text-foreground/90">
          The biggest crypto casinos pay 10% — we pay {BASE_COMMISSION_RATE}. Your cut comes from the rake on every game your referrals play — there is no negative carryover, you get paid when they wager, win or lose.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <CopyField testid="affiliate-copy-link" label="LINK:" value={`rapidclash.com/r/${refCode}`} onCopy={onCopyLink} />
          <CopyField testid="affiliate-copy-code" label="CODE:" value={refCode} onCopy={onCopyCode} />
        </div>
      </section>

      <section className="flex flex-col gap-[18px]">
        <SectionHeadline icon={<StepsIcon />} title="How to get started" size={22} />
        <div className="flex flex-col gap-2.5">
          <StepRow testid="affiliate-step-1" n={1} title="Create your campaign" open={step1Open} onToggle={onToggleStep1}>
            Your account already has one, ready to share. Create more campaigns when you want to customize them or know which channel your players actually come from.
          </StepRow>
          <StepRow testid="affiliate-step-2" n={2} title="Share your link or code" open={step2Open} onToggle={onToggleStep2}>
            Send the link anywhere someone can click it. Give out the code anywhere they can&apos;t — on stream, in a voice chat, in person. Both point to the same campaign.
          </StepRow>
          <StepRow testid="affiliate-step-3" n={3} title="Earn on every game" open={step3Open} onToggle={onToggleStep3}>
            Your referrals wager, you earn. Win or lose, the commission is the same, and there is no negative carryover to claw it back. It accrues game by game and you can claim it 24 hours later.
          </StepRow>
        </div>
        <button
          type="button"
          data-testid="affiliate-view-campaigns"
          onClick={onViewCampaigns}
          className="self-center rounded-full bg-brand px-6 py-3 text-[13px] font-bold uppercase tracking-[1px] text-white"
        >
          View campaigns
        </button>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<PercentIcon />} title="Commission structure" size={22} />
        <ExpandableRow testid="affiliate-commission" icon={<ShieldIcon />} headline={<RowHeadline>No negative carryover</RowHeadline>} open={commissionOpen} onToggle={onToggleCommission}>
          <div className="flex flex-col gap-2.5">
            <p className="text-[14px] leading-[20px] text-foreground/90">Every game on RapidClash generates commission based on its rake. The commission is calculated using this formula:</p>
            <div className="rounded-[20px] bg-background px-4 py-3 text-center text-[14px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>
              (Rake % × wagered × Commission rate) / 2
            </div>
            <p className="text-[14px] leading-[20px] text-foreground/90">No negative carryover. Rake is charged on every game, so you earn whether your referral wins or loses. A winning player never wipes out your balance.</p>
          </div>
        </ExpandableRow>
      </section>

      <TierTable />

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<GiftHeadlineIcon />} title="What your players get" size={22} />
        <ExpandableRow testid="affiliate-players" icon={<GiftBoxIcon />} headline={<RowHeadline>Welcome benefits</RowHeadline>} open={playersOpen} onToggle={onTogglePlayers}>
          <p className="text-[14px] leading-[20px] text-foreground/90">Your players skip straight to Bronze tier — a 4% rakeback from their first game, race entry, and a real place on the VIP ladder. Everyone else starts unranked at 0% and plays 50 games to get there.</p>
        </ExpandableRow>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<StarHeadlineIcon />} title="Become a partner" size={22} />
        <ExpandableRow
          testid="affiliate-partner"
          icon={<PartnerStarIcon />}
          headline={
            <RowHeadline>
              Have a big
              <br />
              reach?
            </RowHeadline>
          }
          action={<InlinePill testid="affiliate-contact-us" onClick={onContactUs}>Contact us</InlinePill>}
          open={partnerOpen}
          onToggle={onTogglePartner}
        >
          <p className="text-[14px] leading-[20px] text-foreground/90">If you&apos;re a content creator or professional affiliate with a large audience, we&apos;ll make a tailored partnership program for you. Contact our affiliate team to find out more.</p>
        </ExpandableRow>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<ScreenPanelIcon size={28} />} title="Promotional materials" size={22} />
        <ExpandableRow
          testid="affiliate-promo"
          icon={<ScreenPanelIcon size={84} />}
          headline={
            <RowHeadline>
              Ready to
              <br />
              share
            </RowHeadline>
          }
          action={<InlinePill testid="affiliate-get-materials" onClick={onGetMaterials}>Get materials</InlinePill>}
          open={promoOpen}
          onToggle={onTogglePromo}
        >
          <p className="text-[14px] leading-[20px] text-foreground/90">Our team has put together banners, logos and game artwork - everything you need, ready to use across all socials and streams.</p>
        </ExpandableRow>
      </section>
    </div>
  );
}

function TierTable() {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeadline icon={<TierHeadlineIcon />} title="Commission tiers" />
      <div className="-mx-4 overflow-x-auto">
        <div className="flex min-w-[420px] flex-col gap-0.5 px-4">
          <div className="flex h-10 items-end pb-2.5">
            <span className="w-[120px] flex-none pl-1 text-[10px] font-bold uppercase tracking-[1.2px] text-foreground">Tier</span>
            <span className="w-[180px] flex-none text-center text-[10px] font-bold uppercase tracking-[1.2px] text-foreground">Wagered</span>
            <span className="w-[100px] flex-none text-center text-[10px] font-bold uppercase tracking-[1.2px] text-foreground">Rate</span>
          </div>
          {TIERS.map((t, i) => (
            <div
              key={t.tier}
              data-testid={`affiliate-tier-${t.tier.toLowerCase()}`}
              className={cn('flex h-[54px] items-center bg-surface', i === 0 && 'rounded-t-[20px]', i === TIERS.length - 1 && 'rounded-b-[20px]')}
            >
              <span className="w-[120px] flex-none pl-4 text-[13px] font-bold text-foreground">{t.tier}</span>
              <span className="w-[180px] flex-none text-center text-[13px] text-foreground" style={{ fontFamily: SPACE_GROTESK }}>{t.wagered}</span>
              <span className="w-[100px] flex-none text-center text-[13px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>{t.rate}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── REFERRED USERS ───────────────────────────────────────────────────────────────────────────

function ReferredUsersTab() {
  return (
    <div className="mt-6 flex flex-col gap-2.5">
      <SectionHeadline icon={<PeopleIcon />} title="Referred users" />
      <div className="relative -mx-4">
        <div className="overflow-x-auto px-4 pb-2">
          <div className="min-w-[550px]">
            <div className="flex h-10 items-end pb-2.5 text-[10px] font-bold uppercase tracking-[1.2px] text-foreground">
              <span className="w-[150px] flex-none pl-1">Username</span>
              <span className="w-[110px] flex-none text-center">Registered</span>
              <span className="w-[110px] flex-none text-center">Campaign</span>
              <span className="w-[100px] flex-none text-center">Wagered</span>
              <span className="w-[160px] flex-none text-center">Commission earned</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[54px] rounded-[6px] bg-surface/50" />
              ))}
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-9">
          <span data-testid="affiliate-referred-empty" className="text-[14px] font-semibold text-foreground">No referred users</span>
        </div>
      </div>
    </div>
  );
}

// ── CAMPAIGNS ────────────────────────────────────────────────────────────────────────────────

function CampaignsTab({
  campaigns, openMap, onToggle, onCopy, onCreateOpen,
}: {
  campaigns: Campaign[];
  openMap: Record<string, boolean>;
  onToggle(id: string): void;
  onCopy(value: string): void;
  onCreateOpen(): void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <SectionHeadline icon={<ScreenPanelIcon size={26} />} title="Campaigns" />
      <button
        type="button"
        data-testid="affiliate-create-campaign"
        onClick={onCreateOpen}
        className="flex h-12 items-center justify-center rounded-full bg-brand text-[13px] font-bold uppercase tracking-[1px] text-white shadow-[0_0_14px_2px_rgba(129,64,226,0.35)]"
      >
        Create campaign
      </button>
      <div className="flex flex-col gap-2.5" data-testid="affiliate-campaign-list">
        {campaigns.length === 0 ? (
          <p className="py-6 text-center text-[13px] font-semibold text-muted-foreground">No campaigns yet</p>
        ) : (
          campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} open={!!openMap[c.id]} onToggle={() => onToggle(c.id)} onCopy={onCopy} />
          ))
        )}
      </div>
    </div>
  );
}

function CampaignCard({ campaign, open, onToggle, onCopy }: { campaign: Campaign; open: boolean; onToggle(): void; onCopy(value: string): void }) {
  const link = `rapidclash.com/r/${campaign.code}`;
  return (
    <div data-testid={`affiliate-campaign-${campaign.id}`} className="overflow-hidden rounded-[26px] bg-surface">
      <div
        role="button"
        tabIndex={0}
        data-testid={`affiliate-campaign-${campaign.id}-toggle`}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer items-center gap-3 px-[18px] py-[17px]"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-foreground">{campaign.name}</div>
          <div className="truncate text-[12px] font-semibold text-muted-foreground">{link}</div>
        </div>
        <div className="flex flex-none flex-col items-start gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Commission earned</span>
          <RcAmount value={campaign.earned} className="text-[14px] font-bold text-success" />
        </div>
        <Triangle open={open} />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 330ms cubic-bezier(0.22,0.61,0.36,1)' }}>
        <div className="overflow-hidden">
          <div style={{ opacity: open ? 1 : 0, transition: 'opacity 260ms ease' }} className="px-[18px] pb-5">
            <div className="mb-4 h-px bg-background" />
            <div className="flex gap-3.5">
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Signups</div>
                <div className="mt-1 text-[16px] font-bold text-foreground" style={{ fontFamily: SPACE_GROTESK }}>{campaign.signups}</div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Commission rate</div>
                <div className="mt-1 text-[16px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>{BASE_COMMISSION_RATE}</div>
              </div>
            </div>
            <div className="mt-3.5">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Referral link</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-full bg-background px-4 py-2.5 text-[12px] font-bold text-foreground" style={{ fontFamily: SPACE_GROTESK }}>{link}</div>
                <button
                  type="button"
                  data-testid={`affiliate-campaign-${campaign.id}-copy-link`}
                  onClick={(e) => { e.stopPropagation(); onCopy(link); }}
                  className="flex flex-none items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-[11px] font-bold uppercase text-white"
                >
                  <CopyIcon /> Copy
                </button>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Referral code</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-full bg-background px-4 py-2.5 text-[13px] font-bold tracking-[1px] text-foreground" style={{ fontFamily: SPACE_GROTESK }}>{campaign.code}</div>
                <button
                  type="button"
                  data-testid={`affiliate-campaign-${campaign.id}-copy-code`}
                  onClick={(e) => { e.stopPropagation(); onCopy(campaign.code); }}
                  className="flex flex-none items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-[11px] font-bold uppercase text-white"
                >
                  <CopyIcon /> Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateCampaignSheet({
  open, name, code, touched, onChangeName, onBlurName, onClose, onSubmit,
}: {
  open: boolean;
  name: string;
  code: string;
  touched: boolean;
  onChangeName(v: string): void;
  onBlurName(): void;
  onClose(): void;
  onSubmit(): void;
}) {
  const trimmed = name.trim();
  const error = touched && trimmed === '';
  return (
    <>
      <div
        data-testid="affiliate-create-sheet-scrim"
        aria-hidden={!open}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/60"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 320ms ease' }}
      />
      <div
        data-testid="affiliate-create-sheet"
        role="dialog"
        aria-modal={open}
        aria-label="Create campaign"
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[64vh] flex-col overflow-y-auto rounded-t-[34px] bg-surface px-5 pb-8 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]"
        style={{ transform: open ? 'translateY(0)' : 'translateY(104%)', transition: 'transform 440ms cubic-bezier(0.22,0.61,0.36,1)', pointerEvents: open ? 'auto' : 'none' }}
      >
        <button
          type="button"
          data-testid="affiliate-create-sheet-handle"
          onClick={onClose}
          aria-label="Close"
          className="mx-auto mb-5 h-[5px] w-14 flex-none rounded-full bg-muted-foreground/40"
        />
        <h2 className="text-[22px] font-bold text-foreground">Create campaign</h2>

        <label className="mt-5 block text-[11px] font-bold uppercase tracking-[1px] text-foreground" htmlFor="affiliate-campaign-name">
          Campaign name
        </label>
        <input
          id="affiliate-campaign-name"
          data-testid="affiliate-campaign-name-input"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onBlur={onBlurName}
          placeholder="Enter campaign name"
          className={cn(
            'mt-2 h-[50px] w-full rounded-full bg-background px-5 text-[14px] font-semibold text-foreground outline-none',
            error ? 'border-[1.5px] border-destructive' : 'border-[1.5px] border-transparent',
          )}
        />
        {error && (
          <p data-testid="affiliate-campaign-name-error" className="mt-1.5 text-[12.5px] font-bold text-destructive">
            Campaign name is required
          </p>
        )}

        <div className="mt-4">
          <span className="block text-[11px] font-bold uppercase tracking-[1px] text-foreground">Code (campaign ID)</span>
          <div
            data-testid="affiliate-campaign-code-preview"
            className="mt-2 flex h-[50px] w-full items-center rounded-full bg-background px-5 text-[14px] font-bold tracking-[1px] text-muted-foreground"
            style={{ fontFamily: SPACE_GROTESK }}
          >
            {code || '—'}
          </div>
        </div>

        <button
          type="button"
          data-testid="affiliate-create-sheet-submit"
          disabled={trimmed === ''}
          onClick={onSubmit}
          className={cn(
            'mt-6 flex h-[50px] w-full flex-none items-center justify-center rounded-full text-[13px] font-bold uppercase tracking-[1px]',
            trimmed === '' ? 'bg-background text-muted-foreground' : 'bg-brand text-white',
          )}
        >
          Create campaign
        </button>
      </div>
    </>
  );
}

// ── EARNINGS ─────────────────────────────────────────────────────────────────────────────────

function EarningsTab({
  claimed, claimable, canClaim, onClaim, history,
}: {
  claimed: number;
  claimable: number;
  canClaim: boolean;
  onClaim(): void;
  history: ClaimEntry[];
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <SectionHeadline icon={<WalletIcon />} title="Earnings" />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-4 rounded-[26px] bg-surface p-5">
          <SafeIcon />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Total claimed</div>
            <RcAmount value={claimed} size={19} className="mt-1.5 text-[22px] font-bold text-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-[26px] bg-surface p-5">
          <CoinStackIcon />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-foreground">Total claimable</div>
            <RcAmount value={claimable} size={19} className="mt-1.5 text-[22px] font-bold text-success" />
          </div>
          <button
            type="button"
            data-testid="affiliate-claim"
            disabled={!canClaim}
            onClick={onClaim}
            className={cn(
              'flex h-11 flex-none items-center justify-center rounded-full px-6 text-[12px] font-bold uppercase tracking-[1px]',
              canClaim ? 'bg-brand text-white' : 'bg-background text-muted-foreground',
            )}
          >
            Claim
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeadline icon={<NotebookIcon />} title="Claim history" />
        {history.length === 0 ? (
          <p data-testid="affiliate-claim-history-empty" className="py-6 text-center text-[13px] font-semibold text-muted-foreground">No claims yet</p>
        ) : (
          <div className="flex flex-col gap-0.5 overflow-hidden rounded-[20px]" data-testid="affiliate-claim-history">
            <div className="flex h-10 items-center px-4 text-[10px] font-bold uppercase tracking-[1.2px] text-foreground">
              <span className="flex-1">Date</span>
              <span className="flex-1 text-center">Amount</span>
              <span className="flex-1 text-right">Status</span>
            </div>
            {history.map((h) => (
              <div key={h.id} data-testid={`affiliate-claim-${h.id}`} className="flex h-[54px] items-center bg-surface px-4">
                <span className="flex-1 text-[13px] text-foreground">{h.date}</span>
                <RcAmount value={h.amount} className="flex-1 justify-center text-[13px] font-bold text-foreground" />
                <span className="flex-1 text-right text-[12px] font-bold uppercase text-success">{h.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MATERIAL — genuinely empty per the Designer's own explicit instruction (README §5: "do not
//    implement it from guesswork"). The tab exists in the rail; this renders nothing. ──────────

function MaterialTab() {
  return <div data-testid="affiliate-material-empty" className="mt-6" />;
}

// ── Icons — inline SVG adapted from docs/design-refs/design_handoff_affiliate/Affiliate Page.dc.html,
//    fills swapped to this app's resolved tokens (`currentColor` wrapped in `text-brand`) per the
//    same token-correction precedent as every prior handoff ticket. Secondary/tertiary shading
//    facets keep the handoff's own literal ramp hex (`#A870F0`/`#6D28D9`/etc.) — those are the
//    README's "Fixed brand values," not a stale duplicate of the resolved active-color token. ──

function PercentIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <circle cx="7" cy="7" r="3.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="17" cy="17" r="3.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <path d="M19.4 4.6 4.6 19.4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="84" height="84" viewBox="0 0 24 24" className="flex-none overflow-visible text-brand" aria-hidden="true">
      <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill="currentColor" />
      <path d="M12 2.2 3.6 5v6.6c0 5 3.5 8.6 8.4 10.2z" fill="#A870F0" />
      <path d="M12 2.2 20.4 5 3.6 21.8z" fill="#BFB8D6" opacity="0.28" />
      <path d="M22.4 3.6l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75z" fill="#FFFFFF" />
      <path d="M2 15.9l.55 1.5 1.5.55-1.5.55-.55 1.5-.55-1.5-1.5-.55 1.5-.55z" fill="#FFFFFF" />
    </svg>
  );
}

function StepsIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <path d="M5.6 2.4v19.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7.4 3.6h11.9c.7 0 1.1.8.7 1.4l-2.2 3.2 2.2 3.2c.4.6 0 1.4-.7 1.4H7.4z" fill="currentColor" />
    </svg>
  );
}

function GiftHeadlineIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" className="flex-none overflow-visible text-brand" aria-hidden="true">
      <g transform="rotate(-9 12 8)" fill="currentColor">
        <path d="M9.2 1.6c1.3 0 2.3 1.1 2.8 2.3.5-1.2 1.5-2.3 2.8-2.3 1.3 0 2.3 1 2.3 2.3 0 .5-.2 1-.5 1.4h1.9c.8 0 1.5.7 1.5 1.5v1.9c0 .3-.2.5-.5.5H4.5c-.3 0-.5-.2-.5-.5V6.8c0-.8.7-1.5 1.5-1.5h1.9c-.3-.4-.5-.9-.5-1.4 0-1.3 1-2.3 2.3-2.3zm0 1.6a.8.8 0 0 0 0 1.6c.5 0 1-.3 1.4-.8-.4-.5-.9-.8-1.4-.8zm5.6 0c-.5 0-1 .3-1.4.8.4.5.9.8 1.4.8a.8.8 0 0 0 0-1.6z" />
      </g>
      <path d="M5 11.9h5.9c.3 0 .5.2.5.5v8.2c0 .3-.2.5-.5.5H6.5c-.8 0-1.5-.7-1.5-1.5v-7.2c0-.3.2-.5.5-.5zm8.1 0H19c.3 0 .5.2.5.5v7.2c0 .8-.7 1.5-1.5 1.5h-4.4c-.3 0-.5-.2-.5-.5v-8.2c0-.3.2-.5.5-.5z" fill="currentColor" />
    </svg>
  );
}

function GiftBoxIcon() {
  return (
    <svg width="84" height="84" viewBox="0 0 24 24" className="flex-none overflow-visible" aria-hidden="true">
      <g transform="rotate(-9 12 8)">
        <path d="M9.2 1.6c1.3 0 2.3 1.1 2.8 2.3.5-1.2 1.5-2.3 2.8-2.3 1.3 0 2.3 1 2.3 2.3 0 .5-.2 1-.5 1.4h1.9c.8 0 1.5.7 1.5 1.5v1.9c0 .3-.2.5-.5.5H4.5c-.3 0-.5-.2-.5-.5V6.8c0-.8.7-1.5 1.5-1.5h1.9c-.3-.4-.5-.9-.5-1.4 0-1.3 1-2.3 2.3-2.3zm0 1.6a.8.8 0 0 0 0 1.6c.5 0 1-.3 1.4-.8-.4-.5-.9-.8-1.4-.8zm5.6 0c-.5 0-1 .3-1.4.8.4.5.9.8 1.4.8a.8.8 0 0 0 0-1.6z" className="fill-brand" />
        <path d="M12 5.3h6.5c.8 0 1.5.7 1.5 1.5v1.9c0 .3-.2.5-.5.5H12z" fill="#A870F0" />
      </g>
      <path d="M5 11.9h5.9c.3 0 .5.2.5.5v8.2c0 .3-.2.5-.5.5H6.5c-.8 0-1.5-.7-1.5-1.5v-7.2c0-.3.2-.5.5-.5z" fill="#D8D3E8" />
      <path d="M13.1 11.9H19c.3 0 .5.2.5.5v7.2c0 .8-.7 1.5-1.5 1.5h-4.4c-.3 0-.5-.2-.5-.5v-8.2c0-.3.2-.5.5-.5z" fill="#BFB8D6" />
      <path d="M21.2 3.1l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" fill="#FFFFFF" />
      <path d="M2.4 15.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="#FFFFFF" />
    </svg>
  );
}

function StarHeadlineIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <path d="M11 2.6a1.2 1.2 0 0 1 2 0l2.3 4.1 4.6.9a1.2 1.2 0 0 1 .6 2l-3.2 3.4.6 4.7a1.2 1.2 0 0 1-1.7 1.2L12 16.8l-4.2 2.1a1.2 1.2 0 0 1-1.7-1.2l.6-4.7-3.2-3.4a1.2 1.2 0 0 1 .6-2l4.6-.9z" fill="currentColor" />
    </svg>
  );
}

function PartnerStarIcon() {
  return (
    <svg width="84" height="84" viewBox="7 6 34 34" className="flex-none" aria-hidden="true">
      <defs>
        <clipPath id="affPartnerStarClip">
          <path d="M11 2.6a1.2 1.2 0 0 1 2 0l2.3 4.1 4.6.9a1.2 1.2 0 0 1 .6 2l-3.2 3.4.6 4.7a1.2 1.2 0 0 1-1.7 1.2L12 16.8l-4.2 2.1a1.2 1.2 0 0 1-1.7-1.2l.6-4.7-3.2-3.4a1.2 1.2 0 0 1 .6-2l4.6-.9z" />
        </clipPath>
      </defs>
      <g clipPath="url(#affPartnerStarClip)" transform="translate(4.5,5.23) scale(1.625)">
        <path d="M0.69 7.81 6.7 13 12 11.24Z" fill="#6D28D9" />
        <path d="M0.69 7.81 8.7 6.7 12 11.24Z" fill="#C9BEFA" />
        <path d="M12 -0.77 8.7 6.7 12 11.24Z" fill="#EDEAFB" />
        <path d="M12 -0.77 15.3 6.7 12 11.24Z" fill="#A870F0" />
        <path d="M4.98 20.81 6.7 13 12 11.24Z" fill="#5B21B6" />
        <path d="M4.98 20.81 12 16.8 12 11.24Z" fill="#6D28D9" />
        <path d="M23.31 7.81 15.3 6.7 12 11.24Z" className="fill-brand" />
        <path d="M23.31 7.81 17.3 13 12 11.24Z" fill="#6D28D9" />
        <path d="M19.02 20.81 17.3 13 12 11.24Z" fill="#5B21B6" />
        <path d="M19.02 20.81 12 16.8 12 11.24Z" fill="#5B21B6" />
      </g>
      <path d="M35.6 11.4l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#FFFFFF" />
      <path d="M12.4 30.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#FFFFFF" />
    </svg>
  );
}

function ScreenPanelIcon({ size }: { size: number }) {
  const clipId = `affScreenPanelClip${size}`;
  return (
    <svg width={size} height={size} viewBox="7 6 34 34" className="flex-none" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="11" y="9.5" width="26" height="22" rx="4" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="11" y="9.5" width="26" height="22" className="fill-brand" />
        <path d="M11 9.5H37L11 31.5z" fill="#A870F0" />
      </g>
      <g fill="#EDEAFB">
        <rect x="14.5" y="12.9" width="19" height="2.6" rx="1.3" />
        <rect x="14.5" y="17.1" width="8.2" height="2.6" rx="1.3" />
        <rect x="25.3" y="17.1" width="8.2" height="2.6" rx="1.3" />
        <rect x="14.5" y="21.3" width="14.6" height="2.6" rx="1.3" />
        <rect x="14.5" y="25.5" width="10.4" height="2.6" rx="1.3" />
      </g>
      <path d="M38.6 7.4l.85 2.2 2.2.85-2.2.85-.85 2.2-.85-2.2-2.2-.85 2.2-.85z" fill="#FFFFFF" />
      <path d="M9.2 32.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#FFFFFF" />
    </svg>
  );
}

function TierHeadlineIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill="currentColor" />
      <path d="M8.2 11.9l2.7 2.8 5-5.2" className="stroke-surface" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <circle cx="9" cy="8.4" r="4.2" fill="currentColor" />
      <path d="M1.4 20.6c.5-4.2 3.7-6.6 7.6-6.6s7.1 2.4 7.6 6.6z" fill="currentColor" />
      <circle cx="18" cy="7.4" r="3.2" fill="currentColor" />
      <path d="M15.6 13.2c.8-.3 1.6-.4 2.4-.4 3 0 5.2 1.8 5.6 5h-4.2c-.3-1.9-1.4-3.5-3.1-4.5z" fill="currentColor" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <path d="M4.6 5.2h14.8A2.6 2.6 0 0 1 22 7.8v10.4a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 18.2V7.8a2.6 2.6 0 0 1 2.6-2.6zm-1.2 4.4h17.2v2.2H3.4z" fill="currentColor" fillRule="evenodd" />
      <rect x="15.4" y="13.4" width="4.4" height="2.8" rx="1.4" className="fill-background" />
    </svg>
  );
}

function SafeIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" className="flex-none overflow-visible" aria-hidden="true">
      <defs>
        <clipPath id="affSafeBody">
          <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="3.4" />
        </clipPath>
      </defs>
      <g clipPath="url(#affSafeBody)">
        <rect x="2.4" y="2.4" width="19.2" height="19.2" className="fill-brand" />
        <path d="M2.4 2.4H21.6L2.4 21.6z" fill="#A870F0" />
      </g>
      <rect x="4.8" y="4.8" width="14.4" height="14.4" rx="2.4" fill="#6D28D9" />
      <circle cx="11.3" cy="12" r="4" fill="#D8D3E8" />
      <circle cx="11.3" cy="12" r="1.4" fill="#6D28D9" />
      <g stroke="#EDEAFB" strokeWidth="1.2" strokeLinecap="round">
        <path d="M11.3 7.2v1.6M11.3 15.2v1.6M6.5 12h1.6M14.5 12h1.6" />
      </g>
      <rect x="16.4" y="10.9" width="2.3" height="2.2" rx="1.1" fill="#D8D3E8" />
      <path d="M22.4 1.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="#FFFFFF" />
      <path d="M1.2 17.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="#FFFFFF" />
    </svg>
  );
}

function CoinStackIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" className="flex-none overflow-visible" aria-hidden="true">
      <g transform="rotate(-6 12 17.4)">
        <path d="M4.4 17.4v2.6a7.6 2.7 0 0 0 15.2 0V17.4z" fill="#6D28D9" />
        <ellipse cx="12" cy="17.4" rx="7.6" ry="2.7" fill="#A870F0" />
      </g>
      <g transform="rotate(5 11.4 13.2)">
        <path d="M4.2 13.2v2.5a7.2 2.6 0 0 0 14.4 0V13.2z" fill="#7C3AED" />
        <ellipse cx="11.4" cy="13.2" rx="7.2" ry="2.6" fill="#BFB8D6" />
      </g>
      <g transform="rotate(-4 12.8 9.2)">
        <path d="M6.2 9.2v2.4a6.6 2.4 0 0 0 13.2 0V9.2z" className="fill-brand" />
        <ellipse cx="12.8" cy="9.2" rx="6.6" ry="2.4" fill="#D8D3E8" />
      </g>
      <g transform="rotate(-64 6.4 5.2)">
        <path d="M1.2 5.2v2.3a5.2 2.6 0 0 0 10.4 0V5.2z" fill="#7C3AED" />
        <ellipse cx="6.4" cy="5.2" rx="5.2" ry="2.6" fill="#EDEAFB" />
      </g>
      <path d="M22.4 8.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="#FFFFFF" />
      <path d="M1.2 11.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="#FFFFFF" />
    </svg>
  );
}

function NotebookIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="flex-none text-brand" aria-hidden="true">
      <path d="M7.4 2.6h11.2A2.6 2.6 0 0 1 21.2 5.2v13.6a2.6 2.6 0 0 1-2.6 2.6H7.4a2.6 2.6 0 0 1-2.6-2.6V5.2a2.6 2.6 0 0 1 2.6-2.6z" fill="currentColor" />
      <rect x="2.4" y="4.6" width="3.4" height="14.8" rx="1.7" fill="currentColor" opacity="0.6" />
      <g className="fill-background">
        <rect x="8" y="6.6" width="10" height="2.2" rx="1.1" />
        <rect x="8" y="10.4" width="10" height="2.2" rx="1.1" />
        <rect x="8" y="14.2" width="6.4" height="2.2" rx="1.1" />
      </g>
    </svg>
  );
}
