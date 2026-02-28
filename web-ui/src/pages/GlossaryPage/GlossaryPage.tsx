import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GlossaryEntry, type Mod } from '../../api';
import { getSrcLang, getTgtLang } from '../../langDefaults';
import s from './GlossaryPage.module.scss';

export const GlossaryPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [tgtLang, setTgtLang] = useState(getTgtLang());
  const [q, setQ] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newTranslation, setNewTranslation] = useState('');

  /* ── Enforce panel state ─────────────────────────────────────────────── */
  const [enforceModId, setEnforceModId] = useState<number | ''>('');

  const { data: mods } = useQuery({
    queryKey: ['mods'],
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
    queryFn: () => api.glossary.list({ srcLang: srcLang || undefined, tgtLang: tgtLang || undefined, q: q || undefined }),
  });

  const add = useMutation({
    mutationFn: () => api.glossary.add(newTerm.trim(), newTranslation.trim() || null, srcLang, tgtLang),
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

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('glossary.title')}</h1>
      <p className={s.description}>
        {t('glossary.description')}
      </p>

      {/* Controls */}
      <div className={s.toolbar}>
        <label className={s.filterLabel}>{t('glossary.sourceLang')}
          <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)} className={s.selectIndent}>
            <option value="en">EN</option>
            <option value="uk">UK</option>
            <option value="">{t('common.all')}</option>
          </select>
        </label>
        <label className={s.filterLabel}>{t('glossary.targetLang')}
          <select value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} className={s.selectIndent}>
            <option value="uk">UK</option>
            <option value="en">EN</option>
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
            <option key={m.id} value={m.id}>{m.name}</option>
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
        <div className={s.center}>
          <p>{t('glossary.noTerms')}</p>
          <p className={s.emptyHint}>
            {t('glossary.emptyHint')}
          </p>
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
                <td className={s.tdTerm}>{entry.term}</td>
                <td className={entry.translation ? s.tdTranslFilled : s.tdTranslEmpty}>
                  {entry.translation ?? '—'}
                </td>
                <td className={s.tdLang}>
                  <span className={s.langBadge}>{entry.src_lang}→{entry.tgt_lang}</span>
                </td>
                <td className={s.tdSource}>{entry.source}</td>
                <td className={s.td}>
                  <button
                    onClick={() => remove.mutate(entry.id)}
                    disabled={remove.isPending}
                    className={s.btnDelete}
                    title={t('glossary.deleteTerm')}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

