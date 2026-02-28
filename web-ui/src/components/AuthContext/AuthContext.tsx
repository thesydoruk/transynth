/**
 * AuthContext — provides authentication state to the entire React app.
 *
 * On mount, queries /api/auth/mode to check if MULTI_USER is enabled.
 *  - single-user mode  → auto-loads the default admin, no login required.
 *  - multi-user mode   → checks /api/auth/me for an existing session cookie.
 *    If no valid session, renders the login page instead of the app.
 *
 * Exposes `user`, `multiUser`, `login()`, `logout()`, and `loading` to children.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type User } from '../../api';

interface AuthState {
  /** True while the initial auth check is in progress. */
  loading: boolean;
  /** Whether the server has MULTI_USER enabled. */
  multiUser: boolean;
  /** The currently authenticated user (always set after loading, even in single-user mode). */
  user: User | null;
  /** Authenticate with username/password. Throws on failure. */
  login: (username: string, password: string) => Promise<void>;
  /** Log out and clear the session. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  multiUser: false,
  user: null,
  login: async () => {},
  logout: async () => {},
});

/** Hook to access the auth context from any component. */
export const useAuth = (): AuthState => useContext(AuthContext);

/**
 * AuthProvider wraps the app and manages authentication lifecycle.
 * Place it above <BrowserRouter> in the component tree.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [multiUser, setMultiUser] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  /**
   * Initial bootstrap: check auth mode, then load user.
   * Runs once on mount.
   */
  useEffect(() => {
    (async () => {
      try {
        const { multiUser: mu } = await api.auth.mode();
        setMultiUser(mu);

        // Try to load the current user (works for both modes:
        // single-user always returns admin, multi-user returns the session user)
        const me = await api.auth.me();
        setUser(me);
      } catch {
        // In multi-user mode with no valid session, /api/auth/me returns 401
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** Authenticate with credentials. On success, updates the user state. */
  const login = useCallback(async (username: string, password: string) => {
    const u = await api.auth.login(username, password);
    setUser(u);
  }, []);

  /** Log out, clear session, and reset user state. */
  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, multiUser, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
