import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Mod } from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import { modListQueryKey } from '../../../../langDefaults';
import type { ApplyImportedState } from '../../hooks/useApplyImported';
import s from './ApplyTranslationFromModModal.module.scss';
import progressS from '../AiVerifyModal/AiVerifyModal.module.scss';

interface ApplyTranslationFromModModalProps {
  modId: number;
  gameId: string;
  srcLang: string;
  targetLang: string;
  job: ApplyImportedState & {
    isRunning: boolean;
    start: (fromModId: number, importedLang: string) => void;
    stop: () => void;
  };
  onClose: () => void;
}

/** Pick a source mod + locale and copy its strings into the current mod as translations. */
export const ApplyTranslationFromModModal = ({
  modId,
  gameId,
  srcLang,
  targetLang,
  job,
  onClose,
}: ApplyTranslationFromModModalProps) => {
  const { t } = useTranslation();
  const [sourceModId, setSourceModId] = useState<number | null>(null);
  const [importedLang, setImportedLang] = useState('');
  const { isRunning, done, total, stats, error, status, start, stop } = job;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isFinished = status === 'completed' || status === 'cancelled';
  const showProgress = isRunning || isFinished || status === 'failed';

  const { data: gameMods = [], isLoading: modsLoading } = useQuery({
    queryKey: modListQueryKey(gameId),
    queryFn: () => api.mods.list(gameId),
    staleTime: 30_000,
  });

  const sourceMods = useMemo(
    () => gameMods.filter((mod: Mod) => mod.id !== modId),
    [gameMods, modId],
  );

  const effectiveSourceModId = sourceModId ?? sourceMods[0]?.id ?? null;

  const { data: sourceLangs = [], isLoading: langsLoading } = useQuery({
    queryKey: ['mod-langs', effectiveSourceModId],
    queryFn: () => api.mods.langs(effectiveSourceModId!),
    enabled: effectiveSourceModId != null,
    staleTime: 30_000,
  });

  const localeOptions = useMemo(() => [...sourceLangs].sort(), [sourceLangs]);

  const effectiveImportedLang = useMemo(() => {
    if (importedLang && localeOptions.includes(importedLang)) return importedLang;
    return (
      localeOptions.find((lang) => lang !== srcLang && lang !== targetLang) ??
      localeOptions.find((lang) => lang !== srcLang) ??
      localeOptions.find((lang) => lang === targetLang) ??
      localeOptions[0] ??
      ''
    );
  }, [importedLang, localeOptions, srcLang, targetLang]);

  const formDisabled = isRunning || isFinished;

  return (
    <ModalShell
      title={t('modEditor.applyTranslationFromModTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
    >
      <p className={s.intro}>{t('modEditor.applyTranslationFromModIntro')}</p>

      <label className={s.field}>
        <span className={s.label}>{t('modEditor.applyTranslationSourceMod')}</span>
        <select
          className={s.select}
          value={effectiveSourceModId ?? ''}
          disabled={modsLoading || sourceMods.length === 0 || formDisabled}
          onChange={(event) => {
            setSourceModId(Number(event.target.value));
            setImportedLang('');
          }}
        >
          {sourceMods.length === 0 ? (
            <option value="">{t('modEditor.applyTranslationNoSourceMods')}</option>
          ) : (
            sourceMods.map((mod) => (
              <option key={mod.id} value={mod.id}>
                {mod.name} (#{mod.id})
              </option>
            ))
          )}
        </select>
      </label>

      <label className={s.field}>
        <span className={s.label}>{t('modEditor.applyTranslationSourceLocale')}</span>
        <select
          className={s.select}
          value={effectiveImportedLang}
          disabled={langsLoading || localeOptions.length === 0 || formDisabled}
          onChange={(event) => setImportedLang(event.target.value)}
        >
          {localeOptions.length === 0 ? (
            <option value="">{t('modEditor.applyTranslationNoLocales')}</option>
          ) : (
            localeOptions.map((lang) => (
              <option key={lang} value={lang}>
                {lang.toUpperCase()}
              </option>
            ))
          )}
        </select>
      </label>

      <p className={s.hint}>
        {t('modEditor.applyTranslationTargetHint', {
          src: srcLang.toUpperCase(),
          target: targetLang.toUpperCase(),
          locale: effectiveImportedLang.toUpperCase() || '—',
        })}
      </p>

      {showProgress && (
        <div className={progressS.controls}>
          {isRunning ? (
            <Button variant="danger" size="sm" onClick={() => void stop()}>
              {t('modEditor.aiVerifyStop')}
            </Button>
          ) : null}
          <div className={progressS.progressWrap}>
            <div className={progressS.progressTrack}>
              <div className={progressS.progressFill} style={{ width: `${progressPct}%` }} />
            </div>
            <span className={progressS.progressLabel}>
              {isRunning
                ? t('modEditor.applyTranslationProgress', { done, total })
                : status === 'completed'
                  ? t('modEditor.applyTranslationResult', stats)
                  : status === 'cancelled'
                    ? t('modEditor.applyTranslationCancelled', { done, total, ...stats })
                    : status === 'failed'
                      ? t('modEditor.applyTranslationFailed')
                      : t('modEditor.applyTranslationIdle')}
            </span>
          </div>
        </div>
      )}

      {error && <p className={s.error}>{error}</p>}
      {isFinished && <p className={s.result}>{t('modEditor.applyTranslationResult', stats)}</p>}

      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
        {!isRunning && !isFinished && (
          <Button
            variant="success"
            onClick={() => {
              if (effectiveSourceModId == null || !effectiveImportedLang) return;
              void start(effectiveSourceModId, effectiveImportedLang);
            }}
            disabled={effectiveSourceModId == null || !effectiveImportedLang}
          >
            {t('modEditor.applyTranslationConfirm')}
          </Button>
        )}
      </div>
    </ModalShell>
  );
};
