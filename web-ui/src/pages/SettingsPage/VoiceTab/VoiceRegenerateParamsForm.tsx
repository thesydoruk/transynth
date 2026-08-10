import { useTranslation } from 'react-i18next';
import parentS from '../../SettingsPage/SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import { normalizeVoiceRegenerateParams, type VoiceRegenerateParams } from './voiceSettingsConfig';

type VoiceRegenerateParamsFormProps = {
  params: VoiceRegenerateParams;
  onChange: (next: VoiceRegenerateParams) => void;
  disabled?: boolean;
};

/** Independent global / local voice reference toggles for regeneration previews. */
export const VoiceRegenerateParamsForm = ({
  params,
  onChange,
  disabled = false,
}: VoiceRegenerateParamsFormProps) => {
  const { t } = useTranslation();
  const normalized = normalizeVoiceRegenerateParams(params);
  const globalOn = normalized.global_reference;
  const localOn = normalized.local_reference;

  return (
    <div className={controlS.settingsList}>
      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.globalReference')}</span>
          <span className={parentS.fieldNote}>{t('settings.voice.globalReferenceDesc')}</span>
        </div>
        <label className={controlS.toggle}>
          <input
            type="checkbox"
            checked={globalOn}
            disabled={disabled}
            onChange={() => onChange({ ...normalized, global_reference: !globalOn })}
          />
          <span className={controlS.toggleTrack} />
        </label>
      </div>
      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.localReference')}</span>
          <span className={parentS.fieldNote}>{t('settings.voice.localReferenceDesc')}</span>
        </div>
        <label className={controlS.toggle}>
          <input
            type="checkbox"
            checked={localOn}
            disabled={disabled}
            onChange={() => onChange({ ...normalized, local_reference: !localOn })}
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
            checked={normalized.line_reference}
            disabled={disabled || !localOn}
            onChange={() => onChange({ ...normalized, line_reference: !normalized.line_reference })}
          />
          <span className={controlS.toggleTrack} />
        </label>
      </div>
    </div>
  );
};
