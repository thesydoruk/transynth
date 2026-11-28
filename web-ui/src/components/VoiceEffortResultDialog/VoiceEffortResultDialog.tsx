import { useTranslation } from 'react-i18next';
import type { VoiceEffortResult } from '../../api';
import { Button } from '../Button';
import { ModalShell } from '../ModalShell';
import s from './VoiceEffortResultDialog.module.scss';

export interface VoiceEffortResultDialogProps {
  result: VoiceEffortResult;
  /** The mod's display name; the dialog falls back to its id. */
  modName?: string;
  onClose: () => void;
}

/** What a finished vocal effort analysis found, shown once when the job ends. */
export const VoiceEffortResultDialog = ({
  result,
  modName,
  onClose,
}: VoiceEffortResultDialogProps) => {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    [t('modEditor.voiceEffortResult.takes'), String(result.takes)],
    [t('modEditor.voiceEffortResult.measured'), String(result.measured)],
    [t('modEditor.voiceEffortResult.failed'), String(result.failed)],
    [
      t('modEditor.voiceEffortResult.speakers'),
      t('modEditor.voiceEffortResult.speakersValue', {
        withBaseline: result.speakersWithBaseline,
        total: result.speakers,
      }),
    ],
    [t('modEditor.voiceEffortResult.shouting'), String(result.shouting)],
    [t('modEditor.voiceEffortResult.loud'), String(result.loud)],
  ];

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy="voice-effort-result-title"
      title={
        <span id="voice-effort-result-title">
          {t('modEditor.voiceEffortResult.title', { mod: modName ?? `#${result.modId}` })}
        </span>
      }
      closeAriaLabel={t('common.close')}
    >
      <div className={s.body}>
        <dl className={s.list}>
          {rows.map(([label, value]) => (
            <div key={label} className={s.row}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {result.failed > 0 && (
          <p className={s.hint}>{t('modEditor.voiceEffortResult.failedHint')}</p>
        )}
        <p className={s.hint}>{t('modEditor.voiceEffortResult.next')}</p>
      </div>
      <div className={s.footer}>
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </ModalShell>
  );
};
