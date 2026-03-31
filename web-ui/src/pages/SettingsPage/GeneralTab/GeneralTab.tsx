import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../components/ThemeContext';
import { UI_LANGUAGES } from '../../../i18n';
import {
  DEFAULT_SRC_LANG,
  DEFAULT_TGT_LANG,
  getContentLanguageOptions,
  LS_SRC_LANG,
  LS_TGT_LANG,
} from '../../../langDefaults';
import parentS from '../SettingsPage.module.scss';
import s from './GeneralTab.module.scss';

const CONTENT_LANGUAGE_OPTIONS = getContentLanguageOptions();

const getLsLang = (key: string, fallback: string): string => localStorage.getItem(key) ?? fallback;
const emitContentLanguageChange = (): void => {
  window.dispatchEvent(new Event('content-language-change'));
};

/** General settings tab for language and theme preferences stored in localStorage. */
export const GeneralTab = () => {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [srcLang, setSrcLang] = useState(() => getLsLang(LS_SRC_LANG, DEFAULT_SRC_LANG));
  const [tgtLang, setTgtLang] = useState(() => getLsLang(LS_TGT_LANG, DEFAULT_TGT_LANG));

  const handleSrcLang = (value: string) => {
    setSrcLang(value);
    localStorage.setItem(LS_SRC_LANG, value);
    emitContentLanguageChange();
  };

  const handleTgtLang = (value: string) => {
    setTgtLang(value);
    localStorage.setItem(LS_TGT_LANG, value);
    emitContentLanguageChange();
  };

  return (
    <>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.general.languagesTitle')}</h2>
        <p className={parentS.fieldNote}>{t('settings.general.languagesDesc')}</p>
        <br />
        <div className={parentS.fieldGrid}>
          <label className={parentS.fieldLabel}>{t('settings.general.srcLang')}</label>
          <select className={s.select} value={srcLang} onChange={(event) => handleSrcLang(event.target.value)}>
            {CONTENT_LANGUAGE_OPTIONS.map((language) => (
              <option key={language.code} value={language.code}>{language.label}</option>
            ))}
          </select>

          <label className={parentS.fieldLabel}>{t('settings.general.tgtLang')}</label>
          <select className={s.select} value={tgtLang} onChange={(event) => handleTgtLang(event.target.value)}>
            {CONTENT_LANGUAGE_OPTIONS.map((language) => (
              <option key={language.code} value={language.code}>{language.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.general.interfaceTitle')}</h2>
        <div className={parentS.fieldGrid}>
          <label className={parentS.fieldLabel}>{t('settings.general.uiLang')}</label>
          <select className={s.select} value={i18n.language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
            {UI_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>{language.label}</option>
            ))}
          </select>

          <label className={parentS.fieldLabel}>{t('settings.general.theme')}</label>
          <div>
            <button className={s.select} onClick={toggleTheme}>
              {theme === 'dark' ? t('settings.general.themeLight') : t('settings.general.themeDark')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
