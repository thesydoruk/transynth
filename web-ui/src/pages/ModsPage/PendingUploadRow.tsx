import { useTranslation } from 'react-i18next';
import type { PendingModUpload } from './modsPageTypes';
import rowS from './ModsPageRow.module.scss';

type PendingUploadRowProps = {
  upload: PendingModUpload;
};

export const PendingUploadRow = ({ upload }: PendingUploadRowProps) => {
  const { t } = useTranslation();

  return (
    <div className={`${rowS.row} ${rowS.pendingUploadRow}`}>
      <div className={rowS.rowLeft}>
        <span className={rowS.typeBadge}>MOD</span>
        <div>
          <span className={rowS.fileName}>{upload.fileName}</span>
          <span className={rowS.meta}>
            <span
              className={
                upload.phase === 'uploading' ? rowS.phaseChipUploading : rowS.phaseChipExtracting
              }
            >
              {upload.phase === 'uploading' ? t('common.uploading') : t('importStatus.extracting')}
            </span>
          </span>
        </div>
      </div>
      <div className={rowS.rowRight}>
        <div className={rowS.progressWrap}>
          <div className={rowS.progressTrack}>
            <div
              className={
                upload.phase === 'uploading' ? rowS.progressFill : rowS.progressFillExtracting
              }
              style={{ width: `${upload.percent}%` }}
            />
          </div>
          <span className={rowS.progressLabel}>{`${upload.percent}%`}</span>
        </div>
      </div>
    </div>
  );
};
