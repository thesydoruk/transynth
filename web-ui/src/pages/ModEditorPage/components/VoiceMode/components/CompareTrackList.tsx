import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../../../../components/Button';
import {
  normalizeVoiceRegenerateParams,
  VOICE_REGENERATE_KEEP_CURRENT_ID,
  type VoiceRegenerateParams,
} from '../../../../SettingsPage/VoiceTab/voiceSettingsConfig';
import { compareTrackKey, type CompareTrack } from '../compareTrack';
import s from '../VoiceRegenerateModal.module.scss';

type CompareTrackListProps = {
  tracks: CompareTrack[];
  selectedId: string;
  onSelect: (id: string) => void;
  playingTrack: string | null;
  loadingTrack: string | null;
  committing: boolean;
  onPlay: (track: CompareTrack) => void;
};

const formatRegenRefMeta = (
  params:
    | VoiceRegenerateParams
    | (Partial<VoiceRegenerateParams> & { character_reference?: boolean }),
  t: TFunction,
): string => {
  const p = normalizeVoiceRegenerateParams(params);
  const parts: string[] = [];
  if (p.global_reference) parts.push(t('modEditor.voiceRegenerateRefGlobal'));
  if (p.local_reference) {
    parts.push(
      p.line_reference
        ? t('modEditor.voiceRegenerateRefLine')
        : t('modEditor.voiceRegenerateRefSpeaker'),
    );
  }
  if (parts.length === 0) return t('modEditor.voiceRegenerateRefNone');
  return parts.join(' · ');
};

export const CompareTrackList = ({
  tracks,
  selectedId,
  onSelect,
  playingTrack,
  loadingTrack,
  committing,
  onPlay,
}: CompareTrackListProps) => {
  const { t } = useTranslation();
  const compareGroupName = useId();

  return (
    <ul className={s.compareList}>
      {tracks.map((track) => {
        const trackKey = compareTrackKey(track);
        const selectableId =
          track.kind === 'source'
            ? null
            : track.kind === 'current'
              ? VOICE_REGENERATE_KEEP_CURRENT_ID
              : track.preview.id;
        const isSelected = selectableId != null && selectedId === selectableId;
        const isPlaying = playingTrack === trackKey;
        const isLoading = loadingTrack === trackKey;
        const title =
          track.kind === 'source'
            ? t('modEditor.voiceRegenerateSource')
            : track.kind === 'current'
              ? t('modEditor.voiceRegenerateCurrent')
              : t('modEditor.voiceRegenerateAttempt', { n: track.preview.attempt });

        return (
          <li
            key={trackKey}
            className={`${s.compareItem} ${isSelected ? s.compareItemSelected : ''}`}
          >
            {selectableId ? (
              <input
                type="radio"
                name={compareGroupName}
                checked={isSelected}
                disabled={committing}
                onChange={() => onSelect(selectableId)}
                aria-label={title}
              />
            ) : (
              <span aria-hidden="true">•</span>
            )}
            <div className={s.compareLabel}>
              <span className={s.compareTitle}>{title}</span>
              {track.kind === 'preview' && (
                <span className={s.compareMeta}>{formatRegenRefMeta(track.preview.params, t)}</span>
              )}
            </div>
            <Button
              variant={isPlaying ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => void onPlay(track)}
              disabled={isLoading || committing}
            >
              {isLoading
                ? t('modEditor.voicePlayLoading')
                : isPlaying
                  ? t('modEditor.voicePlayStop')
                  : t('modEditor.voicePlay')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
};
