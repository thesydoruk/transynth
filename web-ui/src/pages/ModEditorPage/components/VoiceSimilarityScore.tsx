import { useTranslation } from 'react-i18next';
import { formatVoiceSimilarity, voiceSimilarityTone } from '../voiceSimilarity';
import styles from './VoiceSimilarityScore.module.scss';

export interface VoiceSimilarityScoreProps {
  score: number | null | undefined;
}

/** Colored ECAPA cosine shown next to the dubbed-take playback control. */
export const VoiceSimilarityScore = ({ score }: VoiceSimilarityScoreProps) => {
  const { t } = useTranslation();
  if (score == null || !Number.isFinite(score)) return null;
  const label = formatVoiceSimilarity(score);
  return (
    <span
      className={`${styles.score} ${styles[voiceSimilarityTone(score)]}`}
      title={t('dialogs.voiceSimilarityTitle', { score: label })}
    >
      {label}
    </span>
  );
};
