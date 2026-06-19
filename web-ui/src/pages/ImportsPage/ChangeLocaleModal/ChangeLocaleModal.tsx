import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type ModImportJob } from '../../../api';
import { Button } from '../../../components/Button';
import { ModalShell } from '../../../components/ModalShell';
import { modListQueryKey } from '../../../langDefaults';
import { LANGUAGES } from '../importsShared';
import parentS from '../ImportPage.module.scss';
import s from './ChangeLocaleModal.module.scss';

interface ChangeLocaleModalProps {
  job: ModImportJob;
  gameId: string;
  onClose: () => void;
}

const labelForLocale = (code: string): string => {
  const known = LANGUAGES.find((lang) => lang.code === code);
  if (known) return known.label;
  const alias = LANGUAGES.find((lang) => code.toLowerCase().includes(lang.code));
  if (alias) return `${code} (${alias.label})`;
  return code;
};

/** Modal to relabel import locale in the database without re-importing files. */
export const ChangeLocaleModal = ({ job, gameId, onClose }: ChangeLocaleModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [lang, setLang] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: info, isLoading } = useQuery({
    queryKey: ['mod-import-locale-info', job.id],
    queryFn: () => api.modImport.localeInfo(job.id),
  });

  const localeOptions = useMemo(() => {
    if (!info) return [];

    const codes = new Set<string>();
    for (const locale of info.availableLocales) codes.add(locale);
    for (const locale of info.storedLangs) codes.add(locale);
    for (const option of LANGUAGES) codes.add(option.code);

    return [...codes]
      .sort((a, b) => labelForLocale(a).localeCompare(labelForLocale(b)))
      .map((code) => ({ code, label: labelForLocale(code) }));
  }, [info]);

  const effectiveLang =
    lang || localeOptions.find((opt) => opt.code !== info?.currentSrcLang)?.code || '';

  const changeMut = useMutation({
    mutationFn: () => api.modImport.changeLocale(job.id, effectiveLang),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['mod-imports'] });
      await qc.invalidateQueries({ queryKey: ['mod-import-locale-info', job.id] });
      await qc.invalidateQueries({ queryKey: modListQueryKey(gameId) });
      if (job.mod_id != null) {
        await qc.invalidateQueries({ queryKey: ['mod-stats', job.mod_id] });
        await qc.invalidateQueries({ queryKey: ['strings', job.mod_id] });
      }
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const header = (
    <div className={s.headerTop}>
      <div>
        <h2 className={parentS.modalHeaderTitle}>{t('modImport.changeLocaleTitle')}</h2>
        <span className={s.headerMeta}>{job.file_name}</span>
      </div>
      <button onClick={onClose} className={parentS.closeBtn} aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  );

  return (
    <ModalShell onClose={onClose} customHeader={header} hideCloseButton size="md">
      {isLoading || !info ? (
        <div className={s.loading}>{t('common.loading')}</div>
      ) : (
        <>
          <p className={s.currentLocale}>
            {t('modImport.changeLocaleCurrent', { lang: info.currentSrcLang })}
          </p>
          {info.storedLangs.length > 1 && (
            <p className={s.hint}>
              {t('modImport.changeLocaleMultipleStored', {
                langs: info.storedLangs.join(', '),
              })}
            </p>
          )}
          <p className={s.warning}>{t('modImport.changeLocaleWarning')}</p>

          <label className={parentS.langLabel}>
            {t('modImport.changeLocaleNew')}
            <select
              value={effectiveLang}
              onChange={(event) => {
                setLang(event.target.value);
                setError(null);
              }}
              className={parentS.select}
            >
              {localeOptions
                .filter((option) => option.code !== info.currentSrcLang)
                .map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <p className={s.hint}>
            {t('modImport.changeLocaleAffected', { count: info.stringCount.toLocaleString() })}
          </p>

          {error && <p className={s.error}>{error}</p>}

          <div className={parentS.footer}>
            <Button variant="secondary" onClick={onClose} disabled={changeMut.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="success"
              onClick={() => changeMut.mutate()}
              disabled={!effectiveLang || changeMut.isPending}
            >
              {changeMut.isPending ? t('common.saving') : t('modImport.changeLocaleConfirm')}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
};
