import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { HUB_SHELL } from '../components/hub-chrome/layout.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { RcIcon } from '../components/hub-shared/RcIcon.js';
import affiliateMegaphoneArt from '../assets/affiliate/affiliate-megaphone.png';
import affiliateMoneyArt from '../assets/affiliate/affiliate-money-sm.png';

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
 * tokens (`bg-surface`, `text-brand`/`bg-brand` for the design's `#8B45F0`) rather than the
 * handoff's literal (stale) hex values — same rule as every prior handoff ticket.
 *
 * Light-mode threading (issue #498, T3b "heavy group"): this screen shipped dark-only (comment
 * above used to say so, same scoping call as Menu/Preferences at the time). Unlike the hex-literal
 * concern below, the gap here was this file's own `bg-background`/`text-foreground`/
 * `text-muted-foreground`/`text-destructive`/`border-destructive`/`fill-background` — this app's
 * pre-existing shadcn tokens, none of which carry a `[data-theme='light']` override (`index.css`'s
 * light block only defines the T1 `--rc-*` set) — so every one of those became the T1 `--rc-*`
 * equivalent instead (`bg-[var(--rc-bg)]`, `text-[var(--rc-text)]`, `text-[var(--rc-muted)]`,
 * `text-[var(--rc-danger)]`/`border-[var(--rc-danger)]`, `fill-[var(--rc-bg)]`), same treatment
 * `HubRibbon.tsx`/`MenuOverlay.tsx`/`HomeHub.tsx` already got in T2/T3a. `bg-surface`/`text-success`/
 * `bg-brand`/`text-brand`/`fill-brand` were already theme-aware (`tailwind.config.js` maps them
 * straight to `var(--rc-surface)`/`var(--rc-success)`/`var(--brand-purple)`) so those, and the
 * fixed `text-white` used on brand-purple pills/toasts, are untouched. The two inline gradient
 * fades (`onRailScroll`'s left/right fade masks) built off `hsl(var(--background))` directly, not
 * a className — also swapped to `var(--rc-bg)`.
 *
 * The SVG icon hex literals below (`#A870F0`/`#7C3AED`/`#6D28D9`/`#EDEAFB`/etc.) are a separate,
 * deliberately UNCHANGED concern — see the comment above the icon section: they're the design
 * source's own fixed secondary/tertiary shading ramp, not surface/text roles, same as every prior
 * handoff ticket's treatment of them. No committed fidelity reference exists yet for `affiliate`
 * (no entry in `tools/design-fidelity/src/screens.ts`), so this call isn't screenshot-verified the
 * way the `rewards` screen's was — flagged in the #498 PR for a design pass if that changes.
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

/** The single flat commission rate (design source `Affiliate Page.dc.html` line 923/930: "we pay
 *  20%"), shown on the Overview hero and on every campaign card. There is no tiered commission
 *  scheme — issue #452 deleted an invented "Commission Tiers" table that reused the real VIP
 *  tier names (Bronze/Silver/Gold/Diamond, from `packages/core/src/rewards.ts`) for a made-up,
 *  unrelated rate ladder that existed nowhere in the design source. */
const BASE_COMMISSION_RATE = '20%';

/** A small non-zero seeded claimable balance (Advisor's explicit recommendation, issue #423) —
 *  deliberately NOT the prototype's permanently-disabled 0.00 default, so CLAIM is actually
 *  pressable in an investor demo. */
const SEEDED_CLAIMABLE = 84.2;

/** Seeded mock stats for the Overview hero's new stats tiles (issue #448) — same session-local
 *  mock-state approach as SEEDED_CLAIMABLE above (no real backend). Values match the design
 *  source's own placeholder data (`Affiliate Page.dc.html` lines 960/964/968: 18 / 42,910 / 1,284)
 *  rather than inventing new ones. */
const SEEDED_USERS_REFERRED = 18;
const SEEDED_TOTAL_WAGERED = 42910;
const SEEDED_TOTAL_EARNED = 1284;

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
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface text-[var(--rc-text)] transition-opacity hover:opacity-80"
            >
              <BackChevron />
            </button>
            <h1 className="text-[19px] font-bold uppercase tracking-[0.6px] text-[var(--rc-text)]">Affiliate Program</h1>
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
                    tab === t ? 'bg-brand text-white' : 'bg-surface text-[var(--rc-text)]',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-0.5 -top-px -bottom-px w-[38px]"
              style={{ opacity: leftFade, transition: 'opacity 180ms ease', background: 'linear-gradient(to right, var(--rc-bg) 0%, var(--rc-bg) 12%, transparent 100%)' }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-0.5 -top-px -bottom-px w-[54px]"
              style={{ opacity: rightFade, transition: 'opacity 180ms ease', background: 'linear-gradient(to left, var(--rc-bg) 0%, var(--rc-bg) 12%, transparent 100%)' }}
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
      className="flex-none text-[var(--rc-muted)]"
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
      <span className={cn('font-bold uppercase tracking-[0.6px] text-[var(--rc-text)]', size === 22 ? 'text-[22px]' : 'text-[19px]')} style={{ fontFamily: ARIAL }}>
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
        <span className="text-[15px] font-bold leading-[1.3] text-[var(--rc-text)]">
          <span className="text-success">Step {n}:</span> {title}
        </span>
        <Triangle open={open} small />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 330ms cubic-bezier(0.22,0.61,0.36,1)' }}>
        <div className="overflow-hidden">
          <div style={{ opacity: open ? 1 : 0, transition: 'opacity 260ms ease' }} className="px-[18px] pb-4 text-[14px] leading-[20px] text-[var(--rc-text)]/90">
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
        <span className="flex-none text-[11px] font-bold uppercase tracking-[1.2px] text-[var(--rc-text)]">{label}</span>
        <span
          data-testid={`${testid}-value`}
          className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[14px] font-bold tracking-[0.6px] text-[var(--rc-text)]"
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

/** One Overview stats tile (`Affiliate Page.dc.html` lines 958-961: `--rc-surface`, radius 20px,
 *  16px 18px padding, 6px gap; 11px bold micro-label, 24px Space Grotesk 700 green value). */
function StatTile({ testid, label, value }: { testid: string; label: string; value: string }) {
  return (
    <div data-testid={testid} className="flex flex-col gap-1.5 rounded-[20px] bg-surface px-[18px] py-4">
      <span className="text-[11px] font-bold uppercase tracking-[1.2px] text-[var(--rc-text)]" style={{ fontFamily: ARIAL }}>{label}</span>
      <span className="text-[24px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>{value}</span>
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
      {/* Hero — no card wrapper; sits directly on the page background per `Affiliate Page.dc.html`
       *  lines 917-954 (the previous `rounded-[26px] bg-surface p-5` panel didn't exist there). */}
      <div className="relative flex flex-col items-center pb-1">
        <div className="relative flex w-full items-center justify-center">
          <img
            src={affiliateMegaphoneArt}
            alt=""
            aria-hidden="true"
            className="relative left-[-14px] top-[-16px] block w-full max-w-[340px]"
          />
        </div>
        <div className="-mt-[34px] flex w-full items-center gap-2.5">
          <span className="text-[58px] font-bold leading-[58px] tracking-[-1.6px] text-success" style={{ fontFamily: SPACE_GROTESK }}>{BASE_COMMISSION_RATE}</span>
          <div className="flex flex-col">
            <span className="text-[20px] font-bold uppercase leading-[27px] tracking-[0.6px] text-success" style={{ fontFamily: ARIAL }}>Commission</span>
            <span className="text-[20px] font-bold uppercase leading-[27px] tracking-[0.6px] text-success" style={{ fontFamily: ARIAL }}>Rate</span>
          </div>
        </div>
        <div className="mt-2 w-full text-[31px] font-bold leading-[34px] tracking-[0.6px] text-[var(--rc-text)]" style={{ fontFamily: ARIAL }}>
          EARN DOUBLE THE MARKET STANDARD
        </div>
        <p className="mt-[11px] w-full text-justify text-[15px] font-semibold leading-[20px] text-[var(--rc-text)]">
          The biggest crypto casinos pay 10% — we pay {BASE_COMMISSION_RATE}. Your cut comes from the rake on every game your referrals play — there is no negative carryover, you get paid when they wager, win or lose.
        </p>

        <div className="mt-5 w-full">
          <CopyField testid="affiliate-copy-link" label="LINK:" value={`https://rapidclash.com/r/${refCode}`} onCopy={onCopyLink} />
        </div>
        <div className="mt-2.5 w-full">
          <CopyField testid="affiliate-copy-code" label="CODE:" value={refCode} onCopy={onCopyCode} />
        </div>
      </div>

      {/* Stats — new (issue #448). Grid + art per `Affiliate Page.dc.html` lines 956-972. */}
      <section className="grid items-center gap-[14px]" style={{ gridTemplateColumns: 'calc(50% - 5px) 1fr' }}>
        <div className="grid grid-cols-1 gap-2.5">
          <StatTile testid="affiliate-stat-users-referred" label="USERS REFERRED" value={SEEDED_USERS_REFERRED.toLocaleString('en-US')} />
          <StatTile testid="affiliate-stat-total-wagered" label="TOTAL WAGERED" value={SEEDED_TOTAL_WAGERED.toLocaleString('en-US')} />
          <StatTile testid="affiliate-stat-total-earned" label="TOTAL EARNED" value={SEEDED_TOTAL_EARNED.toLocaleString('en-US')} />
        </div>
        <div className="flex items-center justify-center overflow-hidden">
          <img src={affiliateMoneyArt} alt="" aria-hidden="true" className="block h-auto w-[130%] max-w-none flex-none" />
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
            <p className="text-[14px] leading-[20px] text-[var(--rc-text)]/90">Every game on RapidClash generates commission based on its rake. The commission is calculated using this formula:</p>
            <div className="rounded-[20px] bg-[var(--rc-bg)] px-4 py-3 text-center text-[14px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>
              (Rake % × wagered × Commission rate) / 2
            </div>
            <p className="text-[14px] leading-[20px] text-[var(--rc-text)]/90">No negative carryover. Rake is charged on every game, so you earn whether your referral wins or loses. A winning player never wipes out your balance.</p>
          </div>
        </ExpandableRow>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<GiftHeadlineIcon />} title="What your players get" size={22} />
        <ExpandableRow testid="affiliate-players" icon={<GiftBoxIcon />} headline={<RowHeadline>Welcome benefits</RowHeadline>} open={playersOpen} onToggle={onTogglePlayers}>
          <p className="text-[14px] leading-[20px] text-[var(--rc-text)]/90">Your players skip straight to Bronze tier — a 4% rakeback from their first game, race entry, and a real place on the VIP ladder. Everyone else starts unranked at 0% and plays 50 games to get there.</p>
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
          <p className="text-[14px] leading-[20px] text-[var(--rc-text)]/90">If you&apos;re a content creator or professional affiliate with a large audience, we&apos;ll make a tailored partnership program for you. Contact our affiliate team to find out more.</p>
        </ExpandableRow>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeadline icon={<PromoHeadlineIcon />} title="Promotional materials" size={22} />
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
          <p className="text-[14px] leading-[20px] text-[var(--rc-text)]/90">Our team has put together banners, logos and game artwork - everything you need, ready to use across all socials and streams.</p>
        </ExpandableRow>
      </section>
    </div>
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
            <div className="flex h-10 items-end pb-2.5 text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--rc-text)]">
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
          <span data-testid="affiliate-referred-empty" className="text-[14px] font-semibold text-[var(--rc-text)]">No referred users</span>
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
          <p className="py-6 text-center text-[13px] font-semibold text-[var(--rc-muted)]">No campaigns yet</p>
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
          <div className="truncate text-[15px] font-bold text-[var(--rc-text)]">{campaign.name}</div>
          <div className="truncate text-[12px] font-semibold text-[var(--rc-muted)]">{link}</div>
        </div>
        <div className="flex flex-none flex-col items-start gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Commission earned</span>
          <RcAmount value={campaign.earned} className="text-[14px] font-bold text-success" />
        </div>
        <Triangle open={open} />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 330ms cubic-bezier(0.22,0.61,0.36,1)' }}>
        <div className="overflow-hidden">
          <div style={{ opacity: open ? 1 : 0, transition: 'opacity 260ms ease' }} className="px-[18px] pb-5">
            <div className="mb-4 h-px bg-[var(--rc-bg)]" />
            <div className="flex gap-3.5">
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Signups</div>
                <div className="mt-1 text-[16px] font-bold text-[var(--rc-text)]" style={{ fontFamily: SPACE_GROTESK }}>{campaign.signups}</div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Commission rate</div>
                <div className="mt-1 text-[16px] font-bold text-success" style={{ fontFamily: SPACE_GROTESK }}>{BASE_COMMISSION_RATE}</div>
              </div>
            </div>
            <div className="mt-3.5">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Referral link</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-full bg-[var(--rc-bg)] px-4 py-2.5 text-[12px] font-bold text-[var(--rc-text)]" style={{ fontFamily: SPACE_GROTESK }}>{link}</div>
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
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Referral code</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-full bg-[var(--rc-bg)] px-4 py-2.5 text-[13px] font-bold tracking-[1px] text-[var(--rc-text)]" style={{ fontFamily: SPACE_GROTESK }}>{campaign.code}</div>
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
          className="mx-auto mb-5 h-[5px] w-14 flex-none rounded-full bg-[var(--rc-muted)]/40"
        />
        <h2 className="text-[22px] font-bold text-[var(--rc-text)]">Create campaign</h2>

        <label className="mt-5 block text-[11px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]" htmlFor="affiliate-campaign-name">
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
            'mt-2 h-[50px] w-full rounded-full bg-[var(--rc-bg)] px-5 text-[14px] font-semibold text-[var(--rc-text)] outline-none',
            error ? 'border-[1.5px] border-[var(--rc-danger)]' : 'border-[1.5px] border-transparent',
          )}
        />
        {error && (
          <p data-testid="affiliate-campaign-name-error" className="mt-1.5 text-[12.5px] font-bold text-[var(--rc-danger)]">
            Campaign name is required
          </p>
        )}

        <div className="mt-4">
          <span className="block text-[11px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Code (campaign ID)</span>
          <div
            data-testid="affiliate-campaign-code-preview"
            className="mt-2 flex h-[50px] w-full items-center rounded-full bg-[var(--rc-bg)] px-5 text-[14px] font-bold tracking-[1px] text-[var(--rc-muted)]"
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
            trimmed === '' ? 'bg-[var(--rc-bg)] text-[var(--rc-muted)]' : 'bg-brand text-white',
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
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Total claimed</div>
            <RcAmount value={claimed} size={19} className="mt-1.5 text-[22px] font-bold text-[var(--rc-text)]" />
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-[26px] bg-surface p-5">
          <CoinStackIcon />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--rc-text)]">Total claimable</div>
            <RcAmount value={claimable} size={19} className="mt-1.5 text-[22px] font-bold text-success" />
          </div>
          <button
            type="button"
            data-testid="affiliate-claim"
            disabled={!canClaim}
            onClick={onClaim}
            className={cn(
              'flex h-11 flex-none items-center justify-center rounded-full px-6 text-[12px] font-bold uppercase tracking-[1px]',
              canClaim ? 'bg-brand text-white' : 'bg-[var(--rc-bg)] text-[var(--rc-muted)]',
            )}
          >
            Claim
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeadline icon={<NotebookIcon />} title="Claim history" />
        {history.length === 0 ? (
          <p data-testid="affiliate-claim-history-empty" className="py-6 text-center text-[13px] font-semibold text-[var(--rc-muted)]">No claims yet</p>
        ) : (
          <div className="flex flex-col gap-0.5 overflow-hidden rounded-[20px]" data-testid="affiliate-claim-history">
            <div className="flex h-10 items-center px-4 text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--rc-text)]">
              <span className="flex-1">Date</span>
              <span className="flex-1 text-center">Amount</span>
              <span className="flex-1 text-right">Status</span>
            </div>
            {history.map((h) => (
              <div key={h.id} data-testid={`affiliate-claim-${h.id}`} className="flex h-[54px] items-center bg-surface px-4">
                <span className="flex-1 text-[13px] text-[var(--rc-text)]">{h.date}</span>
                <RcAmount value={h.amount} className="flex-1 justify-center text-[13px] font-bold text-[var(--rc-text)]" />
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

/** The lightning-bolt glyph inside {@link ShieldIcon}, traced verbatim (coordinates included)
 *  from the design source's `commShieldClip` shield markup (`Affiliate Page.dc.html` ~line 1024)
 *  rather than hand-drawn — see issue #452 item 2. */
const SHIELD_BOLT_PATH =
  'M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z';

function ShieldIcon() {
  return (
    <svg width="84" height="84" viewBox="0 0 24 24" className="flex-none overflow-visible text-brand" aria-hidden="true">
      <defs>
        <clipPath id="affShieldClip">
          <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" />
        </clipPath>
      </defs>
      {/* Base shield + shine clipped to the outline (design source's own fix for the shine
       *  bleeding past the lower-left edge — issue #452 item 2). */}
      <g clipPath="url(#affShieldClip)">
        <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill="currentColor" />
        <path d="M12 2.2 3.6 5v6.6c0 5 3.5 8.6 8.4 10.2z" fill="#A870F0" />
        <path d="M12 2.2 20.4 5 3.6 21.8z" fill="#BFB8D6" opacity="0.28" />
      </g>
      <g transform="translate(6.51 5.65) scale(0.0313)">
        <path fill="#EDEAFB" d={SHIELD_BOLT_PATH} />
      </g>
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
      {/* Facet colors sourced verbatim from the design's `partnerStarClip` markup (resolving its
       *  `starShine`/`starShine2` template vars to #B49BF0/#9A7AEA) — issue #452 item 3 fix for
       *  the upper-left facet rendering near-white/flat instead of a shaded mid-tone purple. */}
      <g clipPath="url(#affPartnerStarClip)" transform="translate(4.5,5.23) scale(1.625)">
        <path d="M0.69 7.81 6.7 13 12 11.24Z" fill="#7C3AED" />
        <path d="M0.69 7.81 8.7 6.7 12 11.24Z" fill="#9A7AEA" />
        <path d="M12 -0.77 8.7 6.7 12 11.24Z" fill="#B49BF0" />
        <path d="M12 -0.77 15.3 6.7 12 11.24Z" fill="#A870F0" />
        <path d="M4.98 20.81 6.7 13 12 11.24Z" fill="#6D28D9" />
        <path d="M4.98 20.81 12 16.8 12 11.24Z" fill="#7C3AED" />
        <path d="M23.31 7.81 15.3 6.7 12 11.24Z" className="fill-brand" />
        <path d="M23.31 7.81 17.3 13 12 11.24Z" fill="#7C3AED" />
        <path d="M19.02 20.81 17.3 13 12 11.24Z" fill="#6D28D9" />
        <path d="M19.02 20.81 12 16.8 12 11.24Z" fill="#5B21B6" />
      </g>
      <path d="M35.6 11.4l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#FFFFFF" />
      <path d="M12.4 30.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#FFFFFF" />
      <path d="M13.2 13.6l.55 1.4 1.4.55-1.4.55-.55 1.4-.55-1.4-1.4-.55 1.4-.55z" fill="#FFFFFF" />
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

/** Promotional Materials heading icon (issue #452 item 4) — a genuinely distinct small icon
 *  sourced from the design file's own heading markup (`Affiliate Page.dc.html` ~line 1112: a
 *  document/panel glyph), not the row's `ScreenPanelIcon` reused at a smaller size like before. */
function PromoHeadlineIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" className="flex-none" aria-hidden="true">
      <rect x="3" y="3.4" width="18" height="17.2" rx="3.2" className="fill-brand" />
      <g className="fill-[var(--rc-bg)]">
        <rect x="6.2" y="6.6" width="11.6" height="2.4" rx="1.2" />
        <rect x="6.2" y="10.2" width="5" height="2.4" rx="1.2" />
        <rect x="12.8" y="10.2" width="5" height="2.4" rx="1.2" />
        <rect x="6.2" y="13.8" width="9.2" height="2.4" rx="1.2" />
      </g>
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
      <rect x="15.4" y="13.4" width="4.4" height="2.8" rx="1.4" className="fill-[var(--rc-bg)]" />
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
      <g className="fill-[var(--rc-bg)]">
        <rect x="8" y="6.6" width="10" height="2.2" rx="1.1" />
        <rect x="8" y="10.4" width="10" height="2.2" rx="1.1" />
        <rect x="8" y="14.2" width="6.4" height="2.2" rx="1.1" />
      </g>
    </svg>
  );
}
