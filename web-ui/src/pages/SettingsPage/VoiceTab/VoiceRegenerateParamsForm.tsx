import { useTranslation } from 'react-i18next';
import parentS from '../../SettingsPage/SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import generalS from '../GeneralTab/GeneralTab.module.scss';
import { VoiceSlider } from './VoiceSlider';
import {
  VOICE_BACKEND_OPTIONS,
  VOICE_SYNTHESIS_SLIDERS,
  sliderAppliesToBackend,
  type VoiceRegenerateParams,
} from './voiceSettingsConfig';

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
  const activeBackend = params.backend;
  const visibleSliders = VOICE_SYNTHESIS_SLIDERS.filter(({ backends }) =>
    sliderAppliesToBackend(backends, activeBackend),
  );

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

      <div className={controlS.settingRow}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{t('settings.voice.backend')}</span>
          <span className={parentS.fieldNote}>
            {t(
              VOICE_BACKEND_OPTIONS.find((option) => option.value === activeBackend)?.descKey ??
                'settings.voice.backendXttsDesc',
            )}
          </span>
        </div>
        <select
          className={generalS.select}
          value={activeBackend}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...params, backend: event.target.value as VoiceRegenerateParams['backend'] })
          }
        >
          {VOICE_BACKEND_OPTIONS.map(({ value, labelKey }) => (
            <option key={value} value={value}>
              {t(labelKey)}
            </option>
          ))}
        </select>
      </div>

      {visibleSliders.map(({ key, labelKey, descKey, min, max, step }) => (
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

      {activeBackend === 'xtts' && (
        <div className={controlS.settingRow}>
          <div className={controlS.settingInfo}>
            <span className={controlS.settingLabel}>{t('settings.voice.textSplitting')}</span>
            <span className={parentS.fieldNote}>{t('settings.voice.textSplittingDesc')}</span>
          </div>
          <label className={controlS.toggle}>
            <input
              type="checkbox"
              checked={params.enable_text_splitting}
              disabled={disabled}
              onChange={() =>
                onChange({ ...params, enable_text_splitting: !params.enable_text_splitting })
              }
            />
            <span className={controlS.toggleTrack} />
          </label>
        </div>
      )}
    </div>
  );
};
