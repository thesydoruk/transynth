import { useTranslation } from 'react-i18next';
import parentS from '../../SettingsPage/SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import type { VoiceRegenerateParams } from './voiceSettingsConfig';

type VoiceRegenerateParamsFormProps = {
  params: VoiceRegenerateParams;
  onChange: (next: VoiceRegenerateParams) => void;
  disabled?: boolean;
};

/** Local-only voice reference toggles for regeneration previews. */
export const VoiceRegenerateParamsForm = ({
  params,
  onChange,
  disabled = false,
}: VoiceRegenerateParamsFormProps) => {
  const { t } = useTranslation();
  const characterOn = params.character_reference !== false;

  return (
    <div className={controlS.settingsList}>
      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.characterReference')}</span>
          <span className={parentS.fieldNote}>{t('settings.voice.characterReferenceDesc')}</span>
        </div>
        <label className={controlS.toggle}>
          <input
            type="checkbox"
            checked={characterOn}
            disabled={disabled}
            onChange={() => onChange({ ...params, character_reference: !characterOn })}
          />
          <span className={controlS.toggleTrack} />
        </label>
      </div>
      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.lineReference')}</span>
          <span className={parentS.fieldNote}>{t('settings.voice.lineReferenceDesc')}</span>
        </div>
        <label className={controlS.toggle}>
          <input
            type="checkbox"
            checked={params.line_reference}
            disabled={disabled || !characterOn}
            onChange={() => onChange({ ...params, line_reference: !params.line_reference })}
          />
          <span className={controlS.toggleTrack} />
        </label>
      </div>
    </div>
  );
};
