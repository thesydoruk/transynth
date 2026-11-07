import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../../../../../api';
import type { VideoAsset, VideoSegment } from '../../../../../../api';
import { formatDuration } from './useMediaTab';
import s from './MediaTab.module.scss';

type Props = {
  gameId: string;
  modId: number;
  asset: VideoAsset;
  segments: VideoSegment[];
  loading: boolean;
  onClose: () => void;
};

const STATUS_CLASS: Record<string, string> = {
  reviewed: 'badgeOk',
  human: 'badgeOk',
  draft: 'badgeInfo',
  tm: 'badgeInfo',
  auto: 'badgeInfo',
};

/** The transcribed phrases of one video: timing, speaker, source, translation, a player per phrase. */
export const MediaSegmentsPanel = ({ gameId, modId, asset, segments, loading, onClose }: Props) => {
  const { t } = useTranslation();
  const translated = segments.filter((seg) => seg.translation).length;
  const hasSpeech = asset.status !== 'registered' && asset.status !== 'uploaded';
  const hasDub = asset.dub_rel_path != null;
  /** The dub from a phrase's start to the next phrase: the whole take, overrun included. */
  const dubRange = (i: number) => ({
    from: segments[i]!.start_s,
    to: segments[i + 1]?.start_s ?? asset.duration_s ?? segments[i]!.end_s + 5,
  });

  return (
    <section className={s.panel} aria-labelledby="video-segments-title">
      <div className={s.panelHead}>
        <h2 id="video-segments-title" className={s.panelTitle}>
          {t('video.segments.title', { file: asset.file_name })}
        </h2>
        {segments.length > 0 && (
          <span className={s.muted}>
            {t('video.segments.progress', { translated, count: segments.length })}
          </span>
        )}
        <Link to={`/games/${gameId}/mods/${modId}?signature=VIDEO`} className={s.btnGhost}>
          {t('video.segments.openStrings')}
        </Link>
        <button type="button" className={s.linkButton} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      {loading ? (
        <p className={s.muted}>{t('common.loading')}</p>
      ) : segments.length === 0 ? (
        <p className={s.hint}>{t('video.segments.empty')}</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('video.segments.time')}</th>
                <th>{t('video.segments.speaker')}</th>
                <th>{t('video.segments.source')}</th>
                <th>{t('video.segments.translation')}</th>
                <th>{t('video.segments.take')}</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, i) => (
                <tr key={seg.id}>
                  <td className={s.mono}>{seg.idx}</td>
                  <td className={s.mono}>
                    {formatDuration(seg.start_s)}–{formatDuration(seg.end_s)}
                    {hasSpeech && (
                      <audio
                        controls
                        preload="none"
                        className={s.playerSmall}
                        src={api.video.audioUrl(modId, asset.id, 'speech', {
                          from: seg.start_s,
                          to: seg.end_s,
                        })}
                        aria-label={t('video.segments.play', { idx: seg.idx })}
                      />
                    )}
                  </td>
                  <td className={s.mono}>{seg.speaker ?? '—'}</td>
                  <td>{seg.source_text}</td>
                  <td>
                    {seg.translation ? (
                      <>
                        {seg.translation}{' '}
                        <span
                          className={s[STATUS_CLASS[seg.translation_status ?? ''] ?? 'badgeMuted']}
                        >
                          {seg.translation_status}
                        </span>
                      </>
                    ) : (
                      <span className={s.muted}>{t('video.segments.untranslated')}</span>
                    )}
                  </td>
                  <td className={s.mono}>
                    {seg.take_rel_path ? (
                      <>
                        {seg.take_similarity != null && (
                          <span title={t('video.segments.similarity')}>
                            {seg.take_similarity.toFixed(2)}
                          </span>
                        )}
                        {seg.tempo != null && seg.tempo > 1 && (
                          <span className={s.badgeInfo} title={t('video.segments.tempo')}>
                            ×{seg.tempo.toFixed(2)}
                          </span>
                        )}
                        {seg.overrun && (
                          <span className={s.badgeError}>{t('video.segments.overrun')}</span>
                        )}
                        {hasDub && (
                          <audio
                            controls
                            preload="none"
                            className={s.playerSmall}
                            src={api.video.audioUrl(modId, asset.id, 'dub', dubRange(i))}
                            aria-label={t('video.segments.playTake', { idx: seg.idx })}
                          />
                        )}
                      </>
                    ) : (
                      <span className={s.muted}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
