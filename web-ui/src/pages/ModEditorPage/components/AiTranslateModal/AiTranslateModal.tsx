import { useTranslation } from 'react-i18next';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import type { LlmTranslateRow } from '../../../../api';
import type { AiTranslateState } from '../../hooks/useAiTranslate';
import s from '../AiVerifyModal/AiVerifyModal.module.scss';

interface AiTranslateModalProps {
  srcLang: string;
  targetLang: string;
  state: AiTranslateState & {
    isRunning: boolean;
    successCount: number;
    errorCount: number;
    start: () => void;
    stop: () => void;
  };
  onClose: () => void;
  onRowClick?: (stringId: number) => void;
}

/** Modal for mod-wide LLM auto-translation with progress and result rows. */
export const AiTranslateModal = ({
  srcLang,
  targetLang,
  state,
  onClose,
  onRowClick,
}: AiTranslateModalProps) => {
  const { t } = useTranslation();
  const { isRunning, done, total, rows, error, status, successCount, errorCount, start, stop } =
    state;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const errorRows = rows.filter((row) => row.error);

  return (
    <ModalShell
      title={t('modEditor.aiTranslateTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
      size="xl"
      stretchContent
    >
      <p className={s.intro}>
        {t('modEditor.aiTranslateIntro', {
          src: srcLang.toUpperCase(),
          target: targetLang.toUpperCase(),
        })}
      </p>

      <div className={s.controls}>
        {isRunning ? (
          <Button variant="danger" size="sm" onClick={() => void stop()}>
            {t('modEditor.aiVerifyStop')}
          </Button>
        ) : (
          <Button
            variant="success"
            size="sm"
            onClick={() => void start()}
            disabled={status === 'running'}
          >
            {status === 'idle' ? t('modEditor.aiVerifyStart') : t('modEditor.aiVerifyRestart')}
          </Button>
        )}
        <div className={s.progressWrap}>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={s.progressLabel}>
            {isRunning
              ? t('modEditor.aiTranslateProgress', { done, total })
              : status === 'completed'
                ? t('modEditor.aiTranslateCompleted', {
                    done,
                    total,
                    success: successCount,
                    errors: errorCount,
                  })
                : status === 'cancelled'
                  ? t('modEditor.aiTranslateCancelled', {
                      done,
                      total,
                      success: successCount,
                      errors: errorCount,
                    })
                  : status === 'failed'
                    ? t('modEditor.aiTranslateFailed')
                    : t('modEditor.aiTranslateIdle')}
          </span>
        </div>
      </div>

      {error && <p className={s.error}>{error}</p>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t('modEditor.edid')}</th>
              <th>{t('modEditor.field')}</th>
              <th>{t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}</th>
              <th>{t('modEditor.translationText', { lang: targetLang.toUpperCase() })}</th>
              <th>{t('modEditor.aiTranslateStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {errorRows.length === 0 ? (
              <tr>
                <td colSpan={5} className={s.empty}>
                  {isRunning
                    ? t('modEditor.aiTranslateScanning')
                    : status === 'completed' && successCount > 0
                      ? t('modEditor.aiTranslateAllSuccess', { count: successCount })
                      : t('modEditor.aiTranslateNoErrors')}
                </td>
              </tr>
            ) : (
              errorRows.map((row: LlmTranslateRow) => (
                <tr
                  key={row.stringId}
                  className={onRowClick ? s.clickable : undefined}
                  onClick={onRowClick ? () => onRowClick(row.stringId) : undefined}
                >
                  <td className={s.mono}>{row.edid ?? '—'}</td>
                  <td className={s.mono}>{row.path ?? row.signature ?? '—'}</td>
                  <td className={s.textCell}>{row.source}</td>
                  <td className={s.textCell}>{row.translation ?? '—'}</td>
                  <td className={s.reasonCell}>
                    <span className={s.verdictBad}>{row.error}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </ModalShell>
  );
};
