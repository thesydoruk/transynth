import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { NexusModFile } from '../../../../api';
import type { NexusDownloadJob } from '../../../../nexusDownloadQueue';
import { fmtBytes } from '../../utils/fmtBytes';
import { isImportableNexusFile } from '../../utils/isImportableNexusFile';
import { nexusFileCategoryLabel } from '../../utils/nexusFileCategory';
import s from './ModFilesSection.module.scss';

type ModFilesSectionProps = {
  files: NexusModFile[];
  fileActionError: string | null;
  fileActionInfo: string | null;
  busyActionKey: string | null;
  downloadJobMap: Map<number, NexusDownloadJob>;
  onDownload: (file: NexusModFile) => void;
  onImport: (file: NexusModFile) => void;
};

export const ModFilesSection = ({
  files,
  fileActionError,
  fileActionInfo,
  busyActionKey,
  downloadJobMap,
  onDownload,
  onImport,
}: ModFilesSectionProps) => {
  const { t } = useTranslation();

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('games.filesTitle')}</h2>
      {fileActionError && <p className={s.error}>{fileActionError}</p>}
      {fileActionInfo && <p className={s.hint}>{fileActionInfo}</p>}
      {files.length === 0 ? (
        <p className={s.empty}>{t('games.noFiles')}</p>
      ) : (
        <div className={s.filesTableWrap}>
          <table className={s.filesTable}>
            <thead>
              <tr>
                <th>{t('games.fileName')}</th>
                <th>{t('games.fileCategory')}</th>
                <th>{t('games.fileVersion')}</th>
                <th>{t('games.fileSize')}</th>
                <th>{t('games.fileUploaded')}</th>
                <th>{t('games.fileActions')}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const downloadJob = downloadJobMap.get(f.fileId);
                return (
                  <Fragment key={f.fileId}>
                    <tr>
                      <td>
                        <div className={s.fileNameCell}>
                          {f.name}
                          {f.isPrimary && (
                            <span className={s.primaryBadge}>{t('games.primaryFile')}</span>
                          )}
                        </div>
                      </td>
                      <td>{nexusFileCategoryLabel(f.categoryName, t)}</td>
                      <td>{f.version ?? '-'}</td>
                      <td>{fmtBytes(f.sizeBytes)}</td>
                      <td>{f.uploadedTime ?? '-'}</td>
                      <td>
                        <div className={s.fileActions}>
                          <button
                            type="button"
                            className={s.fileActionButton}
                            onClick={() => onDownload(f)}
                            disabled={
                              busyActionKey === `download:${f.fileId}` ||
                              busyActionKey === `import:${f.fileId}`
                            }
                          >
                            {busyActionKey === `download:${f.fileId}`
                              ? t('games.fileDownloading')
                              : t('games.fileDownloadAction')}
                          </button>

                          <button
                            type="button"
                            className={s.fileActionButton}
                            onClick={() => onImport(f)}
                            disabled={
                              !isImportableNexusFile(f.fileName ?? f.name) ||
                              busyActionKey === `import:${f.fileId}` ||
                              busyActionKey === `download:${f.fileId}`
                            }
                            title={
                              !isImportableNexusFile(f.fileName ?? f.name)
                                ? t('games.fileImportUnsupported')
                                : undefined
                            }
                          >
                            {busyActionKey === `import:${f.fileId}`
                              ? t('games.fileImporting')
                              : t('games.fileImportAction')}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {downloadJob && (
                      <tr className={s.fileProgressRow}>
                        <td colSpan={6} className={s.fileProgressCell}>
                          <div className={s.fileProgressTrack}>
                            <div
                              className={`${s.fileProgressFill}${downloadJob.status === 'failed' ? ` ${s.fileProgressFailed}` : ''}`}
                              style={{ width: `${downloadJob.progress}%` }}
                            />
                          </div>
                          <span className={s.fileProgressLabel}>
                            {downloadJob.status === 'failed'
                              ? t('common.error', { message: downloadJob.error ?? '' })
                              : `${t('games.fileDownloading')} ${downloadJob.progress}%`}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
