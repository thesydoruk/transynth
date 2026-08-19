import { useTranslation } from 'react-i18next';
import type { ExportArchive } from '../../api';
import { importStatusKey, statusColorBase } from './modsShared';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';
import s from './ModsPageRow.module.scss';

type ExportArchiveRowProps = {
  archive: ExportArchive;
  deleting?: boolean;
  onDownload: () => void;
  onDelete: () => void;
};

const formatBytes = (raw: string | null): string | null => {
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export const ExportArchiveRow = ({
  archive,
  deleting,
  onDownload,
  onDelete,
}: ExportArchiveRowProps) => {
  const { t } = useTranslation();
  const pct =
    archive.total_count > 0
      ? Math.max(0, Math.min(100, Math.round((archive.done_count / archive.total_count) * 100)))
      : null;
  const size = formatBytes(archive.byte_size);
  const statusKey = archive.status === 'running' ? 'in_progress' : importStatusKey(archive.status);

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.typeBadge} style={{ background: '#1565c0' }}>
          {t('imports.exportBadge')}
        </span>
        <div>
          <span className={s.fileName}>{archive.label}</span>
          <span className={s.meta}>
            {archive.file_name}
            {size ? ` · ${size}` : ''}
            {archive.error ? ` · ${archive.error}` : ''}
          </span>
        </div>
      </div>
      <div className={s.rowRight}>
        {archive.status === 'running' && pct != null && (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.progressLabel}>
              {archive.done_count}/{archive.total_count}
            </span>
          </div>
        )}
        <div className={s.actions}>
          {archive.status === 'completed' && (
            <button
              type="button"
              className={rowS.actionBtn}
              onClick={onDownload}
              title={t('mods.exportDownload')}
            >
              {t('mods.exportDownload')}
            </button>
          )}
          <button
            type="button"
            className={rowS.actionBtnDelete}
            onClick={onDelete}
            disabled={deleting}
            title={t('mods.exportDelete')}
          >
            {deleting ? t('mods.exportDeleting') : t('mods.exportDelete')}
          </button>
          <span
            className={s.badge}
            style={{
              background: statusColorBase(
                archive.status === 'running'
                  ? 'in_progress'
                  : archive.status === 'completed'
                    ? 'completed'
                    : 'failed',
              ),
            }}
          >
            {t(`importStatus.${statusKey}`, archive.status)}
          </span>
        </div>
      </div>
    </div>
  );
};
