import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Coins,
  DollarSign,
  EyeOff,
  Gift,
  Megaphone,
  Monitor,
  Moon,
  Sun,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMuted, subscribe, toggleMute } from '../lib/sound.js';
import { useTheme } from '../lib/theme.js';

interface Props {
  /** Back button → returns to the Account (ProfileHub) screen. */
  onBack(): void;
}

const CURRENCIES: Array<{ code: string; symbol: string }> = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'JPY', symbol: '¥' },
  { code: 'BRL', symbol: 'R$' },
  { code: 'INR', symbol: '₹' },
];

// All preferences persist to localStorage only (issue #401 point 2) — no server table/endpoint.
// Exception: sound (below) — that toggle controls the real `lib/sound.ts` mute module (issue
// #418), which already persists itself under its own `rc:sound:muted` key, so there's no
// `gameSound` entry here anymore (would've been a second, redundant source of truth).
// Theme's own storage key ('rc_pref_theme') now lives in lib/theme.ts, the single source of
// truth for both reading AND writing it (issue #472) — kept out of this KEYS map so there's no
// second place that could drift out of sync with it.
const KEYS = {
  tips: 'rc_pref_tips',
  tipNotifsDisabled: 'rc_pref_tipNotifsDisabled',
  cashDisplay: 'rc_pref_cashDisplay',
  currency: 'rc_pref_currency',
  stealthMode: 'rc_pref_stealthMode',
  marketing: 'rc_pref_marketing',
} as const;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}
function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* localStorage may be unavailable — the in-memory state still works for this session */
  }
}
function readCurrency(): string {
  try {
    const stored = window.localStorage.getItem(KEYS.currency);
    return stored && CURRENCIES.some((c) => c.code === stored) ? stored : 'USD';
  } catch {
    return 'USD';
  }
}

/**
 * Preferences — a sub-page reached from the Account screen (issue #401, Account redesign Part A).
 * Most toggles here are persisted-only preferences: no tipping ledger, currency conversion, or
 * marketing pipeline actually exists behind these yet (see the issue's explicit scope calls). Two
 * exceptions have real, live behavior: the Appearance radio group (issue #472 — now app-wide, via
 * `lib/theme.ts`'s `useTheme()`; this screen no longer maintains its own locally-scoped clone,
 * it just reads/writes the shared `--rc-*` tokens like everything else will as later tickets
 * thread light mode through), and the Sound effects toggle (issue #418 — wired directly to
 * `lib/sound.ts`'s real mute module, the same one `ChessHub.tsx` gates its `play()` calls on;
 * this used to be decorative-only, with its own `MuteToggle` living on the Account page instead —
 * that control has moved here, its home per the design spec, and now actually drives global mute
 * state).
 */
export function PreferencesHubScreen({ onBack }: Props) {
  const { choice: theme, setChoice: pickTheme } = useTheme();
  // Sound ON is this toggle's own polarity — the inverse of the module's `isMuted()` (issue
  // #418). `subscribe()` keeps this row in sync if mute is ever flipped elsewhere (defense in
  // depth — nothing else should mute after this fix, but the module's contract is there to use).
  const [gameSound, setGameSound] = useState(() => !isMuted());
  useEffect(() => subscribe(() => setGameSound(!isMuted())), []);
  // Tipping toggles are disabled/non-interactive (issue #401 point 3 — Owner-overridden, visible
  // but inert). Their initial values still rehydrate from storage so a re-enabled future ticket
  // picks up whatever was last persisted, but nothing in THIS screen can change them.
  const [tips] = useState(() => readBool(KEYS.tips, true));
  const [tipNotifsDisabled] = useState(() => readBool(KEYS.tipNotifsDisabled, false));
  const [cashDisplay, setCashDisplay] = useState(() => readBool(KEYS.cashDisplay, false));
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currency, setCurrency] = useState<string>(readCurrency);
  const [stealthMode, setStealthMode] = useState(() => readBool(KEYS.stealthMode, false));
  const [marketing, setMarketing] = useState(() => readBool(KEYS.marketing, true));

  const handleGameSound = useCallback(() => {
    toggleMute(); // flips lib/sound.ts's real mute state; the subscribe() above syncs `gameSound`
  }, []);

  const handleCashDisplay = useCallback(() => {
    setCashDisplay((prev) => {
      const next = !prev;
      writeBool(KEYS.cashDisplay, next);
      if (!next) setCurrencyOpen(false); // turning cash display off collapses the currency grid too
      return next;
    });
  }, []);

  const handleToggleCurrencyList = useCallback(() => {
    setCurrencyOpen((prev) => !prev);
  }, []);

  const pickCurrency = useCallback((code: string) => {
    setCurrency(code);
    try {
      window.localStorage.setItem(KEYS.currency, code);
    } catch {
      /* in-memory state still reflects the choice for this session */
    }
    setCurrencyOpen(false);
  }, []);

  const handleStealth = useCallback(() => {
    setStealthMode((prev) => {
      const next = !prev;
      writeBool(KEYS.stealthMode, next);
      return next;
    });
  }, []);

  const handleMarketing = useCallback(() => {
    setMarketing((prev) => {
      const next = !prev;
      writeBool(KEYS.marketing, next);
      return next;
    });
  }, []);

  const activeCurrency = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  return (
    <div
      data-testid="preferences-hub"
      className="min-h-screen bg-[var(--rc-bg)] pb-12 text-[var(--rc-text)]"
    >
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* Header — 38px circular back button + PREFERENCES headline (README §2 row anatomy). */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Account"
            data-testid="preferences-back"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--rc-surface)] text-[var(--rc-text)] transition-opacity hover:opacity-80"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[19px] font-bold uppercase tracking-[0.6px]">Preferences</h1>
        </div>

        {/* APPEARANCE — Dark/Light/System radio group (issue #472 adds System). Drives the
            app-wide theme via lib/theme.ts's useTheme(); no longer scoped to this screen. */}
        <Section title="Appearance">
          <Group>
            <RadioRow
              icon={<Moon className="h-[19px] w-[19px]" />}
              label="Dark"
              selected={theme === 'dark'}
              onSelect={() => pickTheme('dark')}
              testId="preferences-theme-dark"
            />
            <RadioRow
              icon={<Sun className="h-[19px] w-[19px]" />}
              label="Light"
              selected={theme === 'light'}
              onSelect={() => pickTheme('light')}
              testId="preferences-theme-light"
            />
            <RadioRow
              icon={<Monitor className="h-[19px] w-[19px]" />}
              label="System"
              selected={theme === 'system'}
              onSelect={() => pickTheme('system')}
              testId="preferences-theme-system"
            />
          </Group>
        </Section>

        {/* SOUND EFFECTS — wired to the real lib/sound.ts mute module (issue #418); this is the
            live control ChessHub.tsx's playback actually respects. */}
        <Section title="Sound effects">
          <Group>
            <ToggleRow
              icon={<Volume2 className="h-[19px] w-[19px]" />}
              label="Game sounds"
              checked={gameSound}
              onToggle={handleGameSound}
              testId="preferences-game-sound"
            />
          </Group>
          <Helper>Controls in-game audio. Volume follows your device settings.</Helper>
        </Section>

        {/* TIPPING — visible but disabled (issue #401 point 3, Owner-overridden). No ledger
            support for peer-to-peer tips exists; both toggles render inert. */}
        <Section title="Tipping">
          <Group>
            <ToggleRow
              icon={<Gift className="h-[19px] w-[19px]" />}
              label="Accept tips/rain"
              checked={tips}
              disabled
              testId="preferences-tips"
            />
          </Group>
          <Helper>By turning off, all tips from users will be completely blocked.</Helper>
          <Group className="mt-1.5">
            <ToggleRow
              icon={<Bell className="h-[19px] w-[19px]" />}
              label="Disable tips/rain notifications"
              checked={tipNotifsDisabled}
              disabled
              testId="preferences-tip-notifs"
            />
          </Group>
          <Helper>You&rsquo;ll still receive tips and rain, but you won&rsquo;t get notifications or emails about them.</Helper>
        </Section>

        {/* CURRENCY — UI-only toggle + picker grid, no conversion-rate/payment integration
            (issue #401 point 4). The select row is inert until "Show credits in cash value" is on. */}
        <Section title="Currency">
          <Group>
            <ToggleRow
              icon={<DollarSign className="h-[19px] w-[19px]" />}
              label="Show credits in cash value"
              checked={cashDisplay}
              onToggle={handleCashDisplay}
              testId="preferences-cash-display"
            />
            <button
              type="button"
              onClick={handleToggleCurrencyList}
              disabled={!cashDisplay}
              aria-expanded={currencyOpen && cashDisplay}
              data-testid="preferences-select-currency"
              className={cn(
                'flex h-14 w-full items-center gap-3 px-[18px] text-left transition-opacity',
                cashDisplay ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-40',
              )}
            >
              <span className="shrink-0 text-[var(--rc-muted)]">
                <Coins className="h-[19px] w-[19px]" />
              </span>
              <span className="flex-1 text-sm font-semibold">Select currency</span>
              <span className="shrink-0 text-[15px] font-bold text-[var(--rc-green)]">
                {activeCurrency.symbol} {activeCurrency.code}
              </span>
              <ChevronRight
                className={cn(
                  'h-3 w-3 shrink-0 text-[var(--rc-muted)] transition-transform duration-300',
                  currencyOpen && cashDisplay && 'rotate-90',
                )}
              />
            </button>
            {cashDisplay && currencyOpen && (
              <div className="grid grid-cols-4 gap-2 px-[18px] pb-4" data-testid="preferences-currency-grid">
                {CURRENCIES.map((c) => {
                  const active = c.code === currency;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => pickCurrency(c.code)}
                      aria-pressed={active}
                      data-testid={`preferences-currency-${c.code}`}
                      className={cn(
                        'flex h-10 items-center justify-center gap-1 rounded-full text-[13px] font-bold transition-colors',
                        active ? 'bg-brand text-white' : 'bg-[var(--rc-sunken)] text-[var(--rc-muted)]',
                      )}
                    >
                      <span>{c.symbol}</span>
                      <span>{c.code}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Group>
          <Helper>Display all amounts in your selected currency. Estimation based on current rates.</Helper>
        </Section>

        {/* PRIVACY */}
        <Section title="Privacy">
          <Group>
            <ToggleRow
              icon={<EyeOff className="h-[19px] w-[19px]" />}
              label="Stealth mode"
              checked={stealthMode}
              onToggle={handleStealth}
              testId="preferences-stealth"
            />
          </Group>
          <Helper>Keeps your username private across the platform.</Helper>
        </Section>

        {/* MARKETING */}
        <Section title="Marketing">
          <Group>
            <ToggleRow
              icon={<Megaphone className="h-[19px] w-[19px]" />}
              label="Receive marketing offers"
              checked={marketing}
              onToggle={handleMarketing}
              testId="preferences-marketing"
            />
          </Group>
        </Section>
      </div>
    </div>
  );
}

// ── Shared row primitives (local to this screen — the design's row/group anatomy, README §2) ──

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-[26px] flex flex-col gap-[11px]">
      <span className="text-xs font-bold uppercase tracking-[1.4px]">{title}</span>
      {children}
    </div>
  );
}

function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-[20px] bg-[var(--rc-surface)]', className)}>
      {children}
    </div>
  );
}

function Helper({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[12.5px] leading-[19px] text-[var(--rc-muted)]">{children}</p>;
}

function RadioRow({
  icon,
  label,
  selected,
  onSelect,
  testId,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect(): void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      className="flex h-[50px] w-full items-center gap-3 px-[18px] text-left"
    >
      <span className="shrink-0 text-[var(--rc-muted)]">{icon}</span>
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--rc-sunken)]">
        <span
          className={cn(
            'h-3 w-3 rounded-full transition-colors',
            selected ? 'bg-brand shadow-[var(--rc-theme-btn-shadow)]' : 'bg-transparent',
          )}
        />
      </span>
    </button>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onToggle,
  disabled,
  testId,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onToggle?(): void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      className={cn(
        'flex h-14 w-full items-center gap-3 px-[18px] text-left transition-opacity',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span className="shrink-0 text-[var(--rc-muted)]">{icon}</span>
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px] transition-colors',
          checked ? 'bg-brand' : 'bg-[var(--rc-sunken)]',
        )}
      >
        <span
          className="block h-5 w-5 rounded-full bg-white transition-[margin-left] duration-200"
          style={{ marginLeft: checked ? '20px' : '0px' }}
        />
      </span>
    </button>
  );
}
