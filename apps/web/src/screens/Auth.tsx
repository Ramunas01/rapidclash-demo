import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Lock, Shield, Swords, User, Users, Zap } from 'lucide-react';
import { api } from '../api.js';
import { cn } from '@/lib/utils';

interface Props {
  onLogin(token: string, playerId: string, balance: number, username: string): void;
}

/** Play-money trust cues lifted from the Base44 Home hero (no crypto/deposit framing). */
const HIGHLIGHTS = [
  { icon: Users, label: 'Player vs Player' },
  { icon: Shield, label: 'Never the house' },
  { icon: Zap, label: 'Instant settlement' },
] as const;

export function AuthScreen({ onLogin }: Props) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = tab === 'register'
        ? await api.register({ username, password })
        : await api.login({ username, password });
      onLogin(res.token, res.playerId, res.balance, res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0e18] px-4 py-10 text-white">
      {/* Brand glow backdrop. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#2d0f6b] via-[#120a33] to-[#0b0818]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 70% 80% at 50% 0%, rgba(139,61,255,0.30) 0%, transparent 60%)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Hero */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/40 bg-brand/15">
              <Swords className="h-5 w-5 text-brand" />
            </span>
            <span className="text-xl font-bold tracking-tight">RapidClash</span>
          </div>
          <h1 className="text-3xl font-bold leading-tight md:text-4xl">
            <span className="block">Players vs Players</span>
            <span className="block text-brand">Never the House</span>
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/70">
            Play-money duels against real opponents. No house edge — instant matches, instant settlement.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70"
              >
                <Icon className="h-3.5 w-3.5 text-brand" />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-sm">
          {/* Register / Login toggle */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => { setTab('register'); setError(''); }}
              aria-pressed={tab === 'register'}
              className={cn(
                'rounded-lg py-2 text-sm font-semibold transition-all',
                tab === 'register' ? 'bg-brand text-white shadow' : 'text-white/60 hover:text-white',
              )}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => { setTab('login'); setError(''); }}
              aria-pressed={tab === 'login'}
              className={cn(
                'rounded-lg py-2 text-sm font-semibold transition-all',
                tab === 'login' ? 'bg-brand text-white shadow' : 'text-white/60 hover:text-white',
              )}
            >
              Login
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoComplete="username"
                aria-label="Username"
                className="w-full rounded-xl border border-white/10 bg-[#0b0e18] py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-brand"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                aria-label="Password"
                className="w-full rounded-xl border border-white/10 bg-[#0b0e18] py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-brand"
              />
            </div>

            {error && (
              <p
                className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-300"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Please wait…
                </>
              ) : tab === 'register' ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-white/40">
            Play-money demo · credits only, no real-money wagering.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
