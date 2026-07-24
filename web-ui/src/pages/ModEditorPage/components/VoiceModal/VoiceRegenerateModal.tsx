import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import { randomUUID } from '../../../../utils/randomUUID';
import { VoiceRegenerateParamsForm } from '../../../SettingsPage/VoiceTab/VoiceRegenerateParamsForm';
import { CompareTrackList } from './components/CompareTrackList';
import { useVoiceRegenerateComparePlayback } from './hooks/useVoiceRegenerateComparePlayback';
import { useVoiceRegenerateSession } from './hooks/useVoiceRegenerateSession';
import s from './VoiceRegenerateModal.module.scss';

type VoiceRegenerateModalProps = {
  modId: number;
  line: VoiceLinePreview;
  srcLang: string;
  targetLang: string;
  hasCurrentTranslation: boolean;
  onClose: () => void;
  onCommitted: () => void;
};

/** Modal for regenerating one voice line with parameter tuning and A/B comparison. */
export const VoiceRegenerateModal = ({
  modId,
  line,
  srcLang,
  targetLang,
  hasCurrentTranslation,
  onClose,
  onCommitted,
}: VoiceRegenerateModalProps) => {
  const { t } = useTranslation();
  const sessionId = useMemo(() => randomUUID(), []);

  const {
    playingTrack,
    loadingTrack,
    error: playbackError,
    setError,
    handlePlay,
    stopPlayback,
  } = useVoiceRegenerateComparePlayback(modId, line, sessionId);

  const {
    params,
    setParams,
    selectedId,
    setSelectedId,
    loading,
    generating,
    committing,
    error: sessionError,
    setError: setSessionError,
    compareTracks,
    discardSession,
    handleGenerate,
    handleCommit,
  } = useVoiceRegenerateSession(
    modId,
    line,
    srcLang,
    targetLang,
    hasCurrentTranslation,
    sessionId,
    onCommitted,
    stopPlayback,
  );

  const error = sessionError ?? playbackError;

  const handleClose = useCallback(() => {
    stopPlayback();
    void discardSession();
    onClose();
  }, [discardSession, onClose, stopPlayback]);

  const lineLabel = line.infoFormidHex ?? `00${line.formidLower6}_${line.variant}`;

  return (
    <div className={s.overlay}>
      <ModalShell
        title={t('modEditor.voiceRegenerateTitle')}
        onClose={handleClose}
        closeAriaLabel={t('common.cancel')}
        size="xl"
        stretchContent
        closeDisabled={committing || generating}
      >
        <div className={s.body}>
          <div className={s.scroll}>
            <p className={s.lineMeta}>
              <strong>{lineLabel}</strong>
              <br />
              {line.translation ?? '—'}
            </p>

            {loading && <p className={s.status}>{t('common.loading')}</p>}
            {error && <p className={s.error}>{error}</p>}

            {params && (
              <>
                <div className={s.section}>
                  <h3 className={s.sectionTitle}>{t('modEditor.voiceRegenerateParamsTitle')}</h3>
                  <VoiceRegenerateParamsForm
                    params={params}
                    onChange={setParams}
                    disabled={generating || committing}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void handleGenerate()}
                    disabled={generating || committing}
                  >
                    {generating
                      ? t('modEditor.voiceRegenerateGenerating')
                      : t('modEditor.voiceRegenerateGenerate')}
                  </Button>
                </div>

                <div className={s.section}>
                  <h3 className={s.sectionTitle}>{t('modEditor.voiceRegenerateCompareTitle')}</h3>
                  <CompareTrackList
                    tracks={compareTracks}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    playingTrack={playingTrack}
                    loadingTrack={loadingTrack}
                    committing={committing}
                    onPlay={(track) => {
                      setSessionError(null);
                      setError(null);
                      void handlePlay(track);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {params && (
            <div className={s.footer}>
              <Button variant="secondary" onClick={handleClose} disabled={committing || generating}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleCommit()}
                disabled={committing || generating || !selectedId}
              >
                {committing ? t('modEditor.voiceRegenerateCommitting') : t('common.ok')}
              </Button>
            </div>
          )}
        </div>
      </ModalShell>
    </div>
  );
};
