import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview, VoiceSpeakerGroup } from '../../../../../api';
import { Button } from '../../../../../components/Button';
import { lineKey, playTrackKey } from '../voiceLineKeys';
import s from '../VoiceMode.module.scss';

type VoiceLinesTableProps = {
  speaker: VoiceSpeakerGroup | null;
  playingTrack: string | null;
  loadingTrack: string | null;
  regenerateLine: VoiceLinePreview | null;
  setReferencePending: boolean;
  setReferenceLine: VoiceLinePreview | undefined;
  generatePending: boolean;
  generateLine: VoiceLinePreview | undefined;
  onPlay: (line: VoiceLinePreview, kind: 'source' | 'translation') => void;
  onSetReference: (line: VoiceLinePreview) => void;
  onGenerate: (line: VoiceLinePreview) => void;
  onRegenerate: (line: VoiceLinePreview) => void;
};

export const VoiceLinesTable = ({
  speaker,
  playingTrack,
  loadingTrack,
  regenerateLine,
  setReferencePending,
  setReferenceLine,
  generatePending,
  generateLine,
  onPlay,
  onSetReference,
  onGenerate,
  onRegenerate,
}: VoiceLinesTableProps) => {
  const { t } = useTranslation();

  return (
    <section className={s.linesPanel}>
      <h3 className={s.sectionTitle}>
        {speaker
          ? t('modEditor.voiceLinesFor', { speaker: speaker.displayName })
          : t('modEditor.voiceLines')}
      </h3>
      {speaker?.referencePick ? (
        <p className={s.refHint}>{t('modEditor.voiceRefHint')}</p>
      ) : (
        <p className={s.refHint}>{t('modEditor.voiceRefHintEmpty')}</p>
      )}
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t('modEditor.voiceColId')}</th>
              <th>{t('modEditor.voiceColSource')}</th>
              <th>{t('modEditor.voiceColTranslation')}</th>
              <th>{t('modEditor.voiceColActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(speaker?.lines ?? []).map((line) => {
              const key = lineKey(line);
              const sourceTrack = playTrackKey('source', line);
              const translationTrack = playTrackKey('translation', line);
              const isSourcePlaying = playingTrack === sourceTrack;
              const isTranslationPlaying = playingTrack === translationTrack;
              const isSourceLoading = loadingTrack === sourceTrack;
              const isTranslationLoading = loadingTrack === translationTrack;
              const isRefSaving =
                setReferencePending &&
                setReferenceLine?.formidLower6 === line.formidLower6 &&
                setReferenceLine?.variant === line.variant;
              const isGenerating =
                generatePending &&
                generateLine?.formidLower6 === line.formidLower6 &&
                generateLine?.variant === line.variant;
              const canGenerate = line.canGenerateVoice ?? Boolean(line.translation?.trim());
              const hasTranslationAudio = Boolean(line.hasTranslationAudio);

              return (
                <tr key={key} className={line.isReference ? s.referenceRow : undefined}>
                  <td className={s.idCell}>
                    <code>
                      {line.infoFormidHex ?? `00${line.formidLower6}`}_{line.variant}
                    </code>
                    {line.isReference && (
                      <span className={s.refBadge}>{t('modEditor.voiceRefBadge')}</span>
                    )}
                    {line.isInheritedAudio && (
                      <span className={s.inheritedBadge} title={line.inheritedFrom ?? undefined}>
                        {t('modEditor.voiceInheritedBadge')}
                      </span>
                    )}
                  </td>
                  <td className={s.textCell}>{line.source ?? '—'}</td>
                  <td className={s.textCell}>{line.translation ?? '—'}</td>
                  <td className={s.playCell}>
                    <div className={s.actionGroup}>
                      <Button
                        variant={isSourcePlaying ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => void onPlay(line, 'source')}
                        disabled={isSourceLoading}
                        title={t('modEditor.voicePlayTitle')}
                        aria-label={t('modEditor.voicePlayTitle')}
                      >
                        <span className={s.iconBtnGlyph} aria-hidden>
                          {isSourceLoading
                            ? t('modEditor.voicePlayLoading')
                            : isSourcePlaying
                              ? t('modEditor.voicePlayStop')
                              : t('modEditor.voicePlay')}
                        </span>
                      </Button>
                      {hasTranslationAudio ? (
                        <>
                          <Button
                            variant={isTranslationPlaying ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => void onPlay(line, 'translation')}
                            disabled={isTranslationLoading}
                            title={t('modEditor.voicePlayTranslationTitle')}
                            aria-label={t('modEditor.voicePlayTranslationTitle')}
                          >
                            <span className={`${s.iconBtnGlyph} ${s.translationBtn}`} aria-hidden>
                              {isTranslationLoading
                                ? t('modEditor.voicePlayLoading')
                                : isTranslationPlaying
                                  ? t('modEditor.voicePlayTranslationStop')
                                  : t('modEditor.voicePlayTranslation')}
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRegenerate(line)}
                            disabled={!Boolean(line.translation?.trim()) || Boolean(regenerateLine)}
                            title={t('modEditor.voiceRegenerateTitle')}
                            aria-label={t('modEditor.voiceRegenerateTitle')}
                          >
                            <span className={`${s.iconBtnGlyph} ${s.regenerateBtn}`} aria-hidden>
                              {t('modEditor.voiceRegenerate')}
                            </span>
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onGenerate(line)}
                          disabled={!canGenerate || generatePending}
                          title={
                            canGenerate
                              ? t('modEditor.voiceGenerateTitle')
                              : t('modEditor.voiceGenerateNeedsTranslation')
                          }
                          aria-label={
                            canGenerate
                              ? t('modEditor.voiceGenerateTitle')
                              : t('modEditor.voiceGenerateNeedsTranslation')
                          }
                        >
                          <span className={`${s.iconBtnGlyph} ${s.generateBtn}`} aria-hidden>
                            {isGenerating
                              ? t('modEditor.voiceGenerating')
                              : t('modEditor.voiceGenerate')}
                          </span>
                        </Button>
                      )}
                      <Button
                        variant={line.isReference ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => onSetReference(line)}
                        disabled={setReferencePending}
                        title={
                          line.isReference
                            ? t('modEditor.voiceRefClearTitle')
                            : t('modEditor.voiceRefSetTitle')
                        }
                        aria-label={
                          line.isReference
                            ? t('modEditor.voiceRefClearTitle')
                            : t('modEditor.voiceRefSetTitle')
                        }
                      >
                        <span
                          className={`${s.iconBtnGlyph} ${line.isReference ? s.iconBtnGlyphActive : ''}`}
                          aria-hidden
                        >
                          {isRefSaving
                            ? t('modEditor.voiceRefSaving')
                            : line.isReference
                              ? '★'
                              : '☆'}
                        </span>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
