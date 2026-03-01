import { createContext } from 'react';
import type { User } from '../../api';

/** Shared auth context shape used by the provider and the hook wrapper. */
export interface AuthState {
  loading: boolean;
  multiUser: boolean;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** React context that carries the active authentication state. */
export const AuthContext = createContext<AuthState>({
  loading: true,
  multiUser: false,
  user: null,
  login: async () => {},
  logout: async () => {},
});