import { useState, useEffect } from 'react';

/**
 * Observes theme-related attribute changes on the `<html>` element and forces
 * a re-render of the consuming component.  This ensures that runtime-computed
 * values (e.g. WCAG row-text contrast) update immediately when the user
 * switches between light / dark themes.
 *
 * The hook watches `data-theme`, `class`, and `style` attributes as well as a
 * custom `themechange` window event.  It is a fire-and-forget effect with no
 * return value.
 */
export function useThemeObserver(): void {
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    /** Bumps internal revision counter to trigger a re-render. */
    const bump = () => setRevision((v) => v + 1);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === 'attributes' &&
          (m.attributeName === 'data-theme' ||
            m.attributeName === 'class' ||
            m.attributeName === 'style')
        ) {
          bump();
          break;
        }
      }
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
    window.addEventListener('themechange', bump);

    return () => {
      observer.disconnect();
      window.removeEventListener('themechange', bump);
    };
  }, []);
}
