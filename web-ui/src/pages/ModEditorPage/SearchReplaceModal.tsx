import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import styles from './ModEditorPage.module.scss';

interface SearchReplaceModalProps {
  modId: number;
  targetLang: string;
  onClose: () => void;
  onApplied: () => void;
}

/** Modal for previewing and applying bulk search-and-replace operations. */
export const SearchReplaceModal = ({ modId, targetLang, onClose, onApplied }: SearchReplaceModalProps) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ matches: Array<{ originalText: string; newText: string; formid_hex: string }>; applied: number } | null>(null);
  const [stage, setStage] = useState<'idle' | 'previewing' | 'applying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!search) return;
    setStage('previewing');
    setError(null);
    try {
      const result = await api.search.replace(modId, { search, replace, isRegex, targetLang, dryRun: true });
      setPreviewResult(result);
      setStage('idle');
    } catch (err) {
      setError(String(err));
      setStage('idle');
    }
  };

  const handleApply = async () => {
    if (!search) return;
    setStage('applying');
    setError(null);
    try {
      const result = await api.search.replace(modId, { search, replace, isRegex, targetLang, dryRun: false });
      setPreviewResult(result);
      setStage('done');
      onApplied();
    } catch (err) {
      setError(String(err));
      setStage('idle');
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(event) => event.stopPropagation()}>
        <h3 className={styles.modalTitle}>{t('modEditor.searchReplaceTitle')}</h3>
        <div className={styles.modalForm}>
          <input placeholder={t('modEditor.searchLabel')} value={search} onChange={(event) => setSearch(event.target.value)} className={styles.modalInput} />
          <input placeholder={t('modEditor.replaceLabel')} value={replace} onChange={(event) => setReplace(event.target.value)} className={styles.modalInput} />
          <label className={styles.modalRegexLbl}>
            <input type="checkbox" checked={isRegex} onChange={(event) => setIsRegex(event.target.checked)} /> {t('modEditor.useRegex')}
          </label>
        </div>
        <div className={styles.modalBtnRow}>
          <button onClick={handlePreview} disabled={stage !== 'idle' || !search} className={styles.modalBtnDark}>{t('modEditor.preview', { count: previewResult?.matches.length ?? 0 })}</button>
          <button onClick={handleApply} disabled={stage !== 'idle' || !search} className={styles.modalBtnPri}>{t('common.apply')}</button>
          <button onClick={onClose} className={styles.modalBtnSec}>{t('common.cancel')}</button>
        </div>
        {error && <p className={styles.modalErr}>{error}</p>}
        {stage === 'done' && <p className={styles.modalOk}>{t('modEditor.applied', { count: previewResult?.applied })}</p>}
        {previewResult && stage !== 'done' && previewResult.matches.length > 0 && (
          <div className={styles.modalPreview}>
            {previewResult.matches.slice(0, 20).map((match, index) => (
              <div key={index} className={styles.modalPrevItem}>
                <span className={styles.modalPrevId}>{match.formid_hex}</span>
                <span className={styles.modalPrevOld}>{match.originalText.slice(0, 60)}</span>
                {' → '}
                <span className={styles.modalPrevNew}>{match.newText.slice(0, 60)}</span>
              </div>
            ))}
            {previewResult.matches.length > 20 && <p className={styles.modalPrevMore}>{t('modEditor.more', { count: previewResult.matches.length - 20 })}</p>}
          </div>
        )}
      </div>
    </div>
  );
};