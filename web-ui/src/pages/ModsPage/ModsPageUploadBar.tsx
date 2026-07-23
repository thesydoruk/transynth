import { useTranslation } from 'react-i18next';
import { ACCEPTED_UPLOAD_EXTENSIONS } from './modsPageUtils';
import s from './ModsPage.module.scss';

type ModsPageUploadBarProps = {
  fileRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  pendingCount: number;
  onUpload: () => void;
  onStartAll: () => void;
};

export const ModsPageUploadBar = ({
  fileRef,
  uploading,
  pendingCount,
  onUpload,
  onStartAll,
}: ModsPageUploadBarProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.uploadBar}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_UPLOAD_EXTENSIONS}
        multiple
        className={s.fileInput}
      />
      <button onClick={onUpload} disabled={uploading} className={s.btn}>
        {uploading ? t('common.uploading') : t('common.upload')}
      </button>
      {pendingCount > 0 && (
        <button onClick={onStartAll} className={s.btnImportAll}>
          {t('imports.importAll', { count: pendingCount })}
        </button>
      )}
    </div>
  );
};
