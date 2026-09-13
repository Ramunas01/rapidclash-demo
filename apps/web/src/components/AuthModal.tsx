import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AvatarId } from '@rapidclash/shared';
import { api } from '../api.js';
import { BottomSheet } from './hub-chrome/BottomSheet.js';

interface Props {
  /** Mirrors `BottomSheet`'s own `open` — this component is always mounted (see `App.tsx`'s
   *  render call) so the sheet's drag/settle transitions have something to animate FROM the very
   *  first time a session opens the auth wall, not just on the 2nd+ open (ticket 2026-09-13#4,
   *  item 3 — the same "nothing to animate from on first open" gap 2026-09-13#2 already fixed for
   *  the Menu overlay, second occurrence in a week). */
  open: boolean;
  /** Same shape as AuthScreen.onLogin — App stores the token and connects the WS. After sign-in
   *  the user lands on the intent's hub with the stake armed and presses PLAY to commit.
   *  `avatarId` is the player's own stored avatar (redaction-safe: own-session only). The caller
   *  (`App.tsx`'s `handleAuthSuccess`) is what actually closes the sheet (`setAuthOpen(false)`) —
   *  this component only clears its own local form fields on a successful submit, since it no
   *  longer unmounts on close and stale text would otherwise persist into the next open. */
  onSuccess(token: string, playerId: string, balance: number, username: string, avatarId: AvatarId): void;
  onClose(): void;
}

/**
 * The auth wall (register/login), rebuilt as a bottom sheet (ticket 2026-09-13#4) against the
 * prototype's own citations (`Full Spec.html:2452-2472`) — a full structural rebuild, not a
 * restyle: the previous shell was a centered `fixed inset-0 flex items-center justify-center`
 * modal, architecturally a different shape from a sheet. Reuses `BottomSheet` (drag-to-dismiss,
 * fixed 70% height, asymmetric 34/52px radius) — the same shared component `AffiliateHub.tsx`'s
 * `CreateCampaignSheet` now also sits on.
 *
 * Six items confirmed present in the previous shell and removed here, matching the prototype's
 * own markup exactly (no equivalent for any of them): the "Create an account or Login" heading,
 * the close X button, the `User`/`Lock` icons inside the inputs, the "Play as guest instead" link,
 * and the disclaimer paragraph.
 *
 * Guest mode itself (CHARTER.md's documented exception, issue #267) is NOT removed — only this
 * component's own in-sheet discovery link is gone. Guest auth remains fully reachable via the
 * separate, deliberate `?mode=guest` URL entry point (`App.tsx`'s `isGuestModeUrl()` /
 * `GUEST_MODE_CONTRACT.md` §1, issue #284), which calls `api.guestAuth()` directly and never
 * routed through this component's own `onGuestSuccess` callback in the first place — so this
 * component no longer needs that prop at all (removed, not left dead).
 *
 * Stacking order — preserved, not reintroduced as a regression: this sheet passes `zIndexClassName
 * ="z-10"` to `BottomSheet`, keeping it BELOW `HubToolbar`'s persistent nav (`z-20`,
 * `hub-chrome/HubToolbar.tsx`) and `HubRibbon`'s header (`z-20`) — issue #497. This used to be
 * `z-40` (above both), which let this sheet's scrim paint over the fixed bottom nav whenever the
 * auth wall was open. The prototype's own auth-sheet scrim (`Full Spec.html` ~line 2452,
 * `z-index:7`) is the SAME z-index as its nav bar (~line 2724, also `z-index:7`) but is declared
 * EARLIER in the markup, so same-z DOM order puts the nav on top, undimmed — the persistent tab
 * bar stays legible/tappable while the login sheet is up. The design-fidelity harness's
 * `account-login-sheet.nav` diff (`tools/design-fidelity/`) caught the app diverging from that —
 * see the original fix's history for the full story. Dropping below the nav/header (rather than
 * raising the nav above every other current overlay, which would wrongly uncover it from sheets
 * that SHOULD stay on top, like HomeHub's sort sheet) matches the prototype's specific choice for
 * just this sheet without touching any other overlay's stack position.
 *
 * Submit toast ("ACCOUNT CREATED" / "LOGGED IN", `Full Spec.html:4210-4212`): this app has no
 * app-level toast primitive to hook into cleanly (MenuOverlay's/AffiliateHub's own toasts are each
 * local, screen-scoped copies, not a shared mechanism) — not added here per the ticket's own
 * "don't add a new toast system" guidance; the structural rebuild is the priority.
 */
export function AuthModal({ open, onSuccess, onClose }: Props) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // On the body-scroll layout (#142) the page scrolls behind a fixed overlay; lock body scroll
  // while the auth wall is open so the form can't drift under the user. Now gated on `open`
  // (rather than running unconditionally on mount) since this component no longer unmounts on
  // close — it must release the lock when the sheet closes, not just when it's destroyed.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = tab === 'register'
        ? await api.register({ username, password })
        : await api.login({ username, password });
      setUsername('');
      setPassword('');
      onSuccess(res.token, res.playerId, res.balance, res.username, res.avatarId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function pickTab(next: 'register' | 'login') {
    setTab(next);
    setError('');
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      zIndexClassName="z-10"
      scrimTestId="auth-modal-scrim"
      sheetTestId="auth-modal"
      handleTestId="auth-modal-handle"
      aria-label={tab === 'register' ? 'Sign up' : 'Login'}
    >
      <h2 data-testid="auth-title" className="text-[22px] font-bold text-[var(--rc-text)]">
        {tab === 'register' ? 'Sign up' : 'Login'}
      </h2>

      {/* Mode toggle — colors/shadows identical to the Menu's own Dark/Light control
          (`MenuOverlay.tsx`'s `menu-appearance-dark`/`-light` buttons, ticket 2026-09-13#2), reusing
          the SAME `--rc-theme-toggle-*` tokens rather than adding duplicates. The prototype's own
          mode-toggle/submit buttons carry `onPointerDown="{{ navPress }}"` but no `data-nav`
          attribute — `navPress` no-ops without a `data-nav` key, so these buttons deliberately do
          NOT join the shared nav-bar-pop mechanism; they only get their own simple
          `translateY(3px)` press-sink, same family as the Menu's Dark/Light buttons. */}
      <div className="mt-5 flex gap-[10px] rounded-[24px] bg-surface p-1.5 pb-[11px]">
        <button
          type="button"
          data-testid="auth-tab-register"
          aria-pressed={tab === 'register'}
          onClick={() => pickTab('register')}
          className="flex h-[50px] flex-1 items-center justify-center rounded-[18px] text-sm font-semibold active:translate-y-[3px]"
          style={{
            background: tab === 'register' ? 'var(--brand-purple)' : 'var(--rc-theme-toggle-inactive-bg)',
            boxShadow: tab === 'register' ? 'var(--rc-theme-toggle-active-shadow)' : 'var(--rc-theme-toggle-inactive-shadow)',
            color: tab === 'register' ? '#FFFFFF' : 'var(--rc-muted)',
            transition: 'background 240ms ease, box-shadow 240ms ease, transform 120ms ease',
          }}
        >
          Sign up
        </button>
        <button
          type="button"
          data-testid="auth-tab-login"
          aria-pressed={tab === 'login'}
          onClick={() => pickTab('login')}
          className="flex h-[50px] flex-1 items-center justify-center rounded-[18px] text-sm font-semibold active:translate-y-[3px]"
          style={{
            background: tab === 'login' ? 'var(--brand-purple)' : 'var(--rc-theme-toggle-inactive-bg)',
            boxShadow: tab === 'login' ? 'var(--rc-theme-toggle-active-shadow)' : 'var(--rc-theme-toggle-inactive-shadow)',
            color: tab === 'login' ? '#FFFFFF' : 'var(--rc-muted)',
            transition: 'background 240ms ease, box-shadow 240ms ease, transform 120ms ease',
          }}
        >
          Login
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          aria-label="Username"
          className="h-[50px] w-full rounded-full bg-[var(--rc-bg)] px-5 text-sm font-semibold text-[var(--rc-text)] outline-none placeholder:text-[var(--rc-muted)]"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
          aria-label="Password"
          className="h-[50px] w-full rounded-full bg-[var(--rc-bg)] px-5 text-sm font-semibold text-[var(--rc-text)] outline-none placeholder:text-[var(--rc-muted)]"
        />

        {error && (
          <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="auth-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          data-testid="auth-submit"
          className="mt-1 flex h-[50px] w-full flex-none items-center justify-center gap-2 rounded-full bg-brand text-[13px] font-bold uppercase tracking-[1px] text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Please wait…</>) : tab === 'register' ? 'Create Account' : 'Sign In'}
        </button>
      </form>
    </BottomSheet>
  );
}
