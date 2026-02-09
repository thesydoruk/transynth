import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type TradAutoRule, type Mod } from '../api';
import s from './TradAutoPage.module.scss';

/** Default values for the "add rule" form. */
const EMPTY_FORM = {
  game: 'fo4',
  priority: 10,
  pattern: '',
  replacement: '',
  signature: '',
  path: '',
  src_lang: 'en',
  tgt_lang: 'uk',
  description: '',
  is_active: true,
};

/**
 * TradAutoPage — manage pattern-match automatic translation rules.
 *
 * Lists all TradAuto rules in a table with inline-edit, add form, plus a
 * test panel (dry-run against sample texts) and an apply panel (apply rules
 * to a mod's untranslated strings).
 */
export const TradAutoPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Add-rule form state ──────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // ── Inline edit state (null = not editing) ───────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState({ ...EMPTY_FORM });

  // ── Test panel state ─────────────────────────────────────────────────────
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<
    (({ ruleId: number; translated: string }) | null)[] | null
  >(null);

  // ── Apply panel state ────────────────────────────────────────────────────
  const [applyModId, setApplyModId] = useState('');
  const [applyDry, setApplyDry] = useState(true);
  const [applyMsg, setApplyMsg] = useState('');

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: rules, isLoading } = useQuery({
    queryKey: ['tradAutoRules'],
    queryFn: () => api.tradAuto.list(),
  });

  /** Fetch mods list for the apply panel dropdown. */
  const { data: mods } = useQuery({
    queryKey: ['mods'],
    queryFn: () => api.mods.list(),
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: () =>
      api.tradAuto.create({
        game: form.game,
        priority: form.priority,
        pattern: form.pattern,
        replacement: form.replacement,
        signature: form.signature || null,
        path: form.path || null,
        src_lang: form.src_lang,
        tgt_lang: form.tgt_lang,
        description: form.description || null,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      setForm({ ...EMPTY_FORM });
    },
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: number; data: Partial<Omit<TradAutoRule, 'id' | 'created_at' | 'updated_at'>> }) =>
      api.tradAuto.update(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      setEditId(null);
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => api.tradAuto.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradAutoRules'] }),
  });

  const testMut = useMutation({
    mutationFn: (texts: string[]) => api.tradAuto.test(texts),
    onSuccess: (data) => setTestResults(data.results),
  });

  const applyMut = useMutation({
    mutationFn: () => api.tradAuto.apply(Number(applyModId), applyDry),
    onSuccess: (data) => {
      if (data.dryRun) {
        setApplyMsg(t('tradAuto.applyDryResult', { matched: data.matched, total: data.total }));
      } else {
        setApplyMsg(t('tradAuto.applyResult', { matched: data.matched, total: data.total, saved: data.saved }));
        qc.invalidateQueries({ queryKey: ['strings'] });
      }
    },
  });

  /** Enter inline-edit mode for a specific rule row. */
  const startEdit = (rule: TradAutoRule) => {
    setEditId(rule.id);
    setEditData({
      game: rule.game,
      priority: rule.priority,
      pattern: rule.pattern,
      replacement: rule.replacement,
      signature: rule.signature ?? '',
      path: rule.path ?? '',
      src_lang: rule.src_lang,
      tgt_lang: rule.tgt_lang,
      description: rule.description ?? '',
      is_active: rule.is_active,
    });
  };

  /** Commit inline-edit changes. */
  const saveEdit = () => {
    if (editId == null) return;
    updateMut.mutate({
      id: editId,
      data: {
        game: editData.game,
        priority: editData.priority,
        pattern: editData.pattern,
        replacement: editData.replacement,
        signature: editData.signature || null,
        path: editData.path || null,
        src_lang: editData.src_lang,
        tgt_lang: editData.tgt_lang,
        description: editData.description || null,
        is_active: editData.is_active,
      },
    });
  };

  /** Run test — split textarea into lines, send to the backend. */
  const runTest = () => {
    const lines = testText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    testMut.mutate(lines);
  };

  /** Whether the add-form has enough data to submit. */
  const canAdd = !!form.pattern.trim() && !!form.replacement.trim();

  // ── Render ───────────────────────────────────────────────────────────────
  const testLines = testText.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('tradAuto.title')}</h1>
      <p className={s.description}>{t('tradAuto.description')}</p>

      {/* ── Add-rule form ────────────────────────────────────────────────── */}
      <div className={s.addForm}>
        <input
          className={s.inputNarrow}
          type="number"
          placeholder={t('tradAuto.priorityPlaceholder')}
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
        />
        <input
          className={s.input}
          placeholder={t('tradAuto.patternPlaceholder')}
          value={form.pattern}
          onChange={(e) => setForm({ ...form, pattern: e.target.value })}
        />
        <input
          className={s.input}
          placeholder={t('tradAuto.replacementPlaceholder')}
          value={form.replacement}
          onChange={(e) => setForm({ ...form, replacement: e.target.value })}
        />
        <input
          className={s.input}
          placeholder={t('tradAuto.signaturePlaceholder')}
          value={form.signature}
          onChange={(e) => setForm({ ...form, signature: e.target.value })}
        />
        <input
          className={s.input}
          placeholder={t('tradAuto.pathPlaceholder')}
          value={form.path}
          onChange={(e) => setForm({ ...form, path: e.target.value })}
        />
        <input
          className={s.inputWide}
          placeholder={t('tradAuto.descriptionPlaceholder')}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && canAdd && addMut.mutate()}
        />
        <button className={s.btnAdd} disabled={!canAdd || addMut.isPending} onClick={() => addMut.mutate()}>
          {t('tradAuto.add')}
        </button>
        {addMut.isError && <span className={s.mutError}>{addMut.error?.message}</span>}
      </div>

      {/* ── Rules table ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className={s.center}>{t('common.loading')}</div>
      ) : !rules?.length ? (
        <div className={s.center}>
          <p>{t('tradAuto.noRules')}</p>
          <p className={s.emptyHint}>{t('tradAuto.emptyHint')}</p>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>{t('tradAuto.priority')}</th>
              <th className={s.th}>{t('tradAuto.pattern')}</th>
              <th className={s.th}>{t('tradAuto.replacement')}</th>
              <th className={s.th}>{t('tradAuto.signature')}</th>
              <th className={s.th}>{t('tradAuto.path')}</th>
              <th className={s.th}>{t('tradAuto.descriptionCol')}</th>
              <th className={s.th}>{t('tradAuto.active')}</th>
              <th className={s.th}>{t('tradAuto.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) =>
              editId === rule.id ? (
                /* ── Inline edit row ─────────────────────────────────────── */
                <tr key={rule.id}>
                  <td className={s.td}>
                    <input
                      className={s.editInput}
                      type="number"
                      value={editData.priority}
                      onChange={(e) => setEditData({ ...editData, priority: Number(e.target.value) })}
                    />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.pattern} onChange={(e) => setEditData({ ...editData, pattern: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.replacement} onChange={(e) => setEditData({ ...editData, replacement: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.signature} onChange={(e) => setEditData({ ...editData, signature: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.path} onChange={(e) => setEditData({ ...editData, path: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.description} onChange={(e) => setEditData({ ...editData, description: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} />
                  </td>
                  <td className={s.td}>
                    <div className={s.editActions}>
                      <button className={s.btnSave} onClick={saveEdit} disabled={updateMut.isPending}>{t('tradAuto.save')}</button>
                      <button className={s.btnCancel} onClick={() => setEditId(null)}>{t('tradAuto.cancel')}</button>
                    </div>
                  </td>
                </tr>
              ) : (
                /* ── Display row ─────────────────────────────────────────── */
                <tr key={rule.id}>
                  <td className={s.td}>{rule.priority}</td>
                  <td className={s.tdMono}>{rule.pattern}</td>
                  <td className={s.tdMono}>{rule.replacement}</td>
                  <td className={rule.signature ? s.tdMono : s.tdAny}>
                    {rule.signature ?? t('tradAuto.anyGrup')}
                  </td>
                  <td className={rule.path ? s.tdMono : s.tdAny}>
                    {rule.path ?? t('tradAuto.anyField')}
                  </td>
                  <td className={s.td}>{rule.description ?? '—'}</td>
                  <td className={s.td}>
                    <span className={rule.is_active ? s.activeOn : s.activeOff}>
                      {rule.is_active ? '✓' : '✗'}
                    </span>
                  </td>
                  <td className={s.td}>
                    <button className={s.btnSmall} onClick={() => startEdit(rule)}>{t('tradAuto.edit')}</button>
                    <button
                      className={s.btnDelete}
                      disabled={removeMut.isPending}
                      onClick={() => {
                        if (window.confirm(t('tradAuto.confirmDelete'))) removeMut.mutate(rule.id);
                      }}
                    >
                      {t('tradAuto.delete')}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {/* ── Test & Apply panels ──────────────────────────────────────────── */}
      <div className={s.panels}>
        {/* ── Test panel ─────────────────────────────────────────────────── */}
        <div className={s.panel}>
          <h3 className={s.panelTitle}>{t('tradAuto.testTitle')}</h3>
          <p className={s.panelDesc}>{t('tradAuto.testDescription')}</p>
          <textarea
            className={s.textarea}
            placeholder={t('tradAuto.testPlaceholder')}
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
          />
          <button
            className={s.btnPrimary}
            disabled={!testText.trim() || testMut.isPending}
            onClick={runTest}
          >
            {t('tradAuto.runTest')}
          </button>
          {testMut.isError && <span className={s.mutError}>{testMut.error?.message}</span>}
          {testResults && (
            <div className={s.testResults}>
              {testLines.map((line, i) => (
                <div key={i} className={s.testLine}>
                  <span className={s.testInput}>{line}</span>
                  {testResults[i] ? (
                    <span className={s.testOutput}>
                      → {testResults[i]!.translated}{' '}
                      <small>({t('tradAuto.testMatch', { ruleId: testResults[i]!.ruleId })})</small>
                    </span>
                  ) : (
                    <span className={s.testNoMatch}>{t('tradAuto.testNoMatch')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Apply panel ────────────────────────────────────────────────── */}
        <div className={s.panel}>
          <h3 className={s.panelTitle}>{t('tradAuto.applyTitle')}</h3>
          <p className={s.panelDesc}>{t('tradAuto.applyDescription')}</p>
          <div className={s.applyRow}>
            <select
              className={s.select}
              value={applyModId}
              onChange={(e) => { setApplyModId(e.target.value); setApplyMsg(''); }}
            >
              <option value="">{t('tradAuto.modId')}…</option>
              {mods?.map((m: Mod) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <label className={s.checkLabel}>
              <input
                type="checkbox"
                className={s.checkbox}
                checked={applyDry}
                onChange={(e) => setApplyDry(e.target.checked)}
              />
              {t('tradAuto.dryRun')}
            </label>
            <button
              className={s.btnPrimary}
              disabled={!applyModId || applyMut.isPending}
              onClick={() => applyMut.mutate()}
            >
              {t('tradAuto.apply')}
            </button>
          </div>
          {applyMut.isError && <span className={s.mutError}>{applyMut.error?.message}</span>}
          {applyMsg && <div className={s.applyMsg}>{applyMsg}</div>}
        </div>
      </div>
    </div>
  );
};
