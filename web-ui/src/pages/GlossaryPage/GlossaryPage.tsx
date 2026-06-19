import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GlossaryEntry, type Mod } from '../../api';
import { useAuth } from '../../components/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import {
  getContentLanguageOptions,
  getSrcLang,
  getTgtLang,
  modListQueryKey,
} from '../../langDefaults';
import s from './GlossaryPage.module.scss';

export const GlossaryPage = () => {
  const { t } = useTranslation();
  const languageOptions = getContentLanguageOptions();
  const { multiUser, user } = useAuth();
  const qc = useQueryClient();
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [tgtLang, setTgtLang] = useState(getTgtLang());
  const [q, setQ] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editTerm, setEditTerm] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const newTermRef = useRef<HTMLInputElement | null>(null);

  /* ── Enforce panel state ─────────────────────────────────────────────── */
  const [enforceModId, setEnforceModId] = useState<number | ''>('');

  const { data: mods } = useQuery({
    queryKey: modListQueryKey(),
    queryFn: () => api.mods.list(),
  });

  const enforce = useMutation({
    mutationFn: () =>
      api.glossary.enforce({
        modId: enforceModId !== '' ? enforceModId : undefined,
        targetLang: tgtLang || getTgtLang(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qa'] });
    },
  });
  const { data, isLoading } = useQuery({
    queryKey: ['glossary', srcLang, tgtLang, q],
    queryFn: () =>
      api.glossary.list({
        srcLang: srcLang || undefined,
        tgtLang: tgtLang || undefined,
        q: q || undefined,
      }),
  });

  const add = useMutation({
    mutationFn: () =>
      api.glossary.add(newTerm.trim(), newTranslation.trim() || null, srcLang, tgtLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['glossary'] });
      setNewTerm('');
      setNewTranslation('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.glossary.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      term,
      translation,
    }: {
      id: number;
      term: string;
      translation: string | null;
    }) => api.glossary.update(id, term, translation),
    onSuccess: () => {
      setEditId(null);
      setEditTerm('');
      setEditTranslation('');
      qc.invalidateQueries({ queryKey: ['glossary'] });
    },
  });

  const startEdit = (entry: GlossaryEntry) => {
    setEditId(entry.id);
    setEditTerm(entry.term);
    setEditTranslation(entry.translation ?? '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditTerm('');
    setEditTranslation('');
  };

  const saveEdit = () => {
    if (!editId || !editTerm.trim()) return;
    update.mutate({
      id: editId,
      term: editTerm.trim(),
      translation: editTranslation.trim() || null,
    });
  };

  const emptyHint =
    multiUser && user
      ? user.role === 'reviewer'
        ? t('glossary.emptyReviewerHint')
        : user.role === 'admin'
          ? t('glossary.emptyAdminHint')
          : t('glossary.emptyTranslatorHint')
      : t('glossary.emptyTranslatorHint');

  return (
    <div className={s.page}>
      <PageHeader title={t('glossary.title')} description={t('glossary.description')} />

      {/* Controls */}
      <div className={s.toolbar}>
        <label className={s.filterLabel}>
          {t('glossary.sourceLang')}
          <select
            value={srcLang}
            onChange={(e) => setSrcLang(e.target.value)}
            className={s.selectIndent}
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
          {t('glossary.targetLang')}
          <select
            value={tgtLang}
            onChange={(e) => setTgtLang(e.target.value)}
            className={s.selectIndent}
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
          placeholder={t('glossary.filterPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={s.input}
        />
      </div>

      {/* Add term pair */}
      <div className={s.toolbarAdd}>
        <input
          ref={newTermRef}
          placeholder={t('glossary.sourceTermPlaceholder')}
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          className={s.inputTerm}
        />
        <span className={s.arrow}>→</span>
        <input
          placeholder={t('glossary.translationPlaceholder')}
          value={newTranslation}
          onChange={(e) => setNewTranslation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newTerm.trim() && add.mutate()}
          className={s.inputTerm}
        />
        <button
          onClick={() => newTerm.trim() && add.mutate()}
          disabled={add.isPending || !newTerm.trim()}
          className={s.btnAdd}
        >
          {t('glossary.addPair')}
        </button>
        {add.isError && <span className={s.addError}>{add.error?.message}</span>}
      </div>

      {/* ── Enforce glossary panel ─────────────────────────────────── */}
      <div className={s.enforcePanel}>
        <span className={s.enforceLabel}>{t('glossary.enforceLabel')}</span>
        <select
          value={enforceModId}
          onChange={(e) => setEnforceModId(e.target.value === '' ? '' : Number(e.target.value))}
          className={s.selectIndent}
        >
          <option value="">{t('glossary.allMods')}</option>
          {mods?.map((m: Mod) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => enforce.mutate()}
          disabled={enforce.isPending}
          className={s.btnEnforce}
        >
          {enforce.isPending ? t('glossary.enforcing') : t('glossary.enforceBtn')}
        </button>
        {enforce.isSuccess && (
          <span className={s.enforceResult}>
            {t('glossary.enforceResult', {
              checked: enforce.data.checked,
              violations: enforce.data.violations,
            })}
          </span>
        )}
        {enforce.isError && <span className={s.addError}>{enforce.error?.message}</span>}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className={s.center}>{t('common.loading')}</div>
      ) : !data?.length ? (
        <div className={s.emptyState}>
          <p className={s.emptyLead}>{t('glossary.noTerms')}</p>
          <p className={s.emptyHint}>{emptyHint}</p>
          <div className={s.emptyActions}>
            <button type="button" className={s.btnAdd} onClick={() => newTermRef.current?.focus()}>
              {t('glossary.focusAddAction')}
            </button>
          </div>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>{t('glossary.sourceTerm')}</th>
              <th className={s.th}>{t('glossary.translationCol')}</th>
              <th className={s.th}>{t('glossary.langs')}</th>
              <th className={s.th}>{t('glossary.sourceCol')}</th>
              <th className={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry: GlossaryEntry) => (
              <tr key={entry.id} className={s.tr}>
                <td className={s.tdTerm}>
                  {editId === entry.id ? (
                    <input
                      className={s.inlineInput}
                      value={editTerm}
                      onChange={(e) => setEditTerm(e.target.value)}
                    />
                  ) : (
                    entry.term
                  )}
                </td>
                <td className={entry.translation ? s.tdTranslFilled : s.tdTranslEmpty}>
                  {editId === entry.id ? (
                    <input
                      className={s.inlineInput}
                      value={editTranslation}
                      onChange={(e) => setEditTranslation(e.target.value)}
                      placeholder="—"
                    />
                  ) : (
                    (entry.translation ?? '—')
                  )}
                </td>
                <td className={s.tdLang}>
                  <span className={s.langBadge}>
                    {entry.src_lang}→{entry.tgt_lang}
                  </span>
                </td>
                <td className={s.tdSource}>{entry.source}</td>
                <td className={`${s.td} ${s.rowActions}`}>
                  {editId === entry.id ? (
                    <>
                      <button
                        onClick={saveEdit}
                        disabled={update.isPending || !editTerm.trim()}
                        className={s.btnRow}
                        title={t('glossary.saveTerm')}
                      >
                        {t('glossary.saveTerm')}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={update.isPending}
                        className={s.btnRowGhost}
                        title={t('glossary.cancelEdit')}
                      >
                        {t('glossary.cancelEdit')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(entry)}
                        className={s.btnRowGhost}
                        title={t('glossary.editTerm')}
                      >
                        {t('glossary.editTerm')}
                      </button>
                      <button
                        onClick={() => remove.mutate(entry.id)}
                        disabled={remove.isPending}
                        className={s.btnDelete}
                        title={t('glossary.deleteTerm')}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {update.isError && (
        <div className={s.addError}>{t('common.error', { message: String(update.error) })}</div>
      )}
    </div>
  );
};
