import { useTranslation } from 'react-i18next';
import type { UkVoiceCharacter, UkVoiceLibraryItem } from '../../../api';
import s from './UkVoicesTab.module.scss';

type Props = {
  characters: UkVoiceCharacter[];
  voices: UkVoiceLibraryItem[];
  onLink: (characterKey: string, voiceId: string) => void;
  onUnlink: (characterKey: string) => void;
  busy?: boolean;
};

export const CharacterLinksTable = ({ characters, voices, onLink, onUnlink, busy }: Props) => {
  const { t } = useTranslation();

  if (characters.length === 0) {
    return <p className={s.hint}>{t('settings.ukVoices.emptyCharacters')}</p>;
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t('settings.ukVoices.colCharacter')}</th>
            <th>{t('settings.ukVoices.colGender')}</th>
            <th>{t('settings.ukVoices.colAge')}</th>
            <th>{t('settings.ukVoices.colMods')}</th>
            <th>{t('settings.ukVoices.colVoice')}</th>
          </tr>
        </thead>
        <tbody>
          {characters.map((character) => (
            <tr key={character.characterKey}>
              <td>
                <div>{character.characterKey}</div>
                {character.displayName ? (
                  <div className={s.muted}>{character.displayName}</div>
                ) : null}
              </td>
              <td>{t(`settings.ukVoices.gender.${character.gender}`)}</td>
              <td>{t(`settings.ukVoices.age.${character.age ?? 'unknown'}`)}</td>
              <td className={s.muted}>
                {character.modCount} / {character.lineCount}
              </td>
              <td>
                <select
                  className={s.select}
                  disabled={busy || voices.length === 0}
                  value={character.linkedVoiceId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) onUnlink(character.characterKey);
                    else onLink(character.characterKey, value);
                  }}
                >
                  <option value="">{t('settings.ukVoices.noVoice')}</option>
                  {voices.map((voice) => {
                    const q =
                      voice.qualityScore != null && Number.isFinite(voice.qualityScore)
                        ? ` · Q${Math.round(voice.qualityScore)}`
                        : '';
                    const age = voice.age && voice.age !== 'unknown' ? ` · ${voice.age}` : '';
                    return (
                      <option key={voice.id} value={voice.id}>
                        {voice.displayName} ({voice.gender}
                        {age}
                        {q})
                      </option>
                    );
                  })}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
