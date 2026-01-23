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
import { api, type User } from '../api';
import { useAuth } from '../components/AuthContext';
import s from './UsersPage.module.scss';

/** Role display configuration. */
const ROLE_CLASSES: Record<string, string> = {
  admin: s.roleAdmin,
  reviewer: s.roleReviewer,
  translator: s.roleTranslator,
};

export const UsersPage = () => {
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
        <h2 className={s.title}>Users</h2>
        <div className={s.disabled}>
          User management is disabled in single-user mode.<br />
          Set <code>MULTI_USER=true</code> in <code>.env</code> to enable.
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className={s.page}>
      <h2 className={s.title}>Users</h2>

      {/* Create user form — admin only */}
      {isAdmin && (
        <form className={s.form} onSubmit={handleCreate}>
          <h3>Create User</h3>
          <div className={s.formRow}>
            <div className={s.formField}>
              <label>Username</label>
              <input
                value={newUser.username}
                onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
                required
              />
            </div>
            <div className={s.formField}>
              <label>Display Name</label>
              <input
                value={newUser.display_name}
                onChange={e => setNewUser(p => ({ ...p, display_name: e.target.value }))}
                required
              />
            </div>
            <div className={s.formField}>
              <label>Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                required
                minLength={4}
              />
            </div>
            <div className={s.formField}>
              <label>Role</label>
              <select
                value={newUser.role}
                onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
              >
                <option value="translator">Translator</option>
                <option value="reviewer">Reviewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <button type="submit" className={s.submitBtn} disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create User'}
          </button>
          {formError && <div className={s.error}>{formError}</div>}
        </form>
      )}

      {/* Users table */}
      <table className={s.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            {isAdmin && <th>Actions</th>}
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
              <td>{u.is_active ? 'Active' : 'Disabled'}</td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              {isAdmin && (
                <td>
                  {u.id !== currentUser?.id && (
                    <button
                      className={s.actionBtn}
                      onClick={() => toggleMut.mutate({ id: u.id, is_active: !u.is_active })}
                    >
                      {u.is_active ? 'Disable' : 'Enable'}
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
