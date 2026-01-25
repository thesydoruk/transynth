/**
 * i18n configuration — initializes i18next with Ukrainian (default) and English.
 *
 * Uses localStorage-based language detector so the user's choice persists
 * across sessions. Falls back to Ukrainian if no preference is stored.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import uk from './locales/uk.json';
import en from './locales/en.json';

/** All available UI languages with their native display names. */
export const UI_LANGUAGES = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
    },
    fallbackLng: 'uk',
    interpolation: {
      escapeValue: false, // React already escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'ui-lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
