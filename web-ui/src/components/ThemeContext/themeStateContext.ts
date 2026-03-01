import { createContext } from 'react';

/** Theme variants supported by the application shell. */
export type Theme = 'dark' | 'light';

/** Theme context contract shared by provider and hook. */
export interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

/** React context storing the current UI theme. */
export const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {} });

/** Storage key used to persist the selected theme between sessions. */
export const STORAGE_KEY = 'fo4-theme';