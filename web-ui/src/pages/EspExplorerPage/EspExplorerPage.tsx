/**
 * EspExplorerPage — developer tool for browsing raw records inside an ESP/ESM/ESL plugin.
 *
 * Layout:
 *   - Mod selector at the top
 *   - Two-panel view once a mod is selected:
 *       Left sidebar  — list of top-level GRUP types with record counts; click to filter.
 *       Right panel   — paginated record table (FormID | Type | Flags | EDID) with an
 *                       expandable subrecord detail row showing the hex preview and
 *                       best-effort text interpretation of each subrecord's data.
 *
 * Useful for diagnosing why a record was or wasn't imported, verifying FormIDs,
 * and checking which subrecords a record carries.
 *
 * Route: /esp-explorer
 */

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type EspGrupInfo,
  type EspRecordsPage,
  type Mod,
} from '../../api';
import { SubrecordTable } from './SubrecordTable';
import s from './EspExplorerPage.module.scss';

// ── Constants ──────────────────────────────────────────────────────────────

/** Records shown per page. */
const PAGE_SIZE = 50;

/** Flag bitmasks we want to visualise as badges. */
const FLAG_COMPRESSED = 0x00040000;
const FLAG_LOCALIZED  = 0x00000080;
const FLAG_DELETED    = 0x00000020;
const FLAG_MASTER     = 0x00000001;

// ── Helper — parse hex flags into a readable set of badge labels ──────────

/**
 * Convert a hex flag string (e.g. "00040080") to an array of human-readable
 * badge labels for the most common flag bits.
 *
 * @param hex - 8-char uppercase hex flags string.
 * @returns Array of short badge strings.
 */
const parseFlagBadges = (hex: string): string[] => {
  const n = parseInt(hex, 16);
  const badges: string[] = [];
  if (n & FLAG_MASTER)     badges.push('MASTER');
  if (n & FLAG_DELETED)    badges.push('DEL');
  if (n & FLAG_LOCALIZED)  badges.push('LOC');
  if (n & FLAG_COMPRESSED) badges.push('CMPRS');
  return badges;
};

// ── Main page component ────────────────────────────────────────────────────

export const EspExplorerPage = () => {
  const { t } = useTranslation();

  /** ID of the mod whose ESP we are browsing. */
  const [selectedModId, setSelectedModId] = useState<number | null>(null);

  /** Currently selected GRUP type filter; empty string = all records. */
  const [selectedSig, setSelectedSig] = useState<string>('');

  /** Current pagination page (0-based). */
  const [page, setPage] = useState(0);

  /** Committed search query that drives the API call. */
  const [search, setSearch] = useState('');

  /** Draft search string while the user is typing (not yet committed). */
  const [searchInput, setSearchInput] = useState('');

  /** Set of expanded record FormIDs — each entry shows its subrecord table. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** Ref to the search input element for focus management. */
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Full list of mods for the top selector. */
  const { data: mods = [] } = useQuery<Mod[]>({
    queryKey: ['mods'],
    queryFn: () => api.mods.list(),
  });

  /** Top-level GRUP catalog for the selected mod. */
  const {
    data: grups = [],
    isFetching: grupsFetching,
    isError: grupsError,
  } = useQuery<EspGrupInfo[]>({
    queryKey: ['espGrups', selectedModId],
    queryFn: () => api.mods.espGrups(selectedModId!),
    enabled: selectedModId !== null,
  });

  /** Paginated record list for the current GRUP/search state. */
  const {
    data: recordsPage,
    isFetching: recordsFetching,
    isError: recordsError,
  } = useQuery<EspRecordsPage>({
    queryKey: ['espRecords', selectedModId, selectedSig, page, PAGE_SIZE, search],
    queryFn: () => api.mods.espRecords(selectedModId!, selectedSig, page, PAGE_SIZE, search),
    enabled: selectedModId !== null,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  /** Switch to a different mod; reset all view state. */
  const handleModChange = (modId: number | null) => {
    setSelectedModId(modId);
    setSelectedSig('');
    setPage(0);
    setSearch('');
    setSearchInput('');
    setExpanded(new Set());
  };

  /** Select a GRUP type from the sidebar (or '' for all records). */
  const handleSigSelect = (sig: string) => {
    setSelectedSig(sig);
    setPage(0);
    setExpanded(new Set());
  };

  /** Commit the draft search input and reset to page 0. */
  const commitSearch = () => {
    setSearch(searchInput);
    setPage(0);
    setExpanded(new Set());
  };

  /** Toggle subrecord expansion for the given record FormID. */
  const toggleExpand = (formId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) {
        next.delete(formId);
      } else {
        next.add(formId);
      }
      return next;
    });

  // ── Derived values ────────────────────────────────────────────────────────

  const records = recordsPage?.records ?? [];
  const totalRecords = recordsPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={s.page}>
      <h2 className={s.title}>{t('espExplorer.title')}</h2>
      <p className={s.hint}>{t('espExplorer.hint')}</p>

      {/* ── Mod selector ─────────────────────────────────────────────────── */}
      <div className={s.modBar}>
        <label className={s.label} htmlFor="esp-mod-select">
          {t('espExplorer.selectMod')}
        </label>
        <select
          id="esp-mod-select"
          className={s.select}
          value={selectedModId ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value);
            handleModChange(v || null);
          }}
        >
          <option value="">{t('espExplorer.selectModPlaceholder')}</option>
          {mods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Two-panel explorer (shown only when a mod is selected) ────────── */}
      {selectedModId !== null && (
        <div className={s.explorer}>

          {/* ── Left sidebar — GRUP list ─────────────────────────────────── */}
          <aside className={s.sidebar}>
            {grupsFetching && <p className={s.sideLoading}>{t('espExplorer.loading')}</p>}
            {grupsError  && <p className={s.sideError}>{t('espExplorer.error')}</p>}

            {!grupsFetching && !grupsError && (
              <>
                {/* "All records" entry */}
                <div
                  className={`${s.grupItem} ${selectedSig === '' ? s.grupActive : ''}`}
                  onClick={() => handleSigSelect('')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSigSelect('')}
                >
                  <span className={s.grupSig}>{t('espExplorer.allRecords')}</span>
                  <span className={s.grupCount}>
                    {grups.reduce((n, g) => n + g.recordCount, 0)}
                  </span>
                </div>

                {/* One entry per GRUP type */}
                {grups.map((g) => (
                  <div
                    key={g.signature}
                    className={`${s.grupItem} ${selectedSig === g.signature ? s.grupActive : ''}`}
                    onClick={() => handleSigSelect(g.signature)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleSigSelect(g.signature)}
                  >
                    <span className={s.grupSig}>{g.signature}</span>
                    <span className={s.grupCount}>{g.recordCount}</span>
                  </div>
                ))}
              </>
            )}
          </aside>

          {/* ── Right panel — record browser ────────────────────────────── */}
          <div className={s.panel}>

            {/* Search bar */}
            <div className={s.searchBar}>
              <input
                ref={searchRef}
                className={s.searchInput}
                type="text"
                value={searchInput}
                placeholder={t('espExplorer.searchPlaceholder')}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
              />
              <button className={s.searchBtn} onClick={commitSearch}>
                {t('espExplorer.searchBtn')}
              </button>
              {search && (
                <button
                  className={s.clearBtn}
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    setPage(0);
                    setExpanded(new Set());
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Status line */}
            <div className={s.statusLine}>
              {recordsFetching && <span>{t('espExplorer.loading')}</span>}
              {recordsError && <span className={s.errorText}>{t('espExplorer.error')}</span>}
              {!recordsFetching && !recordsError && (
                <span>
                  {t('espExplorer.recordCount', { count: totalRecords })}
                  {totalPages > 1 && ` — ${t('espExplorer.pageInfo', { page: page + 1, total: totalPages })}`}
                </span>
              )}
            </div>

            {/* Record table */}
            {!recordsError && records.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.recTable}>
                  <thead>
                    <tr>
                      <th className={s.thExpand} />
                      <th className={s.thFormId}>{t('espExplorer.colFormId')}</th>
                      <th className={s.thType}>{t('espExplorer.colType')}</th>
                      <th className={s.thFlags}>{t('espExplorer.colFlags')}</th>
                      <th className={s.thEdid}>{t('espExplorer.colEdid')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec) => {
                      const isExpanded = expanded.has(rec.formId);
                      const badges = parseFlagBadges(rec.flagsHex);

                      return [
                        /* Main record row */
                        <tr
                          key={rec.formId}
                          className={`${s.recRow} ${isExpanded ? s.recRowExpanded : ''}`}
                          onClick={() => toggleExpand(rec.formId)}
                        >
                          <td className={s.tdExpand}>
                            <span className={s.expandIcon}>{isExpanded ? '▾' : '▸'}</span>
                          </td>
                          <td className={s.tdFormId}>{rec.formId}</td>
                          <td className={s.tdType}>{rec.signature}</td>
                          <td className={s.tdFlags}>
                            <code className={s.flagHex}>{rec.flagsHex}</code>
                            {badges.map((b) => (
                              <span key={b} className={`${s.badge} ${s[`badge${b}`] ?? ''}`}>{b}</span>
                            ))}
                          </td>
                          <td className={s.tdEdid}>{rec.edid}</td>
                        </tr>,

                        /* Expanded subrecord detail row */
                        isExpanded && (
                          <tr key={`${rec.formId}_sub`} className={s.subDetailRow}>
                            <td colSpan={5} className={s.tdSubDetail}>
                              <SubrecordTable record={rec} />
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty state */}
            {!recordsFetching && !recordsError && records.length === 0 && (
              <p className={s.noRecords}>{t('espExplorer.noRecords')}</p>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className={s.pagination}>
                <button
                  className={s.pageBtn}
                  disabled={page === 0}
                  onClick={() => { setPage((p) => p - 1); setExpanded(new Set()); }}
                >
                  {t('common.prev')}
                </button>
                <span className={s.pageLabel}>
                  {t('common.page', { page: page + 1, totalPages })}
                </span>
                <button
                  className={s.pageBtn}
                  disabled={page >= totalPages - 1}
                  onClick={() => { setPage((p) => p + 1); setExpanded(new Set()); }}
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

