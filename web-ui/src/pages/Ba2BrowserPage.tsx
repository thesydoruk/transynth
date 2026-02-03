/**
 * Ba2BrowserPage — developer tool for browsing BA2 archive contents.
 *
 * Shows a list of all BA2 archives associated with a selected mod, with
 * the full file listing inside each archive displayed in a collapsible
 * tree-style panel.  Useful for verifying that MCM / PEX / STRINGS files
 * are present in the expected archives.
 *
 * Route: /ba2-browser
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Ba2ArchiveInfo, type Mod } from '../api';
import s from './Ba2BrowserPage.module.scss';

/** Filter a flat file list down to entries containing the search term (case-insensitive). */
const filterFiles = (files: Ba2ArchiveInfo['files'], q: string) => {
  if (!q.trim()) return files;
  const lower = q.toLowerCase();
  return files.filter((f) => f.name.toLowerCase().includes(lower));
};

export const Ba2BrowserPage = () => {
  const { t } = useTranslation();

  /** Selected mod ID whose archives we are browsing. */
  const [selectedModId, setSelectedModId] = useState<number | null>(null);

  /** Per-archive expansion state: archive name → open/closed. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /** Global file search term applied across all archives. */
  const [search, setSearch] = useState('');

  // Fetch the list of all mods for the selector
  const { data: mods = [] } = useQuery<Mod[]>({
    queryKey: ['mods'],
    queryFn: () => api.mods.list(),
  });

  // Fetch BA2 archive info for the selected mod
  const {
    data: archives = [],
    isFetching,
    isError,
  } = useQuery<Ba2ArchiveInfo[]>({
    queryKey: ['ba2Files', selectedModId],
    queryFn: () => api.mods.ba2Files(selectedModId!),
    enabled: selectedModId !== null,
  });

  const toggleArchive = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div className={s.page}>
      <h2 className={s.title}>{t('ba2Browser.title')}</h2>
      <p className={s.hint}>{t('ba2Browser.hint')}</p>

      {/* ── Mod selector ──────────────────────────────────────────────── */}
      <div className={s.toolbar}>
        <label className={s.label} htmlFor="mod-select">
          {t('ba2Browser.selectMod')}
        </label>
        <select
          id="mod-select"
          className={s.select}
          value={selectedModId ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSelectedModId(v || null);
            setExpanded({});
            setSearch('');
          }}
        >
          <option value="">{t('ba2Browser.selectModPlaceholder')}</option>
          {mods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {/* File search — only shown when a mod is selected */}
        {selectedModId !== null && (
          <input
            className={s.search}
            type="text"
            placeholder={t('ba2Browser.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {/* ── Loading / error states ──────────────────────────────────── */}
      {isFetching && (
        <p className={s.loading}>{t('ba2Browser.loading')}</p>
      )}

      {isError && (
        <p className={s.error}>{t('ba2Browser.error')}</p>
      )}

      {/* ── No archives found ──────────────────────────────────────── */}
      {!isFetching && !isError && selectedModId !== null && archives.length === 0 && (
        <p className={s.empty}>{t('ba2Browser.noArchives')}</p>
      )}

      {/* ── Archive list ───────────────────────────────────────────── */}
      {archives.map((arch) => {
        const isOpen = !!expanded[arch.archive];
        const visible = filterFiles(arch.files, search);

        return (
          <div key={arch.archive} className={s.archiveCard}>
            {/* Archive header — click to expand / collapse */}
            <button
              className={s.archiveHeader}
              onClick={() => toggleArchive(arch.archive)}
              aria-expanded={isOpen}
            >
              <span className={s.toggleIcon}>{isOpen ? '▾' : '▸'}</span>
              <span className={s.archiveName}>{arch.archive}</span>
              <span className={s.fileCount}>
                {arch.error
                  ? t('ba2Browser.readError')
                  : t('ba2Browser.fileCount', { count: arch.fileCount })}
              </span>
            </button>

            {/* File list — rendered only when expanded */}
            {isOpen && !arch.error && (
              <div className={s.fileList}>
                {visible.length === 0 ? (
                  <span className={s.noMatch}>{t('ba2Browser.noMatch')}</span>
                ) : (
                  <table className={s.fileTable}>
                    <thead>
                      <tr>
                        <th className={s.thPath}>{t('ba2Browser.colPath')}</th>
                        <th className={s.thExt}>{t('ba2Browser.colExt')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((f) => {
                        const ext = f.name.split('.').pop()?.toUpperCase() ?? '';
                        return (
                          <tr key={f.name} className={s.fileRow}>
                            <td className={s.tdPath}>{f.name}</td>
                            <td className={s.tdExt}>{ext}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {search && visible.length < arch.files.length && (
                  <p className={s.filterInfo}>
                    {t('ba2Browser.filterInfo', { shown: visible.length, total: arch.files.length })}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
