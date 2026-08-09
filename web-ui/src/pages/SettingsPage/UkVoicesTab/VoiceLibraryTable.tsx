import { useTranslation } from 'react-i18next';
import { ukVoiceAudioUrl, type UkVoiceLibraryItem } from '../../../api';
import s from './UkVoicesTab.module.scss';

type Props = {
  voices: UkVoiceLibraryItem[];
};

const formatQuality = (score: number | null): string =>
  score == null || !Number.isFinite(score) ? '—' : String(Math.round(score));

export const VoiceLibraryTable = ({ voices }: Props) => {
  const { t } = useTranslation();

  if (voices.length === 0) {
    return <p className={s.hint}>{t('settings.ukVoices.emptyLibrary')}</p>;
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t('settings.ukVoices.colName')}</th>
            <th>{t('settings.ukVoices.colSource')}</th>
            <th>{t('settings.ukVoices.colGender')}</th>
            <th>{t('settings.ukVoices.colAge')}</th>
            <th>{t('settings.ukVoices.colQuality')}</th>
            <th>{t('settings.ukVoices.colF0')}</th>
            <th>{t('settings.ukVoices.colTranscript')}</th>
            <th>{t('settings.ukVoices.colLicense')}</th>
            <th>{t('settings.ukVoices.colPreview')}</th>
          </tr>
        </thead>
        <tbody>
          {voices.map((voice) => {
            const quality = voice.qualityScore;
            const qualityClass =
              quality == null
                ? s.muted
                : quality >= 70
                  ? s.qualityGood
                  : quality >= 45
                    ? s.qualityOk
                    : s.qualityLow;
            return (
              <tr key={voice.id}>
                <td>
                  <div>{voice.displayName}</div>
                  {voice.description ? <div className={s.desc}>{voice.description}</div> : null}
                </td>
                <td className={s.muted}>{voice.source}</td>
                <td>
                  <div>{t(`settings.ukVoices.gender.${voice.gender}`)}</div>
                  {voice.genderSource ? (
                    <div className={s.muted}>
                      {t(`settings.ukVoices.genderSource.${voice.genderSource}`, {
                        defaultValue: voice.genderSource,
                      })}
                    </div>
                  ) : null}
                </td>
                <td>{t(`settings.ukVoices.age.${voice.age ?? 'unknown'}`)}</td>
                <td className={qualityClass}>{formatQuality(quality)}</td>
                <td className={s.muted}>{voice.meanF0Hz != null ? `${voice.meanF0Hz} Hz` : '—'}</td>
                <td>
                  {voice.transcript?.trim() ? (
                    <div className={s.transcript} title={voice.transcript}>
                      {voice.transcript}
                    </div>
                  ) : (
                    <span className={s.muted}>—</span>
                  )}
                </td>
                <td className={s.muted}>{voice.license}</td>
                <td>
                  <audio
                    className={s.audio}
                    controls
                    preload="none"
                    src={ukVoiceAudioUrl(voice.id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
