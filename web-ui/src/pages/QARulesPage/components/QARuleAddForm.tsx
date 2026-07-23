import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { QARuleFormData } from '../qaRuleForm';
import s from '../QARulesPage.module.scss';

type QARuleAddFormProps = {
  form: QARuleFormData;
  onChange: (form: QARuleFormData) => void;
  canAdd: boolean;
  addMut: UseMutationResult<unknown, Error, void, unknown>;
};

export const QARuleAddForm = ({ form, onChange, canAdd, addMut }: QARuleAddFormProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.addForm}>
      <select
        className={s.select}
        value={form.rule_type}
        onChange={(e) => onChange({ ...form, rule_type: e.target.value as typeof form.rule_type })}
      >
        <option value="">{t('qaRules.ruleTypePlaceholder')}</option>
        <option value="forbidden_chars">{t('qaRules.forbidden_chars')}</option>
        <option value="max_length">{t('qaRules.max_length')}</option>
      </select>

      <input
        className={s.input}
        placeholder={t('qaRules.signaturePlaceholder')}
        value={form.signature}
        onChange={(e) => onChange({ ...form, signature: e.target.value })}
      />
      <input
        className={s.input}
        placeholder={t('qaRules.pathPlaceholder')}
        value={form.path}
        onChange={(e) => onChange({ ...form, path: e.target.value })}
      />
      <input
        className={s.input}
        placeholder={
          form.rule_type === 'max_length'
            ? t('qaRules.valueLengthPlaceholder')
            : t('qaRules.valueForbiddenPlaceholder')
        }
        value={form.value}
        onChange={(e) => onChange({ ...form, value: e.target.value })}
      />
      <select
        className={s.select}
        value={form.severity}
        onChange={(e) => onChange({ ...form, severity: e.target.value as 'warning' | 'error' })}
      >
        <option value="error">{t('qaRules.error')}</option>
        <option value="warning">{t('qaRules.warning')}</option>
      </select>
      <input
        className={s.inputWide}
        placeholder={t('qaRules.descriptionPlaceholder')}
        value={form.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && canAdd && addMut.mutate()}
      />
      <button
        className={s.btnAdd}
        disabled={!canAdd || addMut.isPending}
        onClick={() => addMut.mutate()}
      >
        {t('qaRules.add')}
      </button>
      {addMut.isError && <span className={s.mutError}>{addMut.error?.message}</span>}
    </div>
  );
};
