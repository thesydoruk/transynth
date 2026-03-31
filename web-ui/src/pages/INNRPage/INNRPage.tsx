import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { getContentLanguageOptions, getTgtLang } from '../../langDefaults';
import { GroupCard } from './GroupCard';
import s from './INNRPage.module.scss';

// ── Constants ─────────────────────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

/**
 * INNR Editor page — Instance Naming Rules for a single mod.
 *
 * Fallout 4 INNR records define compound item names assembled from component
 * "slots" (material, quality, type, …).  Each slot is a separate string that
 * the game concatenates at runtime.  A flat grid fails translators because they
 * cannot see which slots belong to the same naming rule — and grammatical
 * agreement between component parts is essential in inflected languages.
 *
 * This page groups all INNR components by base EDID so the translator can
 * translate an entire naming rule in one view.
 *
 * URL: /games/:gameId/mods/:modId/innr
 * Navigated to from the ModEditor via the "INNR" button (shown when INNR
 * records are present in the mod).
 */
export const INNRPage = () => {
  const { t } = useTranslation();
  const languageOptions = getContentLanguageOptions();
  const { modId: modIdParam, gameId } = useParams<{ modId: string; gameId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const modId = Number(modIdParam);

  // ── Local state ──────────────────────────────────────────────────────────
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [search, setSearch] = useState('');

  // ── Fetch INNR data ───────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['innr', modId, targetLang],
    queryFn: () => api.innr.list(modId, { targetLang }),
    enabled: !isNaN(modId),
  });

  // ── Save mutation ─────────────────────────────────────────────────────────
  /**
   * Saves a single INNR component translation using the standard strings
   * save endpoint.  On success, invalidates the innr query so the row
   * refreshes with the new status / timestamp.
   */
  const saveMut = useMutation({
    mutationFn: ({ stringId, text }: { stringId: number; text: string }) =>
      api.strings.saveTranslation(stringId, text, 'draft', targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['innr', modId, targetLang] });
    },
  });

  /** Clears a translation for an INNR component. */
  const clearMut = useMutation({
    mutationFn: ({ stringId }: { stringId: number }) =>
      api.strings.clearTranslation(stringId, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['innr', modId, targetLang] });
    },
  });

  const handleSave = useCallback(
    (stringId: number, text: string) => saveMut.mutate({ stringId, text }),
    [saveMut],
  );

  const handleClear = useCallback(
    (stringId: number) => clearMut.mutate({ stringId }),
    [clearMut],
  );

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalGroups = data?.groups.length ?? 0;
  const totalRows = data?.total_rows ?? 0;
  const translatedRows = data?.groups.flatMap((g) => g.rows).filter((r) => r.translation !== null).length ?? 0;

  /** Groups filtered by search query on base EDID. */
  const filteredGroups = search
    ? (data?.groups ?? []).filter((g) =>
        g.base_edid.toLowerCase().includes(search.toLowerCase()),
      )
    : (data?.groups ?? []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={s.page}>
      {/* Page header with back button */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => navigate(`/games/${gameId}/mods/${modId}`)}>
          ← {t('innr.backToEditor')}
        </button>
        <h2 className={s.title}>{t('innr.title')}</h2>
        {data?.mod_name && (
          <span className={s.modName}>{data.mod_name}</span>
        )}
      </div>

      {/* Toolbar */}
      <div className={s.toolbar}>
        {/* Language selector */}
        <span className={s.label}>{t('innr.lang')}:</span>
        <select
          className={s.select}
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
        >
          {languageOptions.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>

        {/* Search by base EDID */}
        <span className={s.label}>{t('innr.search')}:</span>
        <input
          className={s.searchInput}
          type="text"
          placeholder={t('innr.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Stats */}
        {!isLoading && (
          <div className={s.statsBar}>
            <div className={s.statItem}>
              <strong>{totalGroups}</strong>
              <span>{t('innr.groups')}</span>
            </div>
            <div className={s.statItem}>
              <strong>{translatedRows}/{totalRows}</strong>
              <span>{t('innr.translated')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && <div className={s.empty}>{t('innr.loading')}</div>}

      {/* Empty state — mod has no INNR records at all */}
      {!isLoading && totalRows === 0 && (
        <div className={s.empty}>{t('innr.noRecords')}</div>
      )}

      {/* No search results */}
      {!isLoading && totalRows > 0 && filteredGroups.length === 0 && (
        <div className={s.empty}>{t('innr.noResults')}</div>
      )}

      {/* Group cards */}
      {!isLoading && filteredGroups.length > 0 && (
        <div className={s.groups}>
          {filteredGroups.map((group) => (
            <GroupCard
              key={group.base_edid}
              group={group}
              defaultOpen={totalGroups <= 10}
              onSave={handleSave}
              onClear={handleClear}
              isSaving={saveMut.isPending || clearMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
};

