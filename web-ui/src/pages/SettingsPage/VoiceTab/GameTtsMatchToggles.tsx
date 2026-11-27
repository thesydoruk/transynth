import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import { ConfirmModal } from '../../../components/ConfirmModal';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import {
  effortTagsConfirmMessage,
  effortTagsHint,
  effortTagsOffConfirmMessage,
  effortTagsOffNeedsConfirm,
} from './effortTagsCopy';
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
  /** The value the effort-tags switch is about to take, while the user is asked. */
  const [confirmEffortTags, setConfirmEffortTags] = useState<boolean | null>(null);
  const summary = useQuery({
    queryKey: ['voiceEffortSummary', gameId],
    queryFn: () => api.voiceEffortAnalysis.gameSummary(gameId),
    enabled: vocalEffort,
    staleTime: 30_000,
  });

  const toggle = (field: keyof GameTtsMatchSettings) => {
    const next = !value[field];
    // Either way the switch makes takes stale: on, those of lines with a tag; off, the
    // ones made with it. For a game that cannot be analyzed it changes nothing.
    if (
      field === 'effortTags' &&
      vocalEffort &&
      (next || effortTagsOffNeedsConfirm(summary.data))
    ) {
      void summary.refetch();
      setConfirmEffortTags(next);
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
      {confirmEffortTags != null && (
        <ConfirmModal
          title={t(
            confirmEffortTags
              ? 'settings.voice.effortTagsConfirmTitle'
              : 'settings.voice.effortTagsOffConfirmTitle',
          )}
          message={
            confirmEffortTags
              ? effortTagsConfirmMessage(t, summary.data)
              : effortTagsOffConfirmMessage(t, summary.data)
          }
          confirmLabel={t(
            confirmEffortTags
              ? 'settings.voice.effortTagsConfirmButton'
              : 'settings.voice.effortTagsOffConfirmButton',
          )}
          pending={summary.isFetching && !summary.data}
          onConfirm={() => {
            setConfirmEffortTags(null);
            onChange({ effortTags: confirmEffortTags });
          }}
          onClose={() => setConfirmEffortTags(null)}
        />
      )}
    </div>
  );
};
