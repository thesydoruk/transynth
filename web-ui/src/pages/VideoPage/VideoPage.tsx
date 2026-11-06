import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { formatDuration, formatMiB, playableKind, useVideoPage } from './useVideoPage';
import s from './VideoPage.module.scss';

const STATUS_CLASS: Record<string, string> = {
  registered: 'badgeMuted',
  uploaded: 'badgeInfo',
  separating: 'badgeInfo',
  separated: 'badgeInfo',
  dubbing: 'badgeInfo',
  dubbed: 'badgeOk',
  packed: 'badgeOk',
  error: 'badgeError',
};

/**
 * The cutscene videos the resident agent found in the game folder, with the
 * audio it uploaded and how far the dub got. Route: /games/:gameId/video.
 */
export const VideoPage = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const p = useVideoPage(gameId);

  return (
    <div className={s.page}>
      <PageHeader
        title={t('video.title')}
        description={t('video.description')}
        actions={
          <Link to={`/games/${gameId}`} className={s.btnGhost}>
            {t('video.backToHub')}
          </Link>
        }
      />

      {p.error && (
        <div className={s.errorBar} role="alert">
          {p.error}
        </div>
      )}

      {p.isLoading ? (
        <p className={s.muted}>{t('common.loading')}</p>
      ) : p.assets.length === 0 ? (
        <section className={s.panel}>
          <h2 className={s.panelTitle}>{t('video.empty.title')}</h2>
          <p className={s.hint}>{t('video.empty.body')}</p>
          <pre className={s.code}>{t('video.empty.config')}</pre>
        </section>
      ) : (
        <section className={s.panel}>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t('video.columns.file')}</th>
                  <th>{t('video.columns.duration')}</th>
                  <th>{t('video.columns.tracks')}</th>
                  <th>{t('video.columns.status')}</th>
                  <th>{t('video.columns.audio')}</th>
                </tr>
              </thead>
              <tbody>
                {p.assets.map((asset) => {
                  const kind = playableKind(asset);
                  return (
                    <tr key={asset.id}>
                      <td>
                        <span className={s.mono}>{asset.file_name}</span>
                        <span className={s.muted}> · {formatMiB(asset.byte_size)}</span>
                      </td>
                      <td>{formatDuration(asset.duration_s)}</td>
                      <td>
                        {t('video.tracks', {
                          count: asset.track_ids.length,
                          source: asset.source_track_id ?? '—',
                        })}
                      </td>
                      <td>
                        <span className={s[STATUS_CLASS[asset.status] ?? 'badgeMuted']}>
                          {t(`video.status.${asset.status}`, { defaultValue: asset.status })}
                        </span>
                        {asset.error && <div className={s.errorText}>{asset.error}</div>}
                      </td>
                      <td>
                        {kind ? (
                          <audio
                            controls
                            preload="none"
                            className={s.player}
                            src={api.video.audioUrl(gameId, asset.id, kind)}
                            aria-label={t(`video.audio.${kind}`)}
                          />
                        ) : (
                          <span className={s.muted}>{t('video.audio.none')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
