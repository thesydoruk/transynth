import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import generalS from '../GeneralTab/GeneralTab.module.scss';
import s from './VoiceTab.module.scss';
import { VoiceSlider } from './VoiceSlider';

type TtsBackend = 'xtts' | 'fish-speech';

type ProjectSettings = {
  'voice.line_reference': boolean;
  'voice.backend': TtsBackend;
  'voice.speed': number;
  'voice.length_penalty': number;
  'voice.temperature': number;
  'voice.repetition_penalty': number;
  'voice.top_p': number;
  'voice.top_k': number;
  'voice.enable_text_splitting': boolean;
  'voice.tts_max_parallel_xtts': number;
  'voice.tts_max_parallel_fish_speech': number;
};

type NumericVoiceKey = Exclude<
  {
    [K in keyof ProjectSettings]: ProjectSettings[K] extends number ? K : never;
  }[keyof ProjectSettings],
  never
>;

const DEFAULTS: ProjectSettings = {
  'voice.line_reference': true,
  'voice.backend': 'xtts',
  'voice.speed': 1.0,
  'voice.length_penalty': 2,
  'voice.temperature': 0.65,
  'voice.repetition_penalty': 1.2,
  'voice.top_p': 0.8,
  'voice.top_k': 50,
  'voice.enable_text_splitting': false,
  'voice.tts_max_parallel_xtts': 1,
  'voice.tts_max_parallel_fish_speech': 1,
};

const SYNTHESIS_SLIDERS: Array<{
  key: NumericVoiceKey;
  labelKey: string;
  descKey: string;
  min: number;
  max: number;
  step: number;
  backends: TtsBackend[] | 'all';
}> = [
  {
    key: 'voice.speed',
    labelKey: 'settings.voice.speed',
    descKey: 'settings.voice.speedDesc',
    min: 0.5,
    max: 2,
    step: 0.05,
    backends: ['xtts'],
  },
  {
    key: 'voice.length_penalty',
    labelKey: 'settings.voice.lengthPenalty',
    descKey: 'settings.voice.lengthPenaltyDesc',
    min: 0.5,
    max: 5,
    step: 0.05,
    backends: ['xtts'],
  },
  {
    key: 'voice.temperature',
    labelKey: 'settings.voice.temperature',
    descKey: 'settings.voice.temperatureDesc',
    min: 0,
    max: 1,
    step: 0.05,
    backends: 'all',
  },
  {
    key: 'voice.repetition_penalty',
    labelKey: 'settings.voice.repetitionPenalty',
    descKey: 'settings.voice.repetitionPenaltyDesc',
    min: 1,
    max: 5,
    step: 0.1,
    backends: 'all',
  },
  {
    key: 'voice.top_p',
    labelKey: 'settings.voice.topP',
    descKey: 'settings.voice.topPDesc',
    min: 0,
    max: 1,
    step: 0.05,
    backends: 'all',
  },
  {
    key: 'voice.top_k',
    labelKey: 'settings.voice.topK',
    descKey: 'settings.voice.topKDesc',
    min: 1,
    max: 200,
    step: 1,
    backends: ['xtts'],
  },
];

const TTS_PARALLEL_SLIDERS: Array<{
  key: 'voice.tts_max_parallel_xtts' | 'voice.tts_max_parallel_fish_speech';
  labelKey: string;
  descKey: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    key: 'voice.tts_max_parallel_xtts',
    labelKey: 'settings.voice.xttsMaxParallel',
    descKey: 'settings.voice.xttsMaxParallelDesc',
    min: 1,
    max: 32,
    step: 1,
  },
  {
    key: 'voice.tts_max_parallel_fish_speech',
    labelKey: 'settings.voice.fishSpeechMaxParallel',
    descKey: 'settings.voice.fishSpeechMaxParallelDesc',
    min: 1,
    max: 32,
    step: 1,
  },
];

const BACKEND_OPTIONS: Array<{ value: TtsBackend; labelKey: string; descKey: string }> = [
  {
    value: 'xtts',
    labelKey: 'settings.voice.backendXtts',
    descKey: 'settings.voice.backendXttsDesc',
  },
  {
    value: 'fish-speech',
    labelKey: 'settings.voice.backendFishSpeech',
    descKey: 'settings.voice.backendFishSpeechDesc',
  },
];

const sliderAppliesToBackend = (backends: TtsBackend[] | 'all', backend: TtsBackend): boolean =>
  backends === 'all' || backends.includes(backend);

/** Voice synthesis settings tab — server URL read-only, hyperparameters editable. */
export const VoiceTab = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: runtimeSettings,
    isLoading: runtimeLoading,
    error: runtimeError,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['projectSettings'],
    queryFn: () => api.projectSettings.getAll() as Promise<ProjectSettings>,
    staleTime: 30_000,
  });

  const { mutate: update } = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | number | string }) =>
      api.projectSettings.update(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
    },
  });

  const settings: ProjectSettings = { ...DEFAULTS, ...(data ?? {}) };
  const activeBackend = settings['voice.backend'];

  const handleToggle = (key: keyof ProjectSettings) => {
    update({ key, value: !settings[key] });
  };

  const handleNumber = (key: NumericVoiceKey, value: number) => {
    update({ key, value });
  };

  const handleBackend = (backend: TtsBackend) => {
    update({ key: 'voice.backend', value: backend });
  };

  if (isLoading || runtimeLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error || runtimeError || !runtimeSettings) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error ?? runtimeError) })}
      </div>
    );
  }

  const visibleSliders = SYNTHESIS_SLIDERS.filter(({ backends }) =>
    sliderAppliesToBackend(backends, activeBackend),
  );

  return (
    <>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionServer')}</h2>
        <div className={s.readonlyNote}>ℹ️ {t('settings.voice.serverReadonlyNote')}</div>
        <p className={parentS.fieldNote}>{t('settings.voice.serverUrlDesc')}</p>
        <div className={parentS.fieldGrid}>
          <span className={parentS.fieldLabel}>{t('settings.voice.serverUrl')}</span>
          <span className={s.fieldValue}>{runtimeSettings.ttsBaseUrl}</span>
        </div>
      </div>

      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionConcurrency')}</h2>
        <p className={parentS.fieldNote}>{t('settings.voice.sectionConcurrencyDesc')}</p>
        <div className={controlS.settingsList}>
          {TTS_PARALLEL_SLIDERS.map(({ key, labelKey, descKey, min, max, step }) => (
            <VoiceSlider
              key={key}
              label={t(labelKey)}
              description={t(descKey)}
              value={settings[key]}
              min={min}
              max={max}
              step={step}
              onCommit={(value) => handleNumber(key, value)}
            />
          ))}
        </div>
      </div>

      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionReference')}</h2>
        <p className={parentS.fieldNote}>{t('settings.voice.sectionReferenceDesc')}</p>
        <div className={controlS.settingsList}>
          <div className={controlS.settingRow}>
            <div className={controlS.settingInfo}>
              <span className={controlS.settingLabel}>{t('settings.voice.lineReference')}</span>
              <span className={parentS.fieldNote}>{t('settings.voice.lineReferenceDesc')}</span>
            </div>
            <label className={controlS.toggle}>
              <input
                type="checkbox"
                checked={settings['voice.line_reference']}
                onChange={() => handleToggle('voice.line_reference')}
              />
              <span className={controlS.toggleTrack} />
            </label>
          </div>
        </div>
      </div>

      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionSynthesis')}</h2>
        <p className={parentS.fieldNote}>{t('settings.voice.sectionSynthesisDesc')}</p>
        <div className={controlS.settingsList}>
          <div className={controlS.settingRow}>
            <div className={controlS.settingInfo}>
              <span className={controlS.settingLabel}>{t('settings.voice.backend')}</span>
              <span className={parentS.fieldNote}>
                {t(
                  BACKEND_OPTIONS.find((option) => option.value === activeBackend)?.descKey ??
                    'settings.voice.backendXttsDesc',
                )}
              </span>
            </div>
            <select
              className={generalS.select}
              value={activeBackend}
              onChange={(event) => handleBackend(event.target.value as TtsBackend)}
            >
              {BACKEND_OPTIONS.map(({ value, labelKey }) => (
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
              value={settings[key]}
              min={min}
              max={max}
              step={step}
              onCommit={(value) => handleNumber(key, value)}
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
                  checked={settings['voice.enable_text_splitting']}
                  onChange={() => handleToggle('voice.enable_text_splitting')}
                />
                <span className={controlS.toggleTrack} />
              </label>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
