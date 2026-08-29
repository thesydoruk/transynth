import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { QARule } from '../../../api';
import { OverflowMenu } from '../../../components/OverflowMenu';
import type { QARuleFormData } from '../qaRuleForm';
import s from '../QARulesPage.module.scss';

type QARulesTableProps = {
  rules: QARule[];
  editId: number | null;
  editData: QARuleFormData;
  onEditDataChange: (data: QARuleFormData) => void;
  onStartEdit: (rule: QARule) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
  updateMut: UseMutationResult<unknown, Error, { id: number; data: Partial<QARule> }, unknown>;
  removeMut: UseMutationResult<unknown, Error, number, unknown>;
};

export const QARulesTable = ({
  rules,
  editId,
  editData,
  onEditDataChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  updateMut,
  removeMut,
}: QARulesTableProps) => {
  const { t } = useTranslation();

  return (
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
            <tr key={rule.id}>
              <td className={s.td}>
                <select
                  className={s.editSelect}
                  value={editData.rule_type}
                  onChange={(e) =>
                    onEditDataChange({
                      ...editData,
                      rule_type: e.target.value as typeof editData.rule_type,
                    })
                  }
                >
                  <option value="forbidden_chars">{t('qaRules.forbidden_chars')}</option>
                  <option value="max_length">{t('qaRules.max_length')}</option>
                </select>
              </td>
              <td className={s.td}>
                <input
                  className={s.editInput}
                  value={editData.signature}
                  onChange={(e) => onEditDataChange({ ...editData, signature: e.target.value })}
                />
              </td>
              <td className={s.td}>
                <input
                  className={s.editInput}
                  value={editData.path}
                  onChange={(e) => onEditDataChange({ ...editData, path: e.target.value })}
                />
              </td>
              <td className={s.td}>
                <input
                  className={s.editInput}
                  value={editData.value}
                  onChange={(e) => onEditDataChange({ ...editData, value: e.target.value })}
                />
              </td>
              <td className={s.td}>
                <select
                  className={s.editSelect}
                  value={editData.severity}
                  onChange={(e) =>
                    onEditDataChange({
                      ...editData,
                      severity: e.target.value as 'warning' | 'error',
                    })
                  }
                >
                  <option value="error">{t('qaRules.error')}</option>
                  <option value="warning">{t('qaRules.warning')}</option>
                </select>
              </td>
              <td className={s.td}>
                <input
                  className={s.editInput}
                  value={editData.description}
                  onChange={(e) => onEditDataChange({ ...editData, description: e.target.value })}
                />
              </td>
              <td className={s.td}>
                <input
                  type="checkbox"
                  checked={editData.is_active}
                  onChange={(e) => onEditDataChange({ ...editData, is_active: e.target.checked })}
                />
              </td>
              <td className={s.td}>
                <div className={s.editActions}>
                  <button className={s.btnSave} onClick={onSaveEdit} disabled={updateMut.isPending}>
                    {t('qaRules.save')}
                  </button>
                  <button className={s.btnCancel} onClick={onCancelEdit}>
                    {t('qaRules.cancel')}
                  </button>
                </div>
              </td>
            </tr>
          ) : (
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
                <button className={s.btnSmall} onClick={() => onStartEdit(rule)}>
                  {t('qaRules.edit')}
                </button>
                <OverflowMenu
                  items={[
                    {
                      label: t('qaRules.delete'),
                      onClick: () => onDelete(rule.id),
                      danger: true,
                      disabled: removeMut.isPending,
                    },
                  ]}
                />
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
};
