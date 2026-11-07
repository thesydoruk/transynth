import { useTranslation } from 'react-i18next';
import { api } from '../../../../../../api';
import { Button } from '../../../../../../components/Button';
import { formatDuration, formatMiB, playableKind, useMediaTab } from './useMediaTab';
import { MediaSegmentsPanel } from './MediaSegmentsPanel';
import s from './MediaTab.module.scss';

const STATUS_CLASS: Record<string, string> = {
  registered: 'badgeMuted',
  uploaded: 'badgeInfo',
  separating: 'badgeInfo',
  separated: 'badgeInfo',
  dubbing: 'badgeInfo',
  dubbed: 'badgeOk',
  packing: 'badgeInfo',
  packed: 'badgeOk',
  error: 'badgeError',
};

/** A video that was separated once is offered the run again, not the first one. */
const RESEPARATE_STATUSES = new Set([
  'separated',
  'dubbing',
  'dubbed',
  'packing',
  'packed',
  'error',
]);

export interface MediaTabProps {
  gameId: string;
  modId: number;
}

/**
 * The mod's cutscene videos: the audio the agent uploaded, how far the dub
 * got, the buttons that move it on, and the phrases of the selected video.
 */
export const MediaTab = ({ gameId, modId }: MediaTabProps) => {
  const { t } = useTranslation();
  const p = useMediaTab(modId);

  return (
    <div className={s.tab}>
      {p.error && (
        <div className={s.errorBar} role="alert">
          {p.error}
          <button type="button" className={s.linkButton} onClick={p.clearError}>
            {t('common.cancel')}
          </button>
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
                  <th>{t('video.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {p.assets.map((asset) => {
                  const kind = playableKind(asset);
                  const gate = p.canSeparate(asset);
                  const dubGate = p.canDub(asset);
                  const packGate = p.canPack(asset);
                  return (
                    <tr key={asset.id} className={asset.id === p.selected?.id ? s.rowSelected : ''}>
                      <td>
                        <button
                          type="button"
                          className={s.linkButton}
                          onClick={() => p.select(asset.id === p.selected?.id ? null : asset.id)}
                        >
                          <span className={s.mono}>{asset.file_name}</span>
                        </button>
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
                            src={api.video.audioUrl(modId, asset.id, kind)}
                            aria-label={t(`video.audio.${kind}`)}
                          />
                        ) : (
                          <span className={s.muted}>{t('video.audio.none')}</span>
                        )}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!gate.ok}
                          title={
                            gate.missing
                              ? t('video.needsHost', { service: gate.missing.toUpperCase() })
                              : undefined
                          }
                          onClick={() => p.separate(asset.id)}
                        >
                          {t(
                            RESEPARATE_STATUSES.has(asset.status)
                              ? 'video.actions.reseparate'
                              : 'video.actions.separate',
                          )}
                        </Button>{' '}
                        {RESEPARATE_STATUSES.has(asset.status) && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!gate.ok}
                              title={
                                gate.missing
                                  ? t('video.needsHost', {
                                      service: gate.missing.toUpperCase(),
                                    })
                                  : t('video.actions.refreshTracksHint')
                              }
                              onClick={() => p.separate(asset.id, true)}
                            >
                              {t('video.actions.refreshTracks')}
                            </Button>{' '}
                          </>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!dubGate.ok}
                          title={
                            dubGate.missing
                              ? t('video.needsHost', { service: dubGate.missing.toUpperCase() })
                              : undefined
                          }
                          onClick={() => p.dub(asset.id)}
                        >
                          {t(asset.dub_rel_path ? 'video.actions.redub' : 'video.actions.dub')}
                        </Button>
                        {packGate.show && (
                          <>
                            {' '}
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!packGate.ok}
                              title={
                                packGate.missing
                                  ? t('video.needsHost', {
                                      service: packGate.missing.toUpperCase(),
                                    })
                                  : undefined
                              }
                              onClick={() => p.pack(asset.id)}
                            >
                              {t('video.actions.pack')}
                            </Button>
                          </>
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

      {p.selected && (
        <MediaSegmentsPanel
          gameId={gameId}
          modId={modId}
          asset={p.selected}
          segments={p.segments}
          loading={p.segmentsLoading}
          onClose={() => p.select(null)}
        />
      )}
    </div>
  );
};
