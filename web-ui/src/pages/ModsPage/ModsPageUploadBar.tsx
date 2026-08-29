import { useTranslation } from 'react-i18next';
import { ACCEPTED_ADVANCED_EXTENSIONS, ACCEPTED_MOD_EXTENSIONS } from './modsPageUtils';
import s from './ModsPage.module.scss';

type ModsPageUploadBarProps = {
  fileRef: React.RefObject<HTMLInputElement | null>;
  advancedFileRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  pendingCount: number;
  onUpload: () => void;
  onAdvancedUpload: () => void;
  onStartAll: () => void;
};

export const ModsPageUploadBar = ({
  fileRef,
  advancedFileRef,
  uploading,
  pendingCount,
  onUpload,
  onAdvancedUpload,
  onStartAll,
}: ModsPageUploadBarProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.uploadBlock}>
      <div className={s.uploadBar}>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_MOD_EXTENSIONS}
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

      <details className={s.advancedImport}>
        <summary>{t('imports.advancedImport')}</summary>
        <p className={s.advancedHint}>{t('imports.advancedImportHint')}</p>
        <div className={s.uploadBar}>
          <input
            ref={advancedFileRef}
            type="file"
            accept={ACCEPTED_ADVANCED_EXTENSIONS}
            multiple
            className={s.fileInput}
          />
          <button onClick={onAdvancedUpload} disabled={uploading} className={s.btn}>
            {uploading ? t('common.uploading') : t('common.upload')}
          </button>
        </div>
      </details>
    </div>
  );
};
