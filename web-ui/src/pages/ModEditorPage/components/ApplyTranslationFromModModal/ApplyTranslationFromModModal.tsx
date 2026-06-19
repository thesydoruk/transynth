import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type ApplyImportedResult, type Mod } from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import { modListQueryKey } from '../../../../langDefaults';
import s from './ApplyTranslationFromModModal.module.scss';

interface ApplyTranslationFromModModalProps {
  modId: number;
  gameId: string;
  srcLang: string;
  targetLang: string;
  onClose: () => void;
  onApplied: (result: ApplyImportedResult) => void;
}

/** Pick a source mod + locale and copy its strings into the current mod as translations. */
export const ApplyTranslationFromModModal = ({
  modId,
  gameId,
  srcLang,
  targetLang,
  onClose,
  onApplied,
}: ApplyTranslationFromModModalProps) => {
  const { t } = useTranslation();
  const [sourceModId, setSourceModId] = useState<number | null>(null);
  const [importedLang, setImportedLang] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyImportedResult | null>(null);

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

  const localeOptions = useMemo(
    () => sourceLangs.filter((lang) => lang !== srcLang),
    [sourceLangs, srcLang],
  );

  const effectiveImportedLang =
    importedLang || localeOptions.find((lang) => lang !== srcLang) || localeOptions[0] || '';

  const applyMut = useMutation({
    mutationFn: () =>
      api.mods.applyImported(
        modId,
        effectiveSourceModId!,
        effectiveImportedLang,
        srcLang,
        targetLang,
      ),
    onSuccess: (data) => {
      setResult(data);
      onApplied(data);
    },
    onError: (err: Error) => setError(err.message),
  });

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
          disabled={modsLoading || sourceMods.length === 0}
          onChange={(event) => {
            setSourceModId(Number(event.target.value));
            setImportedLang('');
            setError(null);
            setResult(null);
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
          disabled={langsLoading || localeOptions.length === 0}
          onChange={(event) => {
            setImportedLang(event.target.value);
            setError(null);
            setResult(null);
          }}
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

      {error && <p className={s.error}>{error}</p>}
      {result && (
        <p className={s.result}>
          {t('modEditor.applyTranslationResult', {
            applied: result.applied,
            skipped: result.skipped,
            unmatched: result.unmatched,
            empty: result.empty,
          })}
        </p>
      )}

      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose} disabled={applyMut.isPending}>
          {result ? t('common.close') : t('common.cancel')}
        </Button>
        <Button
          variant="success"
          onClick={() => applyMut.mutate()}
          disabled={
            applyMut.isPending || effectiveSourceModId == null || !effectiveImportedLang || !!result
          }
        >
          {applyMut.isPending
            ? t('modEditor.applyTranslationApplying')
            : t('modEditor.applyTranslationConfirm')}
        </Button>
      </div>
    </ModalShell>
  );
};
