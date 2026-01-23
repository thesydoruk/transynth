/**
 * LoginPage — shown when MULTI_USER=true and the user is not authenticated.
 *
 * Provides a simple username/password form. On successful login, the auth
 * context updates and the main app renders.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from '../components/AuthContext';
import s from './LoginPage.module.scss';

export const LoginPage = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Handle form submission — authenticate with the backend. */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.wrapper}>
      <form className={s.card} onSubmit={handleSubmit}>
        <div className={s.brand}>FO4 Localizer</div>
        <div className={s.subtitle}>Sign in to continue</div>

        <div className={s.field}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className={s.field}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        {error && <div className={s.error}>{error}</div>}

        <button type="submit" className={s.button} disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
