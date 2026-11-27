import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import { ConfirmModal } from '../../../components/ConfirmModal';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import { effortTagsConfirmMessage, effortTagsHint } from './effortTagsCopy';
import { GAME_TTS_MATCH_TOGGLES, type GameTtsMatchSettings } from './voiceSettingsConfig';

type GameTtsMatchTogglesProps = {
  gameId: string;
  /** Whether the game's mods can be analyzed for vocal effort (from the game catalogue). */
  vocalEffort: boolean;
  value: GameTtsMatchSettings;
  disabled?: boolean;
  onChange: (patch: Partial<GameTtsMatchSettings>) => void;
};

/** Timing match and effort-tag switches for one game. */
export const GameTtsMatchToggles = ({
  gameId,
  vocalEffort,
  value,
  disabled,
  onChange,
}: GameTtsMatchTogglesProps) => {
  const { t } = useTranslation();
  const [confirmEffortTags, setConfirmEffortTags] = useState(false);
  const summary = useQuery({
    queryKey: ['voiceEffortSummary', gameId],
    queryFn: () => api.voiceEffortAnalysis.gameSummary(gameId),
    enabled: vocalEffort,
    staleTime: 30_000,
  });

  const toggle = (field: keyof GameTtsMatchSettings) => {
    const next = !value[field];
    // Switching tags on makes takes stale; for a game that cannot be analyzed it changes nothing.
    if (field === 'effortTags' && next && vocalEffort) {
      void summary.refetch();
      setConfirmEffortTags(true);
      return;
    }
    onChange({ [field]: next });
  };

  const effortNote = (): string | null => {
    if (!vocalEffort) return t('settings.voice.effortTagsNotAnalyzable');
    return summary.data ? effortTagsHint(t, summary.data) : null;
  };

  return (
    <div className={controlS.settingsList}>
      {GAME_TTS_MATCH_TOGGLES.map(({ field, labelKey, descKey }) => {
        const note = field === 'effortTags' ? effortNote() : null;
        return (
          <div key={field} className={controlS.settingRow}>
            <div className={controlS.settingInfo}>
              <span className={controlS.settingLabel}>{t(labelKey)}</span>
              <span className={parentS.fieldNote}>{t(descKey)}</span>
              {note && <span className={parentS.fieldNote}>{note}</span>}
            </div>
            <label className={controlS.toggle}>
              <input
                type="checkbox"
                checked={value[field]}
                disabled={disabled}
                onChange={() => toggle(field)}
              />
              <span className={controlS.toggleTrack} />
            </label>
          </div>
        );
      })}
      {confirmEffortTags && (
        <ConfirmModal
          title={t('settings.voice.effortTagsConfirmTitle')}
          message={effortTagsConfirmMessage(t, summary.data)}
          confirmLabel={t('settings.voice.effortTagsConfirmButton')}
          pending={summary.isFetching && !summary.data}
          onConfirm={() => {
            setConfirmEffortTags(false);
            onChange({ effortTags: true });
          }}
          onClose={() => setConfirmEffortTags(false)}
        />
      )}
    </div>
  );
};
