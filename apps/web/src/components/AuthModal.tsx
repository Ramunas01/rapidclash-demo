import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Lock, User, X } from 'lucide-react';
import type { AvatarId } from '@rapidclash/shared';
import { api } from '../api.js';
import { cn } from '@/lib/utils';

interface Props {
  /** Same shape as AuthScreen.onLogin — App stores the token and connects the WS. After sign-in
   *  the user lands on the intent's hub with the stake armed and presses PLAY to commit.
   *  `avatarId` is the player's own stored avatar (redaction-safe: own-session only). */
  onSuccess(token: string, playerId: string, balance: number, username: string, avatarId: AvatarId): void;
  /** "Play as guest" (CHARTER.md's guest-mode exception, issue #267) — a separate callback, not
   *  onSuccess with extra args, so it never changes onSuccess's existing call shape. Guest
   *  responses have a fixed username ('Guest') and avatarId ('default'), so neither is passed. */
  onGuestSuccess(token: string, playerId: string, balance: number): void;
  onClose(): void;
}

/**
 * Compact register-or-login step shown as a MODAL over the current hub (not a full-screen
 * detour) — the auth wall that fires only at the commit-to-play action. Reuses Auth.tsx's
 * alias+password → token logic (api.register / api.login); on success the App stores the token
 * and connects the WS, then lands the user on the game with the stake armed (they press PLAY to
 * commit — nothing auto-fires). A new registrant gets the 1000-credit grant.
 */
export function AuthModal({ onSuccess, onGuestSuccess, onClose }: Props) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  // On the body-scroll layout (#142) the page scrolls behind a fixed overlay; lock body
  // scroll while the auth wall is open so the form can't drift under the user.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = tab === 'register'
        ? await api.register({ username, password })
        : await api.login({ username, password });
      onSuccess(res.token, res.playerId, res.balance, res.username, res.avatarId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest() {
    setError('');
    setGuestLoading(true);
    try {
      const res = await api.guestAuth();
      onGuestSuccess(res.token, res.playerId, res.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGuestLoading(false);
    }
  }

  return (
    <div
      // z-10, BELOW HubToolbar's persistent nav (z-20, hub-chrome/HubToolbar.tsx) and HubRibbon's
      // header (z-20) — issue #497. This used to be z-40 (above both), which let this backdrop's
      // `bg-black/70 backdrop-blur-sm` paint over the fixed bottom nav whenever the auth sheet was
      // open. The prototype's own auth-sheet scrim (`RapidClash Full Spec.html` ~line 2452,
      // `z-index:7`) is the SAME z-index as its nav bar (~line 2724, also `z-index:7`) but is
      // declared EARLIER in the markup, so same-z DOM order puts the nav on top, undimmed — the
      // persistent tab bar stays legible/tappable while the login sheet is up. The design-fidelity
      // harness's `account-login-sheet.nav` diff (`tools/design-fidelity/`) caught the app
      // diverging from that: with this backdrop above the nav, the nav pill was rendering
      // dimmed+blurred behind it, which barely shows in dark theme (dark-on-near-black is a tiny
      // delta) but reads as a severe mismatch in light theme (light-on-near-black is a huge delta)
      // — a pixel-identical HubToolbar in both themes (verified directly: capturing the nav with no
      // modal open gives matching layouts in both themes) was being misread as a light-only
      // "vertical rhythm"/doubling bug in the diff image, when the actual cause was this stacking
      // order, not HubToolbar's own layout or any `--rc-*` token. Dropping below the nav/header
      // (rather than raising the nav above every current z-40+ overlay, which would also — wrongly
      // — uncover it from sheets that SHOULD stay on top, like HomeHub's sort sheet) matches the
      // prototype's specific choice for just this sheet without touching any other overlay's stack
      // position.
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      data-testid="auth-modal"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-base font-bold">
            Create an account or Login
          </span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
          <button
            type="button"
            onClick={() => { setTab('register'); setError(''); }}
            aria-pressed={tab === 'register'}
            data-testid="auth-tab-register"
            className={cn('rounded-lg py-2 text-sm font-semibold transition-all', tab === 'register' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => { setTab('login'); setError(''); }}
            aria-pressed={tab === 'login'}
            data-testid="auth-tab-login"
            className={cn('rounded-lg py-2 text-sm font-semibold transition-all', tab === 'login' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}
          >
            Login
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              aria-label="Username"
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-brand"
            />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              aria-label="Password"
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-brand"
            />
          </div>

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
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Please wait…</>) : tab === 'register' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Guest mode (CHARTER.md's documented exception): no form fields — mints an anonymous,
         *  ephemeral session and drops the visitor straight into the curated Coinflip preview
         *  against the honestly-labelled Demo Opponent. A link, not a third tab — deliberately
         *  secondary to signing up for the real platform. */}
        <button
          type="button"
          onClick={handleGuest}
          disabled={guestLoading}
          data-testid="auth-guest"
          className="mt-3 flex w-full items-center justify-center gap-2 text-xs font-semibold text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {guestLoading ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting demo…</>) : 'Play as guest instead'}
        </button>

        <p className="mt-4 text-center text-xs text-foreground">Play-money demo credits only, no real-money wagering.</p>
      </motion.div>
    </div>
  );
}
