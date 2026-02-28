import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type QARule } from '../../api';
import s from './QARulesPage.module.scss';

/** Default values for the "add rule" form. */
const EMPTY_FORM = {
  game: 'fo4',
  rule_type: '' as '' | 'forbidden_chars' | 'max_length',
  signature: '',
  path: '',
  value: '',
  severity: 'error' as 'warning' | 'error',
  description: '',
  is_active: true,
};

/**
 * QA Rules management page.
 *
 * Lists all configurable QA rules in a table and allows the user to add,
 * inline-edit, toggle active state, and delete rules. Each rule can be scoped
 * to a specific record GRUP (signature) and/or field (path).
 */
export const QARulesPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Add-rule form state ──────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // ── Inline edit state (null = not editing) ───────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState({ ...EMPTY_FORM });

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: rules, isLoading } = useQuery({
    queryKey: ['qaRules'],
    queryFn: () => api.qaRules.list(),
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: () =>
      api.qaRules.create({
        game: form.game,
        rule_type: form.rule_type as 'forbidden_chars' | 'max_length',
        signature: form.signature || null,
        path: form.path || null,
        value: form.value,
        severity: form.severity,
        description: form.description || null,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qaRules'] });
      setForm({ ...EMPTY_FORM });
    },
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: number; data: Partial<Omit<QARule, 'id' | 'created_at' | 'updated_at'>> }) =>
      api.qaRules.update(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qaRules'] });
      setEditId(null);
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => api.qaRules.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qaRules'] }),
  });

  /** Enter inline-edit mode for a specific rule row. */
  const startEdit = (rule: QARule) => {
    setEditId(rule.id);
    setEditData({
      game: rule.game,
      rule_type: rule.rule_type,
      signature: rule.signature ?? '',
      path: rule.path ?? '',
      value: rule.value,
      severity: rule.severity,
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
        rule_type: editData.rule_type as 'forbidden_chars' | 'max_length',
        signature: editData.signature || null,
        path: editData.path || null,
        value: editData.value,
        severity: editData.severity,
        description: editData.description || null,
        is_active: editData.is_active,
      },
    });
  };

  /** Whether the add-form has enough data to submit. */
  const canAdd = !!form.rule_type && !!form.value.trim();

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('qaRules.title')}</h1>
      <p className={s.description}>{t('qaRules.description')}</p>

      {/* ── Add-rule form ────────────────────────────────────────────────── */}
      <div className={s.addForm}>
        <select
          className={s.select}
          value={form.rule_type}
          onChange={(e) => setForm({ ...form, rule_type: e.target.value as typeof form.rule_type })}
        >
          <option value="">{t('qaRules.ruleTypePlaceholder')}</option>
          <option value="forbidden_chars">{t('qaRules.forbidden_chars')}</option>
          <option value="max_length">{t('qaRules.max_length')}</option>
        </select>

        <input
          className={s.input}
          placeholder={t('qaRules.signaturePlaceholder')}
          value={form.signature}
          onChange={(e) => setForm({ ...form, signature: e.target.value })}
        />
        <input
          className={s.input}
          placeholder={t('qaRules.pathPlaceholder')}
          value={form.path}
          onChange={(e) => setForm({ ...form, path: e.target.value })}
        />
        <input
          className={s.input}
          placeholder={
            form.rule_type === 'max_length'
              ? t('qaRules.valueLengthPlaceholder')
              : t('qaRules.valueForbiddenPlaceholder')
          }
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
        />
        <select
          className={s.select}
          value={form.severity}
          onChange={(e) => setForm({ ...form, severity: e.target.value as 'warning' | 'error' })}
        >
          <option value="error">{t('qaRules.error')}</option>
          <option value="warning">{t('qaRules.warning')}</option>
        </select>
        <input
          className={s.inputWide}
          placeholder={t('qaRules.descriptionPlaceholder')}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && canAdd && addMut.mutate()}
        />
        <button className={s.btnAdd} disabled={!canAdd || addMut.isPending} onClick={() => addMut.mutate()}>
          {t('qaRules.add')}
        </button>
        {addMut.isError && <span className={s.mutError}>{addMut.error?.message}</span>}
      </div>

      {/* ── Rules table ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className={s.center}>{t('common.loading')}</div>
      ) : !rules?.length ? (
        <div className={s.center}>
          <p>{t('qaRules.noRules')}</p>
          <p className={s.emptyHint}>{t('qaRules.emptyHint')}</p>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>{t('qaRules.ruleType')}</th>
              <th className={s.th}>{t('qaRules.signature')}</th>
              <th className={s.th}>{t('qaRules.path')}</th>
              <th className={s.th}>{t('qaRules.value')}</th>
              <th className={s.th}>{t('qaRules.severity')}</th>
              <th className={s.th}>{t('qaRules.descriptionCol')}</th>
              <th className={s.th}>{t('qaRules.active')}</th>
              <th className={s.th}>{t('qaRules.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) =>
              editId === rule.id ? (
                /* ── Inline edit row ─────────────────────────────────────── */
                <tr key={rule.id}>
                  <td className={s.td}>
                    <select
                      className={s.editSelect}
                      value={editData.rule_type}
                      onChange={(e) => setEditData({ ...editData, rule_type: e.target.value as typeof editData.rule_type })}
                    >
                      <option value="forbidden_chars">{t('qaRules.forbidden_chars')}</option>
                      <option value="max_length">{t('qaRules.max_length')}</option>
                    </select>
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.signature} onChange={(e) => setEditData({ ...editData, signature: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.path} onChange={(e) => setEditData({ ...editData, path: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.value} onChange={(e) => setEditData({ ...editData, value: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <select className={s.editSelect} value={editData.severity} onChange={(e) => setEditData({ ...editData, severity: e.target.value as 'warning' | 'error' })}>
                      <option value="error">{t('qaRules.error')}</option>
                      <option value="warning">{t('qaRules.warning')}</option>
                    </select>
                  </td>
                  <td className={s.td}>
                    <input className={s.editInput} value={editData.description} onChange={(e) => setEditData({ ...editData, description: e.target.value })} />
                  </td>
                  <td className={s.td}>
                    <input type="checkbox" checked={editData.is_active} onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })} />
                  </td>
                  <td className={s.td}>
                    <div className={s.editActions}>
                      <button className={s.btnSave} onClick={saveEdit} disabled={updateMut.isPending}>{t('qaRules.save')}</button>
                      <button className={s.btnCancel} onClick={() => setEditId(null)}>{t('qaRules.cancel')}</button>
                    </div>
                  </td>
                </tr>
              ) : (
                /* ── Display row ─────────────────────────────────────────── */
                <tr key={rule.id}>
                  <td className={s.td}>{t(`qaRules.${rule.rule_type}`)}</td>
                  <td className={rule.signature ? s.tdMono : s.tdAny}>
                    {rule.signature ?? t('qaRules.anyGrup')}
                  </td>
                  <td className={rule.path ? s.tdMono : s.tdAny}>
                    {rule.path ?? t('qaRules.anyField')}
                  </td>
                  <td className={s.tdMono}>{rule.value}</td>
                  <td className={s.td}>
                    <span className={rule.severity === 'error' ? s.severityError : s.severityWarning}>
                      {t(`qaRules.${rule.severity}`)}
                    </span>
                  </td>
                  <td className={s.td}>{rule.description ?? '—'}</td>
                  <td className={s.td}>
                    <span className={rule.is_active ? s.activeOn : s.activeOff}>
                      {rule.is_active ? '✓' : '✗'}
                    </span>
                  </td>
                  <td className={s.td}>
                    <button className={s.btnSmall} onClick={() => startEdit(rule)}>{t('qaRules.edit')}</button>
                    <button
                      className={s.btnDelete}
                      disabled={removeMut.isPending}
                      onClick={() => {
                        if (window.confirm(t('qaRules.confirmDelete'))) removeMut.mutate(rule.id);
                      }}
                    >
                      {t('qaRules.delete')}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

