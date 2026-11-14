import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useModsWorkspace } from './ModsWorkspaceContext';
import { acceptedModExtensions } from './modsPageUtils';
import s from './ModsPage.module.scss';

export const ModsPageUploadBar = () => {
  const { t } = useTranslation();
  const { gameId, upload } = useModsWorkspace();
  const { data: games } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: 60_000,
  });
  const accepted = acceptedModExtensions(
    games?.find((game) => game.id === gameId)?.uploadExtensions,
  );

  return (
    <div className={s.uploadBlock}>
      <div className={s.uploadBar}>
        <input
          ref={upload.fileRef}
          type="file"
          accept={accepted}
          multiple
          className={s.fileInput}
        />
        <button onClick={upload.onUpload} disabled={upload.uploading} className={s.btn}>
          {upload.uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {upload.pendingImportCount > 0 && (
          <button onClick={upload.onStartAll} className={s.btnImportAll}>
            {t('imports.importAll', { count: upload.pendingImportCount })}
          </button>
        )}
      </div>
    </div>
  );
};
