import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Mod, type ModImportJob, type ModPreviewRow } from '../../../api';
import { Button } from '../../../components/Button';
import { ModalShell } from '../../../components/ModalShell';
import { modListQueryKey } from '../../../langDefaults';
import { LANGUAGES, type ModPreviewConfirmPayload } from '../importsShared';
import { useAutoPageSize } from '../hooks';
import parentS from '../ImportPage.module.scss';
import s from './ModPreviewModal.module.scss';

interface ModPreviewModalProps {
  job: ModImportJob;
  gameId: string;
  onClose: () => void;
  onConfirm: (payload: ModPreviewConfirmPayload) => void;
}

const PAGINATION_RESERVED_HEIGHT_PX = 56;

/** Preview modal for mod imports with optional apply-to-existing workflow. */
export const ModPreviewModal = ({ job, gameId, onClose, onConfirm }: ModPreviewModalProps) => {
  const { t } = useTranslation();
  const [lang, setLang] = useState(job.src_lang);
  const [applyEnabled, setApplyEnabled] = useState(false);
  const [applyToModId, setApplyToModId] = useState<number | null>(null);
  const [importAllLocalizations, setImportAllLocalizations] = useState(false);
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
    queryKey: ['mod-import-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () =>
      api.modImport.preview(job.id, {
        page,
        pageSize,
        signature: sigFilter || undefined,
        q: qFilter || undefined,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data?.isLocalized) {
      setImportAllLocalizations(true);
    }
  }, [data?.isLocalized]);

  const { data: gameMods = [] } = useQuery({
    queryKey: modListQueryKey(gameId),
    queryFn: () => api.mods.list(gameId),
    staleTime: 30_000,
  });

  const eligibleMods: Mod[] = gameMods.filter((mod) => mod.id !== job.mod_id);
  const effectiveApplyToModId = applyEnabled ? (applyToModId ?? eligibleMods[0]?.id ?? null) : null;
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const header = (
    <div className={s.modalHeaderTop}>
      <div>
        <h2 className={parentS.modalHeaderTitle}>{job.file_name}</h2>
        {data && (
          <span className={s.modalHeaderMeta}>
            {data.isLocalized ? t('modImport.localizedPlugin') : t('modImport.nonLocalizedPlugin')}
            {data.locales.length > 0 &&
              ` · ${t('modImport.locales', { locales: data.locales.join(', ') })}`}
          </span>
        )}
      </div>
      <button onClick={onClose} className={parentS.closeBtn} aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  );

  return (
    <ModalShell onClose={onClose} customHeader={header} hideCloseButton size="xl" stretchContent>
      <div className={parentS.langBar}>
        {/* Show "Import all localizations" checkbox for localized mods */}
        {data?.isLocalized && (
          <label className={`${parentS.langLabel} ${s.langCheckboxLabel}`}>
            <input
              type="checkbox"
              className={s.langCheckboxInput}
              checked={importAllLocalizations}
              onChange={(event) => {
                setImportAllLocalizations(event.target.checked);
                if (event.target.checked) {
                  setApplyEnabled(false); // Disable apply-to-existing when importing all localizations
                }
              }}
            />
            {t('modImport.importAllLocalizations')}
          </label>
        )}

        {/* Show language selector only if NOT importing all localizations */}
        {!importAllLocalizations && (
          <label className={parentS.langLabel}>
            {t('modImport.languageOfText')}
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value)}
              className={parentS.select}
            >
              {/* For localized mods, show only the detected locales (for single import mode) */}
              {data?.isLocalized && data?.locales.length > 0
                ? data.locales.map((locale) => {
                    const langInfo = LANGUAGES.find((l) => l.code === locale);
                    const label = langInfo ? langInfo.label : locale;
                    return (
                      <option key={locale} value={locale}>
                        {label}
                      </option>
                    );
                  })
                : LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
            </select>
          </label>
        )}

        {/* Show "Apply to existing" checkbox only if NOT importing all localizations */}
        {!importAllLocalizations && (
          <label className={`${parentS.langLabel} ${s.langCheckboxLabel}`}>
            <input
              type="checkbox"
              className={s.langCheckboxInput}
              checked={applyEnabled}
              onChange={(event) => setApplyEnabled(event.target.checked)}
            />
            {t('modImport.applyToExisting')}
          </label>
        )}

        {/* Show base mod selector only if applying to existing AND NOT importing all localizations */}
        {!importAllLocalizations && applyEnabled && (
          <>
            <label className={parentS.langLabel}>
              {t('modImport.baseMod')}
              <select
                value={effectiveApplyToModId ?? ''}
                onChange={(event) =>
                  setApplyToModId(event.target.value ? Number(event.target.value) : null)
                }
                className={parentS.select}
              >
                {eligibleMods.length === 0 && (
                  <option value="">{t('modImport.noEligibleMods')}</option>
                )}
                {eligibleMods.map((mod) => (
                  <option key={mod.id} value={mod.id}>
                    {mod.name} (#{mod.id})
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className={parentS.filterBar}>
        <select
          value={sigFilter}
          onChange={(event) => {
            setSigFilter(event.target.value);
            setPage(1);
          }}
          className={parentS.selectSig}
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
          className={parentS.searchInput}
        />
        <span className={parentS.filterBarCount}>
          {data ? t('common.strings', { count: data.total.toLocaleString() }) : ''}
        </span>
      </div>
      <div className={parentS.tableWrap} ref={tableWrapRef}>
        {isLoading ? (
          <div className={parentS.tableEmpty}>{t('common.loading')}</div>
        ) : (
          <table className={parentS.table}>
            <thead>
              <tr>
                <th className={parentS.th}>{t('csvImport.signature')}</th>
                <th className={parentS.th}>{t('csvImport.formId')}</th>
                <th className={parentS.th}>{t('csvImport.edid')}</th>
                <th className={parentS.th}>{t('modImport.path')}</th>
                <th className={s.thSourceWide}>{t('csvImport.sourceCol')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row: ModPreviewRow, index: number) => (
                <tr key={index}>
                  <td className={parentS.td}>
                    <code
                      className={`${parentS.codeSignature} ${parentS.cellEllipsisOneLine}`}
                      title={row.signature}
                    >
                      {row.signature}
                    </code>
                  </td>
                  <td className={parentS.td}>
                    <code
                      className={`${parentS.codeFormId} ${parentS.cellEllipsisOneLine}`}
                      title={row.formId}
                    >
                      {row.formId}
                    </code>
                  </td>
                  <td className={parentS.tdEdid} title={row.edid}>
                    {row.edid || '—'}
                  </td>
                  <td className={parentS.td}>
                    <span className={parentS.cellEllipsis} title={row.path}>
                      {row.path}
                    </span>
                  </td>
                  <td className={parentS.td}>
                    <span className={parentS.cellEllipsis} title={row.source}>
                      {row.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {totalPages > 1 && (
        <div className={parentS.pagination}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            {t('common.prev')}
          </Button>
          <span className={parentS.paginationLabel}>{t('common.page', { page, totalPages })}</span>
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
      <div className={parentS.footer}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="success"
          onClick={() =>
            onConfirm({
              importLang: lang,
              importAllLocalizations,
              applyEnabled: !importAllLocalizations && applyEnabled,
              applyToModId: !importAllLocalizations ? effectiveApplyToModId : null,
            })
          }
          disabled={!importAllLocalizations && applyEnabled && effectiveApplyToModId == null}
        >
          {importAllLocalizations && data?.locales.length
            ? t('modImport.importAllLocalizationsAs', {
                locales: data.locales.join(', '),
                count: job.total_records.toLocaleString(),
              })
            : t('modImport.importAs', { lang, count: job.total_records.toLocaleString() })}
        </Button>
      </div>
    </ModalShell>
  );
};
