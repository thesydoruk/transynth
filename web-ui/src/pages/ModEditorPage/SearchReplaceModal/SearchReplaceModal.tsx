import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import s from './SearchReplaceModal.module.scss';

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
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalBox} onClick={(event) => event.stopPropagation()}>
        <h3 className={s.modalTitle}>{t('modEditor.searchReplaceTitle')}</h3>
        <div className={s.modalForm}>
          <input placeholder={t('modEditor.searchLabel')} value={search} onChange={(event) => setSearch(event.target.value)} className={s.modalInput} />
          <input placeholder={t('modEditor.replaceLabel')} value={replace} onChange={(event) => setReplace(event.target.value)} className={s.modalInput} />
          <label className={s.modalRegexLbl}>
            <input type="checkbox" checked={isRegex} onChange={(event) => setIsRegex(event.target.checked)} /> {t('modEditor.useRegex')}
          </label>
        </div>
        <div className={s.modalBtnRow}>
          <button onClick={handlePreview} disabled={stage !== 'idle' || !search} className={s.modalBtnDark}>{t('modEditor.preview', { count: previewResult?.matches.length ?? 0 })}</button>
          <button onClick={handleApply} disabled={stage !== 'idle' || !search} className={s.modalBtnPri}>{t('common.apply')}</button>
          <button onClick={onClose} className={s.modalBtnSec}>{t('common.cancel')}</button>
        </div>
        {error && <p className={s.modalErr}>{error}</p>}
        {stage === 'done' && <p className={s.modalOk}>{t('modEditor.applied', { count: previewResult?.applied })}</p>}
        {previewResult && stage !== 'done' && previewResult.matches.length > 0 && (
          <div className={s.modalPreview}>
            {previewResult.matches.slice(0, 20).map((match, index) => (
              <div key={index} className={s.modalPrevItem}>
                <span className={s.modalPrevId}>{match.formid_hex}</span>
                <span className={s.modalPrevOld}>{match.originalText.slice(0, 60)}</span>
                {' → '}
                <span className={s.modalPrevNew}>{match.newText.slice(0, 60)}</span>
              </div>
            ))}
            {previewResult.matches.length > 20 && <p className={s.modalPrevMore}>{t('modEditor.more', { count: previewResult.matches.length - 20 })}</p>}
          </div>
        )}
      </div>
    </div>
  );
};
