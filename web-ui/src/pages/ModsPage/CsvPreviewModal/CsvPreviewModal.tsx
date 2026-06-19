import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type CsvImportJob, type CsvPreviewRow } from '../../../api';
import { Button } from '../../../components/Button';
import { ModalShell } from '../../../components/ModalShell';
import { LANGUAGES } from '../modsShared';
import { useAutoPageSize } from '../hooks';
import s from '../ModsPage.module.scss';

interface CsvPreviewModalProps {
  job: CsvImportJob;
  onClose: () => void;
  onConfirm: (srcLang: string, tgtLang: string) => void;
}

const PAGINATION_RESERVED_HEIGHT_PX = 56;

/** Preview modal for CSV imports with language selection and sample rows. */
export const CsvPreviewModal = ({ job, onClose, onConfirm }: CsvPreviewModalProps) => {
  const { t } = useTranslation();
  const [srcLang, setSrcLang] = useState(job.src_lang);
  const [tgtLang, setTgtLang] = useState(job.tgt_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const [pageSize, tableWrapRef] = useAutoPageSize(30, PAGINATION_RESERVED_HEIGHT_PX);

  useEffect(() => {
    const id = setTimeout(() => {
      setQFilter(qInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['csv-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () =>
      api.csv.preview(job.id, {
        page,
        pageSize,
        signature: sigFilter || undefined,
        q: qFilter || undefined,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <ModalShell
      onClose={onClose}
      title={job.file_name}
      closeAriaLabel={t('common.close')}
      size="xl"
      stretchContent
    >
      <div className={s.langBar}>
        <label className={s.langLabel}>
          {t('csvImport.sourceLang')}
          <select
            value={srcLang}
            onChange={(event) => setSrcLang(event.target.value)}
            className={s.select}
          >
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <span className={s.langArrow}>→</span>
        <label className={s.langLabel}>
          {t('csvImport.targetLang')}
          <select
            value={tgtLang}
            onChange={(event) => setTgtLang(event.target.value)}
            className={s.select}
          >
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.filterBar}>
        <select
          value={sigFilter}
          onChange={(event) => {
            setSigFilter(event.target.value);
            setPage(1);
          }}
          className={s.selectSig}
        >
          <option value="">{t('csvImport.allSignatures')}</option>
          {(data?.signatures ?? []).map((signature) => (
            <option key={signature} value={signature}>
              {signature}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={t('csvImport.searchPlaceholder')}
          value={qInput}
          onChange={(event) => setQInput(event.target.value)}
          className={s.searchInput}
        />
        <span className={s.filterBarCount}>
          {data ? t('common.records', { count: data.total.toLocaleString() }) : ''}
        </span>
      </div>
      <div className={s.tableWrap} ref={tableWrapRef}>
        {isLoading ? (
          <div className={s.tableEmpty}>{t('common.loading')}</div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('csvImport.fieldCol')}</th>
                <th className={s.thSource}>{t('csvImport.sourceCol')}</th>
                <th className={s.thSource}>{t('csvImport.targetCol')}</th>
                <th className={s.th}>{t('csvImport.statusCol')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row: CsvPreviewRow, index: number) => (
                <tr key={index}>
                  <td className={s.td}>
                    <code
                      className={`${s.codeSignature} ${s.cellEllipsisOneLine}`}
                      title={row.signature}
                    >
                      {row.signature}
                    </code>
                  </td>
                  <td className={s.td}>
                    <code className={`${s.codeFormId} ${s.cellEllipsisOneLine}`} title={row.formId}>
                      {row.formId}
                    </code>
                  </td>
                  <td className={s.tdEdid} title={row.edid}>
                    {row.edid || '—'}
                  </td>
                  <td className={s.td}>
                    <span className={s.cellEllipsis} title={row.field}>
                      {row.field}
                    </span>
                  </td>
                  <td className={s.td}>
                    <span className={s.cellEllipsis} title={row.source}>
                      {row.source}
                    </span>
                  </td>
                  <td className={s.td}>
                    {row.target ? (
                      <span className={s.cellEllipsis} title={row.target}>
                        {row.target}
                      </span>
                    ) : (
                      <span className={s.emptyValue}>—</span>
                    )}
                  </td>
                  <td className={s.td}>
                    <span
                      className={`${s.statusDot} ${row.status === 0x63 ? s.statusDotConfirmed : row.status === 0xff ? s.statusDotUntranslated : s.statusDotOther}`}
                    />
                    <span className={s.cellEllipsisOneLine}>
                      {row.status === 0x63
                        ? t('csvImport.confirmed')
                        : row.status === 0xff
                          ? t('csvImport.untranslated')
                          : String(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {totalPages > 1 && (
        <div className={s.pagination}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            {t('common.prev')}
          </Button>
          <span className={s.paginationLabel}>{t('common.page', { page, totalPages })}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="success" onClick={() => onConfirm(srcLang, tgtLang)}>
          {t('csvImport.startImport', { count: job.total_records.toLocaleString() })}
        </Button>
      </div>
    </ModalShell>
  );
};
