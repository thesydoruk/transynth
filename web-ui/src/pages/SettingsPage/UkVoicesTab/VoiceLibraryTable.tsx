import { useTranslation } from 'react-i18next';
import { ukVoiceAudioUrl, type UkVoiceLibraryItem } from '../../../api';
import s from './UkVoicesTab.module.scss';

type Props = {
  voices: UkVoiceLibraryItem[];
};

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
            <th>{t('settings.ukVoices.colLicense')}</th>
            <th>{t('settings.ukVoices.colPreview')}</th>
          </tr>
        </thead>
        <tbody>
          {voices.map((voice) => (
            <tr key={voice.id}>
              <td>
                <div>{voice.displayName}</div>
                {voice.description ? <div className={s.desc}>{voice.description}</div> : null}
              </td>
              <td className={s.muted}>{voice.source}</td>
              <td>{t(`settings.ukVoices.gender.${voice.gender}`)}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
};
