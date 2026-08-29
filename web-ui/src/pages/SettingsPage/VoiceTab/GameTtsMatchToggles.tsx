import { useTranslation } from 'react-i18next';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import { GAME_TTS_MATCH_TOGGLES, type GameTtsMatchSettings } from './voiceSettingsConfig';

type GameTtsMatchTogglesProps = {
  value: GameTtsMatchSettings;
  disabled?: boolean;
  onChange: (patch: Partial<GameTtsMatchSettings>) => void;
};

/** Timing match switch for one game. */
export const GameTtsMatchToggles = ({ value, disabled, onChange }: GameTtsMatchTogglesProps) => {
  const { t } = useTranslation();

  return (
    <div className={controlS.settingsList}>
      {GAME_TTS_MATCH_TOGGLES.map(({ field, labelKey, descKey }) => (
        <div key={field} className={controlS.settingRow}>
          <div className={controlS.settingInfo}>
            <span className={controlS.settingLabel}>{t(labelKey)}</span>
            <span className={parentS.fieldNote}>{t(descKey)}</span>
          </div>
          <label className={controlS.toggle}>
            <input
              type="checkbox"
              checked={value[field]}
              disabled={disabled}
              onChange={() => onChange({ [field]: !value[field] })}
            />
            <span className={controlS.toggleTrack} />
          </label>
        </div>
      ))}
    </div>
  );
};
