import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import parentS from '../ImportPage.module.scss';
import s from './DeleteModConfirmModal.module.scss';

interface DeleteModConfirmModalProps {
  fileName: string;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation dialog for deleting a MOD import job and its related artifacts.
 * Uses the shared Imports modal shell for a consistent visual style.
 */
export const DeleteModConfirmModal = ({ fileName, deleting, onClose, onConfirm }: DeleteModConfirmModalProps) => {
  const { t } = useTranslation();

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
          <p className={s.secondaryText}>{t('imports.deleteModImpact')}</p>
        </div>

        <div className={parentS.footer}>
          <button onClick={onClose} className={parentS.btnCancel} disabled={deleting}>{t('common.cancel')}</button>
          <button onClick={onConfirm} className={s.btnDanger} disabled={deleting}>
            {deleting ? t('common.loading') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
};
