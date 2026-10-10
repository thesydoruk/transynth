import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { getContentLanguageOptions } from '../../langDefaults';
import { REFERENCE_PAGE_SIZE, useReferencePage } from './useReferencePage';
import s from './ReferencePage.module.scss';
import { TableScroll } from '../../components/TableScroll';

const ORIGIN_KEYS: Record<string, string> = {
  manual: 'reference.origins.manual',
  promote: 'reference.origins.promote',
  delete_snapshot: 'reference.origins.deleteSnapshot',
  auto_approve: 'reference.origins.autoApprove',
};

/**
 * Per-game reference base: translations that outlive the mods they came from.
 * Route: /games/:gameId/reference.
 */
export const ReferencePage = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const languageOptions = getContentLanguageOptions();
  const p = useReferencePage(gameId);

  const total = p.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / REFERENCE_PAGE_SIZE));
  const anchorOf = (row: {
    signature: string | null;
    path: string;
    edid: string;
    formid_hex: string;
  }) => [row.signature, row.path, row.edid || row.formid_hex].filter(Boolean).join(' · ');

  return (
    <div className={s.page}>
      <PageHeader
        title={t('reference.title')}
        description={t('reference.description')}
        actions={
          <Link to={`/games/${gameId}`} className={s.btnGhost}>
            {t('reference.backToHub')}
          </Link>
        }
      />

      <div className={s.toolbar}>
        <label className={s.filterLabel}>
          {t('reference.sourceLang')}
          <select
            value={p.srcLang}
            onChange={(e) => p.setFilter.srcLang(e.target.value)}
            className={s.select}
          >
            {languageOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            <option value="">{t('common.all')}</option>
          </select>
        </label>
        <label className={s.filterLabel}>
          {t('reference.targetLang')}
          <select
            value={p.tgtLang}
            onChange={(e) => p.setFilter.tgtLang(e.target.value)}
            className={s.select}
          >
            {languageOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            <option value="">{t('common.all')}</option>
          </select>
        </label>
        <input
          placeholder={t('reference.filterPlaceholder')}
          value={p.q}
          onChange={(e) => p.setFilter.q(e.target.value)}
          className={s.input}
        />
        <span className={s.total}>{t('reference.total', { count: total })}</span>
      </div>

      <div className={s.toolbarAdd}>
        <input
          ref={p.newSourceRef}
          placeholder={t('reference.sourcePlaceholder')}
          value={p.newSource}
          onChange={(e) => p.setNewSource(e.target.value)}
          className={s.inputPair}
        />
        <span className={s.arrow}>→</span>
        <input
          placeholder={t('reference.translationPlaceholder')}
          value={p.newTranslation}
          onChange={(e) => p.setNewTranslation(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && p.newSource.trim() && p.newTranslation.trim() && p.add.mutate()
          }
          className={s.inputPair}
        />
        <button
          type="button"
          onClick={() => p.add.mutate()}
          disabled={p.add.isPending || !p.newSource.trim() || !p.newTranslation.trim()}
          className={s.btnAdd}
        >
          {t('reference.addPair')}
        </button>
        {p.add.isError && <span className={s.error}>{String(p.add.error)}</span>}
      </div>

      <div className={s.promotePanel}>
        <span className={s.promoteLabel}>{t('reference.promoteLabel')}</span>
        <select
          value={p.promoteModId}
          onChange={(e) => p.setPromoteModId(e.target.value === '' ? '' : Number(e.target.value))}
          className={s.select}
        >
          <option value="">{t('reference.promoteAllMods')}</option>
          {p.mods?.map((mod) => (
            <option key={mod.id} value={mod.id}>
              {mod.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={s.btnPromote}
          onClick={() => p.promote.mutate()}
          disabled={p.promote.isPending || !p.mods?.length}
        >
          {p.promote.isPending ? t('reference.promoting') : t('reference.promoteBtn')}
        </button>
        {p.promote.isSuccess && (
          <span className={s.promoteResult}>
            {t('reference.promoteResult', { count: p.promote.data.promoted })}
          </span>
        )}
        {p.promote.isError && <span className={s.error}>{String(p.promote.error)}</span>}
        <span className={s.promoteHint}>{t('reference.promoteHint')}</span>
      </div>

      {p.isLoading ? (
        <div className={s.center}>{t('common.loading')}</div>
      ) : !p.data?.rows.length ? (
        <div className={s.emptyState}>
          <p className={s.emptyLead}>{t('reference.empty')}</p>
          <p className={s.emptyHint}>{t('reference.emptyHint')}</p>
          <div className={s.emptyActions}>
            <button
              type="button"
              className={s.btnAdd}
              onClick={() => p.newSourceRef.current?.focus()}
            >
              {t('reference.focusAddAction')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <TableScroll minWidth={760} stickyActions cards>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>{t('reference.sourceCol')}</th>
                  <th className={s.th}>{t('reference.translationCol')}</th>
                  <th className={s.th}>{t('reference.anchorCol')}</th>
                  <th className={s.th}>{t('reference.originCol')}</th>
                  <th className={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {p.data.rows.map((row) => {
                  const editing = p.editId === row.id;
                  return (
                    <tr key={row.id} className={s.tr}>
                      <td className={s.tdSource}>
                        {editing ? (
                          <textarea
                            className={s.inlineInput}
                            value={p.editSource}
                            rows={2}
                            onChange={(e) => p.setEditSource(e.target.value)}
                          />
                        ) : (
                          row.source_text
                        )}
                      </td>
                      <td className={s.tdTranslation}>
                        {editing ? (
                          <textarea
                            className={s.inlineInput}
                            value={p.editTranslation}
                            rows={2}
                            onChange={(e) => p.setEditTranslation(e.target.value)}
                          />
                        ) : (
                          row.translation
                        )}
                      </td>
                      <td className={s.tdMeta} title={`${row.formid_hex} ${row.path}`.trim()}>
                        {anchorOf(row) || '—'}
                      </td>
                      <td className={s.tdMeta}>
                        <span className={s.originBadge}>
                          {t(ORIGIN_KEYS[row.origin] ?? row.origin)}
                        </span>
                        {row.origin_mod_name && (
                          <span className={s.originMod} title={row.origin_mod_version ?? undefined}>
                            {row.origin_mod_name}
                          </span>
                        )}
                      </td>
                      <td className={`${s.td} ${s.rowActions}`}>
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={p.saveEdit}
                              disabled={
                                p.update.isPending ||
                                !p.editSource.trim() ||
                                !p.editTranslation.trim()
                              }
                              className={s.btnRow}
                            >
                              {t('reference.save')}
                            </button>
                            <button
                              type="button"
                              onClick={p.cancelEdit}
                              disabled={p.update.isPending}
                              className={s.btnRowGhost}
                            >
                              {t('reference.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => p.startEdit(row)}
                              className={s.btnRowGhost}
                            >
                              {t('reference.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => p.remove.mutate(row.id)}
                              disabled={p.remove.isPending}
                              className={s.btnDelete}
                              title={t('reference.delete')}
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          {p.update.isError && <div className={s.error}>{String(p.update.error)}</div>}
          {pageCount > 1 && (
            <div className={s.pager}>
              <button
                type="button"
                className={s.btnRowGhost}
                disabled={p.page === 0 || p.isFetching}
                onClick={() => p.setPage(p.page - 1)}
              >
                ‹
              </button>
              <span className={s.pagerText}>
                {t('reference.pageOf', { page: p.page + 1, pages: pageCount })}
              </span>
              <button
                type="button"
                className={s.btnRowGhost}
                disabled={p.page + 1 >= pageCount || p.isFetching}
                onClick={() => p.setPage(p.page + 1)}
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
