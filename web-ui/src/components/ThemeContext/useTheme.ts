import { useContext } from 'react';
import { ThemeContext, type ThemeCtx } from './themeStateContext';

/** Hook that returns the current theme and the toggle callback. */
export const useTheme = (): ThemeCtx => useContext(ThemeContext);