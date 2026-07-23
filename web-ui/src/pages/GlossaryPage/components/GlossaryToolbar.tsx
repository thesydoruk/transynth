import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { getContentLanguageOptions } from '../../../langDefaults';
import s from '../GlossaryPage.module.scss';

type GlossaryToolbarProps = {
  srcLang: string;
  tgtLang: string;
  q: string;
  newTerm: string;
  newTranslation: string;
  newTermRef: RefObject<HTMLInputElement | null>;
  addPending: boolean;
  addError: string | undefined;
  onSrcLangChange: (value: string) => void;
  onTgtLangChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onNewTermChange: (value: string) => void;
  onNewTranslationChange: (value: string) => void;
  onAdd: () => void;
};

export const GlossaryToolbar = ({
  srcLang,
  tgtLang,
  q,
  newTerm,
  newTranslation,
  newTermRef,
  addPending,
  addError,
  onSrcLangChange,
  onTgtLangChange,
  onQueryChange,
  onNewTermChange,
  onNewTranslationChange,
  onAdd,
}: GlossaryToolbarProps) => {
  const { t } = useTranslation();
  const languageOptions = getContentLanguageOptions();

  return (
    <>
      <div className={s.toolbar}>
        <label className={s.filterLabel}>
          {t('glossary.sourceLang')}
          <select
            value={srcLang}
            onChange={(e) => onSrcLangChange(e.target.value)}
            className={s.selectIndent}
          >
            {languageOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            <option value="">{t('common.all')}</option>
          </select>
        </label>
        <label className={s.filterLabel}>
          {t('glossary.targetLang')}
          <select
            value={tgtLang}
            onChange={(e) => onTgtLangChange(e.target.value)}
            className={s.selectIndent}
          >
            {languageOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            <option value="">{t('common.all')}</option>
          </select>
        </label>
        <input
          placeholder={t('glossary.filterPlaceholder')}
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          className={s.input}
        />
      </div>

      <div className={s.toolbarAdd}>
        <input
          ref={newTermRef}
          placeholder={t('glossary.sourceTermPlaceholder')}
          value={newTerm}
          onChange={(e) => onNewTermChange(e.target.value)}
          className={s.inputTerm}
        />
        <span className={s.arrow}>→</span>
        <input
          placeholder={t('glossary.translationPlaceholder')}
          value={newTranslation}
          onChange={(e) => onNewTranslationChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newTerm.trim() && onAdd()}
          className={s.inputTerm}
        />
        <button
          onClick={() => newTerm.trim() && onAdd()}
          disabled={addPending || !newTerm.trim()}
          className={s.btnAdd}
        >
          {t('glossary.addPair')}
        </button>
        {addError && <span className={s.addError}>{addError}</span>}
      </div>
    </>
  );
};
