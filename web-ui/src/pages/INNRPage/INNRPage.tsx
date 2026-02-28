import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type InnrRow, type InnrGroup } from '../../api';
import { getTgtLang } from '../../langDefaults';
import { StatusBadge } from '../../components/StatusBadge';
import s from './INNRPage.module.scss';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Language options for the target-language dropdown. */
const LANG_OPTIONS = [
  { code: 'uk', label: 'Українська (uk)' },
  { code: 'ru', label: 'Русский (ru)' },
  { code: 'de', label: 'Deutsch (de)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'pl', label: 'Polski (pl)' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the numeric suffix from a full EDID string.
 * Returns the raw numeric string (e.g. "001", "002") or null if none found.
 *
 * Example: "ArmorMaterialSteel001" → "001"
 *          "SomeName"             → null
 */
const slotSuffix = (edid: string | null): string | null => {
  if (!edid) return null;
  const m = edid.match(/(\d+)$/);
  return m ? m[1] : null;
};

// ── Row component ─────────────────────────────────────────────────────────────

interface RowProps {
  row: InnrRow;
  targetLang: string;
  onSave: (stringId: number, text: string) => void;
  onClear: (stringId: number) => void;
  isSaving: boolean;
}

/**
 * A single INNR component row with an inline-editable translation field.
 *
 * Tracks a local "dirty" state while the user types.  The translation is
 * saved on blur or when the user presses Enter.
 */
const InnrRowItem = ({ row, onSave, onClear, isSaving }: RowProps) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(row.translation ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const isDirty = value !== (row.translation ?? '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setSaveState('dirty');
  };

  const handleSave = useCallback(() => {
    if (!isDirty || !value.trim()) return;
    onSave(row.string_id, value.trim());
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  }, [isDirty, value, onSave, row.string_id]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setValue(row.translation ?? '');
      setSaveState('idle');
    }
  };

  const slot = slotSuffix(row.edid);

  return (
    <tr className={s.tr}>
      {/* Slot number (numeric suffix of EDID) */}
      <td className={s.td}>
        {slot !== null && <span className={s.slotBadge}>{slot}</span>}
      </td>

      {/* FormID */}
      <td className={s.td}>
        <span className={s.formid}>{row.formid_hex}</span>
      </td>

      {/* Source text */}
      <td className={s.td}>
        <span className={s.srcText} title={row.source}>{row.source}</span>
      </td>

      {/* Inline translation input */}
      <td className={s.td}>
        <input
          className={[
            s.translInput,
            saveState === 'dirty' ? s.dirty : '',
            saveState === 'saved' ? s.saved : '',
          ].filter(Boolean).join(' ')}
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          placeholder={t('innr.translPlaceholder')}
          disabled={isSaving}
          aria-label={t('innr.translLabel', { source: row.source })}
        />
      </td>

      {/* Status */}
      <td className={s.td}>
        {row.status && <StatusBadge status={row.status} small />}
      </td>

      {/* QA issue count */}
      <td className={s.td}>
        {row.qa_issue_count > 0 && (
          <span className={s.qaBadge} title={t('innr.qaIssues', { count: row.qa_issue_count })}>
            {row.qa_issue_count}
          </span>
        )}
      </td>

      {/* Action buttons */}
      <td className={s.td}>
        <div className={s.actions}>
          <button
            className={s.saveBtn}
            disabled={!isDirty || isSaving}
            onClick={handleSave}
            title={t('innr.save')}
          >
            {t('innr.save')}
          </button>
          {row.translation !== null && (
            <button
              className={s.clearBtn}
              disabled={isSaving}
              onClick={() => onClear(row.string_id)}
              title={t('innr.clear')}
            >
              ✕
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ── Group card ────────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: InnrGroup;
  defaultOpen: boolean;
  targetLang: string;
  onSave: (stringId: number, text: string) => void;
  onClear: (stringId: number) => void;
  isSaving: boolean;
}

/**
 * Collapsible card for one INNR naming rule group.
 *
 * Shows the base EDID as the heading and all component rows in a table.
 * Progress indicator shows how many components have been translated.
 */
const GroupCard = ({ group, defaultOpen, targetLang, onSave, onClear, isSaving }: GroupCardProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const translated = group.rows.filter((r) => r.translation !== null).length;
  const total = group.rows.length;
  const allDone = translated === total;

  return (
    <div className={s.group}>
      {/* Collapsible header */}
      <div className={s.groupHeader} onClick={() => setOpen((v) => !v)}>
        <span className={`${s.chevron} ${open ? s.open : ''}`}>▶</span>
        <span className={s.baseEdid}>{group.base_edid || '—'}</span>
        <span className={s.groupCount}>{total}</span>
        <span className={`${s.groupProgress} ${allDone ? s.progressDone : ''}`}>
          {translated}/{total}
        </span>
      </div>

      {/* Component table */}
      {open && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('innr.colSlot')}</th>
                <th className={s.th}>{t('innr.colFormId')}</th>
                <th className={s.th}>{t('innr.colSource')}</th>
                <th className={s.th}>{t('innr.colTranslation')}</th>
                <th className={s.th}>{t('innr.colStatus')}</th>
                <th className={s.th}>{t('innr.colQA')}</th>
                <th className={s.th}>{t('innr.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <InnrRowItem
                  key={row.string_id}
                  row={row}
                  targetLang={targetLang}
                  onSave={onSave}
                  onClear={onClear}
                  isSaving={isSaving}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

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
          {LANG_OPTIONS.map((l) => (
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
              targetLang={targetLang}
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

