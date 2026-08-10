import { useTranslation } from 'react-i18next';
import parentS from '../../SettingsPage/SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import { VoiceSlider } from './VoiceSlider';
import { VOICE_SYNTHESIS_SLIDERS, type VoiceRegenerateParams } from './voiceSettingsConfig';

type VoiceRegenerateParamsFormProps = {
  params: VoiceRegenerateParams;
  onChange: (next: VoiceRegenerateParams) => void;
  disabled?: boolean;
};

/** Local-only voice synthesis parameter form (same fields as Settings → Voice). */
export const VoiceRegenerateParamsForm = ({
  params,
  onChange,
  disabled = false,
}: VoiceRegenerateParamsFormProps) => {
  const { t } = useTranslation();

  return (
    <div className={controlS.settingsList}>
      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.lineReference')}</span>
          <span className={parentS.fieldNote}>{t('settings.voice.lineReferenceDesc')}</span>
        </div>
        <label className={controlS.toggle}>
          <input
            type="checkbox"
            checked={params.line_reference}
            disabled={disabled}
            onChange={() => onChange({ ...params, line_reference: !params.line_reference })}
          />
          <span className={controlS.toggleTrack} />
        </label>
      </div>

      {VOICE_SYNTHESIS_SLIDERS.map(({ key, labelKey, descKey, min, max, step }) => (
        <VoiceSlider
          key={key}
          label={t(labelKey)}
          description={t(descKey)}
          value={params[key]}
          min={min}
          max={max}
          step={step}
          onCommit={(value) => onChange({ ...params, [key]: value })}
          disabled={disabled}
        />
      ))}
    </div>
  );
};
