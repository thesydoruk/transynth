import { useState, useEffect, type ReactNode } from 'react';
import { STORAGE_KEY, ThemeContext, type Theme } from './themeStateContext';

/**
 * Reads the saved theme from localStorage, falling back to 'dark'.
 * Also respects prefers-color-scheme on first visit (no stored value).
 */
const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

/**
 * Provides current theme and toggle function to the React tree.
 * Applies `data-theme` attribute on `<html>` for CSS custom property switching.
 */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((themeValue) => (themeValue === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};
