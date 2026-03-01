import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Mod, type ModImportJob, type ModPreviewRow } from '../../api';
import { LANGUAGES, type ModPreviewConfirmPayload } from './importsShared';
import s from './ImportPage.module.scss';

interface ModPreviewModalProps {
  job: ModImportJob;
  gameId: string;
  onClose: () => void;
  onConfirm: (payload: ModPreviewConfirmPayload) => void;
}

/** Preview modal for mod imports with optional apply-to-existing workflow. */
export const ModPreviewModal = ({ job, gameId, onClose, onConfirm }: ModPreviewModalProps) => {
  const { t } = useTranslation();
  const [lang, setLang] = useState(job.src_lang);
  const [applyEnabled, setApplyEnabled] = useState(false);
  const [applyToModId, setApplyToModId] = useState<number | null>(null);
  const [applyTargetLang, setApplyTargetLang] = useState(job.src_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const pageSize = 50;

  useEffect(() => {
    const id = setTimeout(() => {
      setQFilter(qInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['mod-import-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () => api.modImport.preview(job.id, { page, pageSize, signature: sigFilter || undefined, q: qFilter || undefined }),
    staleTime: 30_000,
  });

  const { data: gameMods = [] } = useQuery({
    queryKey: ['mods', gameId],
    queryFn: () => api.mods.list(gameId),
    staleTime: 30_000,
  });

  const eligibleMods: Mod[] = gameMods.filter((mod) => mod.id !== job.mod_id);
  const effectiveApplyToModId = applyEnabled ? (applyToModId ?? eligibleMods[0]?.id ?? null) : null;
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeaderTop}>
          <div>
            <h2 className={s.modalHeaderTitle}>{job.file_name}</h2>
            {data && (
              <span className={s.modalHeaderMeta}>
                {data.isLocalized ? t('modImport.localizedPlugin') : t('modImport.nonLocalizedPlugin')}
                {data.locales.length > 0 && ` · ${t('modImport.locales', { locales: data.locales.join(', ') })}`}
              </span>
            )}
          </div>
          <button onClick={onClose} className={s.closeBtn}>✕</button>
        </div>
        <div className={s.langBar}>
          <label className={s.langLabel}>{t('modImport.languageOfText')}
            <select value={lang} onChange={(event) => setLang(event.target.value)} className={s.select}>
              {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label} ({language.code})</option>)}
            </select>
          </label>

          <label className={`${s.langLabel} ${s.langCheckboxLabel}`}>
            <input
              type="checkbox"
              className={s.langCheckboxInput}
              checked={applyEnabled}
              onChange={(event) => setApplyEnabled(event.target.checked)}
            />
            {t('modImport.applyToExisting')}
          </label>

          {applyEnabled && (
            <>
              <label className={s.langLabel}>{t('modImport.baseMod')}
                <select
                  value={effectiveApplyToModId ?? ''}
                  onChange={(event) => setApplyToModId(event.target.value ? Number(event.target.value) : null)}
                  className={s.select}
                >
                  {eligibleMods.length === 0 && <option value="">{t('modImport.noEligibleMods')}</option>}
                  {eligibleMods.map((mod) => <option key={mod.id} value={mod.id}>{mod.name} (#{mod.id})</option>)}
                </select>
              </label>

              <label className={s.langLabel}>{t('modImport.applyTargetLang')}
                <select
                  value={applyTargetLang}
                  onChange={(event) => setApplyTargetLang(event.target.value)}
                  className={s.select}
                >
                  {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label} ({language.code})</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <div className={s.filterBar}>
          <select value={sigFilter} onChange={(event) => { setSigFilter(event.target.value); setPage(1); }} className={s.selectSig}>
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map((signature) => <option key={signature} value={signature}>{signature}</option>)}
          </select>
          <input type="text" placeholder={t('csvImport.searchPlaceholder')} value={qInput} onChange={(event) => setQInput(event.target.value)} className={s.searchInput} />
          <span className={s.filterBarCount}>{data ? t('common.strings', { count: data.total.toLocaleString() }) : ''}</span>
        </div>
        <div className={s.tableWrap}>
          {isLoading ? <div className={s.tableEmpty}>{t('common.loading')}</div> : (
            <table className={s.table}>
              <thead><tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('modImport.path')}</th>
                <th className={s.thSourceWide}>{t('csvImport.sourceCol')}</th>
              </tr></thead>
              <tbody>
                {(data?.rows ?? []).map((row: ModPreviewRow, index: number) => (
                  <tr key={index}>
                    <td className={s.td}><code className={s.codeSignature}>{row.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{row.formId}</code></td>
                    <td className={s.tdEdid} title={row.edid}>{row.edid || '—'}</td>
                    <td className={s.td}>{row.path}</td>
                    <td className={s.td}>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div className={s.pagination}>
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className={s.pageBtn}>{t('common.prev')}</button>
            <span className={s.paginationLabel}>{t('common.page', { page, totalPages })}</span>
            <button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className={s.pageBtn}>{t('common.next')}</button>
          </div>
        )}
        <div className={s.footer}>
          <button onClick={onClose} className={s.btnCancel}>{t('common.cancel')}</button>
          <button
            onClick={() => onConfirm({
              importLang: lang,
              applyEnabled,
              applyToModId: effectiveApplyToModId,
              applyTargetLang,
            })}
            className={s.btnConfirm}
            disabled={applyEnabled && effectiveApplyToModId == null}
          >
            {t('modImport.importAs', { lang, count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
};
