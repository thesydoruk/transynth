import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api, type ModVoiceResynthParams } from '../../api';
import { Button } from '../Button';
import { ModalShell } from '../ModalShell';
import s from './VoiceResynthDialog.module.scss';

export interface VoiceResynthDialogProps {
  open: boolean;
  onClose: () => void;
  modId: number;
  srcLang: string;
  targetLang: string;
  /** When set, only this character's takes are counted and re-synthesized. */
  speakerKey?: string | null;
  onStart: (params: ModVoiceResynthParams) => void;
}

const DEFAULT_BELOW = 0.3;
const DEFAULT_RETRIES = 4;
const COUNT_DEBOUNCE_MS = 300;

const parseUnit = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
};

const parseRetries = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= 8 ? v : null;
};

type DialogBodyProps = Pick<
  VoiceResynthDialogProps,
  'onClose' | 'modId' | 'targetLang' | 'speakerKey' | 'onStart'
> & {
  defaultBelow: number;
  defaultRetries: number;
};

/** Settings-seeded form body; mounted only while open so defaults are re-read each time. */
const DialogBody = ({
  onClose,
  modId,
  targetLang,
  speakerKey,
  onStart,
  defaultBelow,
  defaultRetries,
}: DialogBodyProps) => {
  const { t } = useTranslation();
  const uid = useId();
  const [belowRaw, setBelowRaw] = useState(String(defaultBelow));
  const [targetRaw, setTargetRaw] = useState(String(defaultBelow));
  const [retriesRaw, setRetriesRaw] = useState(String(defaultRetries));
  const [noWorse, setNoWorse] = useState(true);

  const below = parseUnit(belowRaw);
  const target = parseUnit(targetRaw);
  const retries = parseRetries(retriesRaw);

  // Debounce the threshold so typing does not fire a count request per keystroke.
  const [debouncedBelow, setDebouncedBelow] = useState(below);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedBelow(below), COUNT_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [below]);

  const speaker = speakerKey?.trim() || undefined;
  const countQuery = useQuery({
    queryKey: ['voiceLowSimilarityCount', modId, targetLang, debouncedBelow, speaker ?? null],
    queryFn: () =>
      api.voiceGenerate.lowSimilarityCount(modId, targetLang, debouncedBelow ?? 0, speaker),
    enabled: debouncedBelow != null,
    staleTime: 0,
    gcTime: 0,
  });

  const counting = below == null || debouncedBelow !== below || countQuery.isFetching;
  const count = countQuery.data?.count;
  const targetBelowThreshold = below != null && target != null && target < below;

  const handleBelowChange = (value: string) => {
    setBelowRaw(value);
    const next = parseUnit(value);
    if (next == null) return;
    // Raise the target with the threshold; a target the user lowered on purpose stays and warns.
    const currentTarget = parseUnit(targetRaw);
    if (currentTarget == null || currentTarget < next) setTargetRaw(value);
  };

  const canStart =
    below != null && target != null && retries != null && !counting && count != null && count > 0;

  const handleStart = () => {
    if (!canStart) return;
    onStart({ similarityBelow: below, targetSimilarity: target, retries, noWorse });
  };

  let countLine = '';
  if (counting) countLine = t('modEditor.voiceResynth.counting');
  else if (count === 0) countLine = t('modEditor.voiceResynth.nothing');
  else if (count != null)
    countLine = t(
      speaker ? 'modEditor.voiceResynth.countForSpeaker' : 'modEditor.voiceResynth.count',
      { count },
    );

  return (
    <>
      <div className={s.body}>
        <div className={s.field}>
          <label htmlFor={`${uid}-below`}>{t('modEditor.voiceResynth.below')}</label>
          <input
            id={`${uid}-below`}
            className={s.input}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={belowRaw}
            aria-invalid={below == null}
            onChange={(e) => handleBelowChange(e.target.value)}
          />
        </div>
        <div className={s.field}>
          <label htmlFor={`${uid}-target`}>{t('modEditor.voiceResynth.target')}</label>
          <input
            id={`${uid}-target`}
            className={s.input}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={targetRaw}
            aria-invalid={target == null}
            onChange={(e) => setTargetRaw(e.target.value)}
          />
          {targetBelowThreshold && (
            <span className={s.warning} role="status">
              {t('modEditor.voiceResynth.targetBelowThreshold')}
            </span>
          )}
        </div>
        <div className={s.field}>
          <label htmlFor={`${uid}-retries`}>{t('modEditor.voiceResynth.retries')}</label>
          <input
            id={`${uid}-retries`}
            className={s.input}
            type="number"
            min={0}
            max={8}
            step={1}
            value={retriesRaw}
            aria-invalid={retries == null}
            onChange={(e) => setRetriesRaw(e.target.value)}
          />
        </div>
        <div className={s.field}>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={noWorse}
              onChange={(e) => setNoWorse(e.target.checked)}
            />
            <span>{t('modEditor.voiceResynth.noWorse')}</span>
          </label>
          <span className={s.hint}>{t('modEditor.voiceResynth.noWorseHint')}</span>
        </div>
        <div className={s.count} aria-live="polite">
          {countLine}
        </div>
      </div>
      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose}>
          {t('modEditor.voiceResynth.cancel')}
        </Button>
        <Button variant="primary" onClick={handleStart} disabled={!canStart}>
          {t('modEditor.voiceResynth.start')}
        </Button>
      </div>
    </>
  );
};

/**
 * Parameters dialog for the "low similarity" voice job: threshold, target, retries and the
 * keep-old-take guard, with a live count of the takes the threshold would pick.
 */
export const VoiceResynthDialog = ({
  open,
  onClose,
  modId,
  targetLang,
  speakerKey,
  onStart,
}: VoiceResynthDialogProps) => {
  const { t } = useTranslation();
  const settingsQuery = useQuery({
    queryKey: ['projectSettings'],
    queryFn: () => api.projectSettings.getAll(),
    staleTime: 30_000,
    enabled: open,
  });

  if (!open) return null;

  const rawBelow = settingsQuery.data?.['voice.synth_retry_below'];
  const rawRetries = settingsQuery.data?.['voice.synth_retries'];
  const defaultBelow = typeof rawBelow === 'number' ? rawBelow : DEFAULT_BELOW;
  const defaultRetries = typeof rawRetries === 'number' ? rawRetries : DEFAULT_RETRIES;

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy="voice-resynth-title"
      title={<span id="voice-resynth-title">{t('modEditor.voiceResynth.title')}</span>}
      closeAriaLabel={t('common.close')}
    >
      {settingsQuery.isLoading ? (
        <div className={s.body}>{t('common.loading')}</div>
      ) : (
        <DialogBody
          onClose={onClose}
          modId={modId}
          targetLang={targetLang}
          speakerKey={speakerKey}
          onStart={onStart}
          defaultBelow={defaultBelow}
          defaultRetries={defaultRetries}
        />
      )}
    </ModalShell>
  );
};
