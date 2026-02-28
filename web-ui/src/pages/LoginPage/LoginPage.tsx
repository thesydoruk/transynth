/**
 * LoginPage — shown when MULTI_USER=true and the user is not authenticated.
 *
 * Provides a simple username/password form. On successful login, the auth
 * context updates and the main app renders.
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../components/AuthContext';
import s from './LoginPage.module.scss';

export const LoginPage = () => {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('login.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.wrapper}>
      <form className={s.card} onSubmit={handleSubmit}>
        <div className={s.brand}>{t('nav.brand')}</div>
        <div className={s.subtitle}>{t('login.signInTitle')}</div>

        <div className={s.field}>
          <label htmlFor="username">{t('login.username')}</label>
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
          <label htmlFor="password">{t('login.password')}</label>
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
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
};

