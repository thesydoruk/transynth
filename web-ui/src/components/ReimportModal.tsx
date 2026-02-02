/**
 * ReimportModal — shown after a mod import completes when one or more older
 * versions of the same mod (same name, different file hash) already exist in
 * the database.
 *
 * Presents a list of previous versions with their translation progress so the
 * user can pick which one to carry translations from.  Clicking "Open Diff"
 * navigates to /diff?newModId=X&oldModId=Y which auto-triggers the comparison.
 *
 * The modal can be dismissed without action ("Skip").
 *
 * @param newModId       - The mod ID that was just imported
 * @param prevVersions   - List of older versions from api.mods.previousVersions()
 * @param onClose        - Called when the user dismisses the modal
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PreviousVersionRow } from '../api';
import s from './ReimportModal.module.scss';

interface ReimportModalProps {
  newModId: number;
  prevVersions: PreviousVersionRow[];
  onClose: () => void;
}

export const ReimportModal = ({ newModId, prevVersions, onClose }: ReimportModalProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /** The old-version mod ID currently selected in the list */
  const [selectedId, setSelectedId] = useState<number | null>(
    prevVersions.length === 1 ? prevVersions[0].id : null,
  );

  /** Navigate to the diff page with both mod IDs pre-filled in the URL */
  const openDiff = () => {
    if (selectedId == null) return;
    onClose();
    navigate(`/diff?newModId=${newModId}&oldModId=${selectedId}`);
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={s.header}>
          <span className={s.icon}>🔄</span>
          <div className={s.headerText}>
            <p className={s.title}>{t('reimport.title')}</p>
            <p className={s.subtitle}>{t('reimport.subtitle', { count: prevVersions.length })}</p>
          </div>
          <button className={s.closeBtn} onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {/* Previous version list */}
        <div className={s.versionList}>
          {prevVersions.map((v) => {
            const pct = v.total_strings > 0
              ? Math.round((v.translated_strings / v.total_strings) * 100)
              : 0;
            const date = new Date(v.created_at).toLocaleDateString();
            return (
              <div
                key={v.id}
                className={`${s.versionRow} ${selectedId === v.id ? s.selected : ''}`}
                onClick={() => setSelectedId(v.id)}
                role="radio"
                aria-checked={selectedId === v.id}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedId(v.id)}
              >
                <div className={s.radioCircle} />
                <div className={s.versionInfo}>
                  <span className={s.versionName}>{v.name}</span>
                  <span className={s.versionMeta}>
                    {t('reimport.importedOn', { date })}
                    {' · '}
                    {t('reimport.strings', { count: v.total_strings.toLocaleString() })}
                  </span>
                </div>
                <span className={s.versionProgress}>
                  {pct}% {t('reimport.translated')}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className={s.footer}>
          <button className={s.btnSkip} onClick={onClose}>
            {t('reimport.skip')}
          </button>
          <button className={s.btnDiff} disabled={selectedId == null} onClick={openDiff}>
            {t('reimport.openDiff')}
          </button>
        </div>
      </div>
    </div>
  );
};
