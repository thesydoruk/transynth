import { useTranslation } from 'react-i18next';
import styles from '../VoiceMode.module.scss';

export type VoiceTab = 'speakers' | 'media';

export interface VoiceTabsProps {
  active: VoiceTab;
  onChange: (tab: VoiceTab) => void;
}

/** The two surfaces of the voice editor: the characters and the media (cutscene videos). */
export const VoiceTabs = ({ active, onChange }: VoiceTabsProps) => {
  const { t } = useTranslation();
  return (
    <div className={styles.tabs} role="tablist" aria-label={t('voice.tabs.label')}>
      {(['speakers', 'media'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          className={`${styles.tab} ${active === value ? styles.tabActive : ''}`}
          onClick={() => onChange(value)}
        >
          {t(`voice.tabs.${value}`)}
        </button>
      ))}
    </div>
  );
};
