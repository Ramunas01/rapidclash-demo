import { useState, type FormEvent } from 'react';
import { api } from '../api.js';

interface Props {
  onLogin(token: string, playerId: string, balance: number): void;
}

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
      onLogin(res.token, res.playerId, res.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <h1>RapidClash</h1>
      <p>Human-vs-human gaming</p>
      <div className="tabs">
        <button className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>Register</button>
        <button className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Login</button>
      </div>
      <form onSubmit={handleSubmit}>
        <input
          className="input"
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          autoComplete="username"
          aria-label="Username"
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
          aria-label="Password"
        />
        {error && <p className="error-msg" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Please wait…' : tab === 'register' ? 'Create Account' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
