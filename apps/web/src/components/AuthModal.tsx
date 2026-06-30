import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Lock, Swords, User, X } from 'lucide-react';
import { api } from '../api.js';
import { cn } from '@/lib/utils';

interface Props {
  /** Same shape as AuthScreen.onLogin — App stores the token, connects the WS, resumes intent. */
  onSuccess(token: string, playerId: string, balance: number, username: string): void;
  onClose(): void;
  /** Why the wall fired, e.g. "Sign in to play" / "Sign in to join". Plain "Sign in" by default. */
  title?: string;
}

/**
 * Compact register-or-login step shown as a MODAL over the current hub (not a full-screen
 * detour) — the auth wall that fires only at the commit-to-play action. Reuses Auth.tsx's
 * alias+password → token logic (api.register / api.login); on success the App stores the token,
 * connects the WS, and resumes the captured intent. A new registrant gets the 1000-credit grant.
 */
export function AuthModal({ onSuccess, onClose, title = 'Sign in to play' }: Props) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      onSuccess(res.token, res.playerId, res.balance, res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
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
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-base font-bold">
            <Swords className="h-4 w-4 text-brand" /> {title}
          </span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">Create an account (you get 1,000 play-money credits) or sign in — then your move continues automatically.</p>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
          <button
            type="button"
            onClick={() => { setTab('register'); setError(''); }}
            aria-pressed={tab === 'register'}
            data-testid="auth-tab-register"
            className={cn('rounded-lg py-2 text-sm font-semibold transition-all', tab === 'register' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}
          >
            Register
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
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Please wait…</>) : tab === 'register' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">Play-money demo · credits only, no real-money wagering.</p>
      </motion.div>
    </div>
  );
}
