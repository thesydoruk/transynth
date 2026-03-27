import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModImportDeleteDataMode } from '../../../api';
import parentS from '../ImportPage.module.scss';
import s from './DeleteModConfirmModal.module.scss';

interface DeleteModConfirmModalProps {
  fileName: string;
  deleting: boolean;
  onClose: () => void;
  onConfirm: (deleteData: ModImportDeleteDataMode) => void;
}

/**
 * Confirmation dialog for deleting a MOD import job and its related artifacts.
 * Uses the shared Imports modal shell for a consistent visual style.
 */
export const DeleteModConfirmModal = ({ fileName, deleting, onClose, onConfirm }: DeleteModConfirmModalProps) => {
  const { t } = useTranslation();
  const [deleteData, setDeleteData] = useState<ModImportDeleteDataMode>('job');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleting, onClose]);

  return (
    <div className={parentS.overlay} onClick={deleting ? undefined : onClose}>
      <div className={s.modalCompact} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-mod-title">
        <div className={parentS.modalHeader}>
          <h2 id="delete-mod-title" className={parentS.modalHeaderTitle}>{t('imports.deleteModTitle')}</h2>
          <button onClick={onClose} className={parentS.closeBtn} disabled={deleting} aria-label={t('common.close')}>✕</button>
        </div>

        <div className={s.body}>
          <p className={s.primaryText}>{t('imports.deleteModMessage', { name: fileName })}</p>
          <div className={s.options} role="radiogroup" aria-label={t('imports.deleteModModeTitle')}>
            <label className={s.optionRow}>
              <input
                type="radio"
                name="delete-data-mode"
                value="job"
                checked={deleteData === 'job'}
                disabled={deleting}
                onChange={() => setDeleteData('job')}
              />
              <span>
                <strong>{t('imports.deleteModModeJob')}</strong>
                <small>{t('imports.deleteModModeJobHint')}</small>
              </span>
            </label>

            <label className={s.optionRow}>
              <input
                type="radio"
                name="delete-data-mode"
                value="rows"
                checked={deleteData === 'rows'}
                disabled={deleting}
                onChange={() => setDeleteData('rows')}
              />
              <span>
                <strong>{t('imports.deleteModModeRows')}</strong>
                <small>{t('imports.deleteModModeRowsHint')}</small>
              </span>
            </label>

            <label className={s.optionRow}>
              <input
                type="radio"
                name="delete-data-mode"
                value="mod"
                checked={deleteData === 'mod'}
                disabled={deleting}
                onChange={() => setDeleteData('mod')}
              />
              <span>
                <strong>{t('imports.deleteModModeMod')}</strong>
                <small>{t('imports.deleteModModeModHint')}</small>
              </span>
            </label>
          </div>
        </div>

        <div className={parentS.footer}>
          <button onClick={onClose} className={parentS.btnCancel} disabled={deleting}>{t('common.cancel')}</button>
          <button onClick={() => onConfirm(deleteData)} className={s.btnDanger} disabled={deleting}>
            {deleting ? t('common.loading') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
};
