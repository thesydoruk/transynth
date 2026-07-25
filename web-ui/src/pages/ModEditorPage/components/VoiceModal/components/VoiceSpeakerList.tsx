import { useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpeakerGender, VoiceSpeakerGroup } from '../../../../../api';
import { speakerHue } from '../voiceLineKeys';
import s from '../VoiceModal.module.scss';

const GENDER_SYMBOL: Record<SpeakerGender, string> = {
  male: '♂',
  female: '♀',
  any: '⚥',
  unknown: '',
};

type VoiceSpeakerListProps = {
  speakers: VoiceSpeakerGroup[];
  selectedSpeakerKey: string | null;
  onSelectSpeaker: (key: string) => void;
};

export const VoiceSpeakerList = ({
  speakers,
  selectedSpeakerKey,
  onSelectSpeaker,
}: VoiceSpeakerListProps) => {
  const { t } = useTranslation();

  return (
    <aside className={s.speakerList}>
      <h3 className={s.sectionTitle}>{t('modEditor.voiceSpeakers')}</h3>
      <ul className={s.speakerItems}>
        {speakers.map((group) => {
          const hue = speakerHue(group.key);
          const active = group.key === selectedSpeakerKey;
          return (
            <li key={group.key}>
              <button
                type="button"
                className={`${s.speakerBtn} ${active ? s.speakerBtnActive : ''}`}
                style={{ '--speaker-hue': hue } as CSSProperties}
                onClick={() => onSelectSpeaker(group.key)}
              >
                <span className={s.speakerName}>
                  {group.referencePick && (
                    <span className={s.speakerRefMark} title={t('modEditor.voiceRefSet')}>
                      ★
                    </span>
                  )}
                  {group.displayName}
                  {group.gender !== 'unknown' && (
                    <span
                      className={s.speakerGender}
                      data-mismatch={group.genderMismatch ? '' : undefined}
                      title={
                        group.genderMismatch
                          ? t('modEditor.voiceGenderMismatch', {
                              gender: t(`dialogs.gender.${group.gender}`),
                            })
                          : t(`dialogs.gender.${group.gender}`)
                      }
                    >
                      {GENDER_SYMBOL[group.gender]}
                    </span>
                  )}
                </span>
                <span className={s.speakerCount}>{group.lines.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};

export const useSelectedSpeaker = (
  speakers: VoiceSpeakerGroup[],
  selectedSpeakerKey: string | null,
  onAutoSelect: (key: string) => void,
) => {
  useEffect(() => {
    if (!selectedSpeakerKey && speakers.length > 0) {
      onAutoSelect(speakers[0]!.key);
    }
  }, [onAutoSelect, selectedSpeakerKey, speakers]);

  return useMemo(
    () => speakers.find((group) => group.key === selectedSpeakerKey) ?? null,
    [speakers, selectedSpeakerKey],
  );
};
