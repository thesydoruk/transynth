import { useContext } from 'react';
import { AuthContext, type AuthState } from './authStateContext';

/** Hook to access the auth context from any component. */
export const useAuth = (): AuthState => useContext(AuthContext);