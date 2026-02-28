/**
 * UsersPage — user management interface (admin only, multi-user mode).
 *
 * Displays a table of all users with role badges and status indicators.
 * Admins can create new users, edit roles, toggle active status,
 * and change passwords.
 *
 * In single-user mode, shows a friendly message that user management
 * is disabled.
 */

import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type User } from '../../api';
import { useAuth } from '../../components/AuthContext';
import s from './UsersPage.module.scss';

/** Role display configuration. */
const ROLE_CLASSES: Record<string, string> = {
  admin: s.roleAdmin,
  reviewer: s.roleReviewer,
  translator: s.roleTranslator,
};

export const UsersPage = () => {
  const { t } = useTranslation();
  const { multiUser, user: currentUser } = useAuth();
  const qc = useQueryClient();

  // Fetch all users
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
    enabled: multiUser,
  });

  // ── Create user form state ────────────────────────────────────────────────
  const [newUser, setNewUser] = useState({ username: '', display_name: '', password: '', role: 'translator' });
  const [formError, setFormError] = useState('');

  const createMut = useMutation({
    mutationFn: () => api.users.create(newUser),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setNewUser({ username: '', display_name: '', password: '', role: 'translator' });
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  /** Handle new user form submission. */
  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    createMut.mutate();
  };

  // ── Toggle active status ──────────────────────────────────────────────────
  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.users.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  // ── Single-user mode: show disabled message ──────────────────────────────
  if (!multiUser) {
    return (
      <div className={s.page}>
        <h2 className={s.title}>{t('users.title')}</h2>
        <div className={s.disabled}>
          {t('users.disabledMessage')}<br />
          {t('users.enableHint')}
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className={s.page}>
      <h2 className={s.title}>{t('users.title')}</h2>

      {/* Create user form — admin only */}
      {isAdmin && (
        <form className={s.form} onSubmit={handleCreate}>
          <h3>{t('users.createUser')}</h3>
          <div className={s.formRow}>
            <div className={s.formField}>
              <label>{t('login.username')}</label>
              <input
                value={newUser.username}
                onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
                required
              />
            </div>
            <div className={s.formField}>
              <label>{t('users.displayName')}</label>
              <input
                value={newUser.display_name}
                onChange={e => setNewUser(p => ({ ...p, display_name: e.target.value }))}
                required
              />
            </div>
            <div className={s.formField}>
              <label>{t('login.password')}</label>
              <input
                type="password"
                value={newUser.password}
                onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                required
                minLength={4}
              />
            </div>
            <div className={s.formField}>
              <label>{t('users.role')}</label>
              <select
                value={newUser.role}
                onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
              >
                <option value="translator">{t('users.translator')}</option>
                <option value="reviewer">{t('users.reviewer')}</option>
                <option value="admin">{t('users.admin')}</option>
              </select>
            </div>
          </div>
          <button type="submit" className={s.submitBtn} disabled={createMut.isPending}>
            {createMut.isPending ? t('users.creating') : t('users.createUser')}
          </button>
          {formError && <div className={s.error}>{formError}</div>}
        </form>
      )}

      {/* Users table */}
      <table className={s.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>{t('login.username')}</th>
            <th>{t('users.displayName')}</th>
            <th>{t('users.role')}</th>
            <th>{t('users.statusCol')}</th>
            <th>{t('users.created')}</th>
            {isAdmin && <th>{t('users.actionsCol')}</th>}
          </tr>
        </thead>
        <tbody>
          {users.map((u: User) => (
            <tr key={u.id} className={u.is_active ? '' : s.inactive}>
              <td>{u.id}</td>
              <td>{u.username}</td>
              <td>{u.display_name}</td>
              <td>
                <span className={`${s.roleBadge} ${ROLE_CLASSES[u.role] ?? ''}`}>
                  {u.role}
                </span>
              </td>
              <td>{u.is_active ? t('common.active') : t('common.disabled')}</td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              {isAdmin && (
                <td>
                  {u.id !== currentUser?.id && (
                    <button
                      className={s.actionBtn}
                      onClick={() => toggleMut.mutate({ id: u.id, is_active: !u.is_active })}
                    >
                      {u.is_active ? t('common.disable') : t('common.enable')}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

