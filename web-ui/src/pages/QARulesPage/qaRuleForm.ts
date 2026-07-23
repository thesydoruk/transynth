import type { QARule } from '../../api';

export type QARuleFormData = {
  game: string;
  rule_type: '' | 'forbidden_chars' | 'max_length';
  signature: string;
  path: string;
  value: string;
  severity: 'warning' | 'error';
  description: string;
  is_active: boolean;
};

export const EMPTY_QA_RULE_FORM: QARuleFormData = {
  game: 'fo4',
  rule_type: '',
  signature: '',
  path: '',
  value: '',
  severity: 'error',
  description: '',
  is_active: true,
};

export const qaRuleToFormData = (rule: QARule): QARuleFormData => ({
  game: rule.game,
  rule_type: rule.rule_type,
  signature: rule.signature ?? '',
  path: rule.path ?? '',
  value: rule.value,
  severity: rule.severity,
  description: rule.description ?? '',
  is_active: rule.is_active,
});

export const formDataToCreatePayload = (form: QARuleFormData) => ({
  game: form.game,
  rule_type: form.rule_type as 'forbidden_chars' | 'max_length',
  signature: form.signature || null,
  path: form.path || null,
  value: form.value,
  severity: form.severity,
  description: form.description || null,
  is_active: form.is_active,
});
