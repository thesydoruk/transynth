import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type CsvImportJob, type CsvPreviewRow } from '../../../api';
import { ModalShell } from '../../../components/ModalShell';
import { LANGUAGES } from '../importsShared';
import s from '../ImportPage.module.scss';

interface CsvPreviewModalProps {
  job: CsvImportJob;
  onClose: () => void;
  onConfirm: (srcLang: string, tgtLang: string) => void;
}

/** Preview modal for CSV imports with language selection and sample rows. */
export const CsvPreviewModal = ({ job, onClose, onConfirm }: CsvPreviewModalProps) => {
  const { t } = useTranslation();
  const [srcLang, setSrcLang] = useState(job.src_lang);
  const [tgtLang, setTgtLang] = useState(job.tgt_lang);
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
    queryKey: ['csv-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () => api.csv.preview(job.id, { page, pageSize, signature: sigFilter || undefined, q: qFilter || undefined }),
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <ModalShell
      onClose={onClose}
      title={job.file_name}
      closeAriaLabel={t('common.close')}
    >
        <div className={s.langBar}>
          <label className={s.langLabel}>{t('csvImport.sourceLang')}
            <select value={srcLang} onChange={(event) => setSrcLang(event.target.value)} className={s.select}>
              {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label} ({language.code})</option>)}
            </select>
          </label>
          <span className={s.langArrow}>→</span>
          <label className={s.langLabel}>{t('csvImport.targetLang')}
            <select value={tgtLang} onChange={(event) => setTgtLang(event.target.value)} className={s.select}>
              {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label} ({language.code})</option>)}
            </select>
          </label>
        </div>
        <div className={s.filterBar}>
          <select value={sigFilter} onChange={(event) => { setSigFilter(event.target.value); setPage(1); }} className={s.selectSig}>
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map((signature) => <option key={signature} value={signature}>{signature}</option>)}
          </select>
          <input type="text" placeholder={t('csvImport.searchPlaceholder')} value={qInput} onChange={(event) => setQInput(event.target.value)} className={s.searchInput} />
          <span className={s.filterBarCount}>{data ? t('common.records', { count: data.total.toLocaleString() }) : ''}</span>
        </div>
        <div className={s.tableWrap}>
          {isLoading ? <div className={s.tableEmpty}>{t('common.loading')}</div> : (
            <table className={s.table}>
              <thead><tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('csvImport.fieldCol')}</th>
                <th className={s.thSource}>{t('csvImport.sourceCol')}</th>
                <th className={s.thSource}>{t('csvImport.targetCol')}</th>
                <th className={s.th}>{t('csvImport.statusCol')}</th>
              </tr></thead>
              <tbody>
                {(data?.rows ?? []).map((row: CsvPreviewRow, index: number) => (
                  <tr key={index}>
                    <td className={s.td}><code className={s.codeSignature}>{row.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{row.formId}</code></td>
                    <td className={s.tdEdid} title={row.edid}>{row.edid || '—'}</td>
                    <td className={s.td}>{row.field}</td>
                    <td className={s.td}>{row.source}</td>
                    <td className={s.td}>{row.target || <span className={s.emptyValue}>—</span>}</td>
                    <td className={s.td}>
                      <span className={`${s.statusDot} ${row.status === 0x63 ? s.statusDotConfirmed : row.status === 0xFF ? s.statusDotUntranslated : s.statusDotOther}`} />
                      {row.status === 0x63 ? t('csvImport.confirmed') : row.status === 0xFF ? t('csvImport.untranslated') : String(row.status)}
                    </td>
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
          <button onClick={() => onConfirm(srcLang, tgtLang)} className={s.btnConfirm}>
            {t('csvImport.startImport', { count: job.total_records.toLocaleString() })}
          </button>
        </div>
    </ModalShell>
  );
};
