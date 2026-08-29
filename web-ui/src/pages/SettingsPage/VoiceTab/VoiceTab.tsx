import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import s from './VoiceTab.module.scss';
import { GameTtsSettingsList } from './GameTtsSettingsList';
import { VoiceSlider } from './VoiceSlider';
import { VOICE_SETTINGS_DEFAULTS } from './voiceSettingsConfig';

type ProjectSettings = {
  'voice.line_reference': boolean;
  'voice.tts_max_parallel_fish_speech': number;
};

const DEFAULTS: ProjectSettings = {
  'voice.line_reference': VOICE_SETTINGS_DEFAULTS.line_reference,
  'voice.tts_max_parallel_fish_speech': 1,
};

/** Fish Speech synthesis settings — server URL read-only, reference mode editable. */
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

  const handleToggle = (key: 'voice.line_reference') => {
    update({ key, value: !settings[key] });
  };

  if (isLoading || runtimeLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error || runtimeError || !runtimeSettings) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error ?? runtimeError) })}
      </div>
    );
  }

  return (
    <>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionServer')}</h2>
        <div className={s.readonlyNote}>{t('settings.voice.serverReadonlyNote')}</div>
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
          <VoiceSlider
            label={t('settings.voice.fishSpeechMaxParallel')}
            description={t('settings.voice.fishSpeechMaxParallelDesc')}
            value={settings['voice.tts_max_parallel_fish_speech']}
            min={1}
            max={32}
            step={1}
            onCommit={(value) => update({ key: 'voice.tts_max_parallel_fish_speech', value })}
          />
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
        <h2 className={parentS.sectionTitle}>{t('settings.voice.sectionGameTts')}</h2>
        <p className={parentS.fieldNote}>{t('settings.voice.sectionGameTtsDesc')}</p>
        <GameTtsSettingsList />
      </div>
    </>
  );
};
