import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type QARule } from '../../api';
import { useToast } from '../../components/Toast';
import {
  EMPTY_QA_RULE_FORM,
  formDataToCreatePayload,
  qaRuleToFormData,
  type QARuleFormData,
} from './qaRuleForm';

export const useQARulesPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const [form, setForm] = useState<QARuleFormData>({ ...EMPTY_QA_RULE_FORM });
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<QARuleFormData>({ ...EMPTY_QA_RULE_FORM });
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['qaRules'],
    queryFn: () => api.qaRules.list(),
  });

  const addMut = useMutation({
    mutationFn: () => api.qaRules.create(formDataToCreatePayload(form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qaRules'] });
      setForm({ ...EMPTY_QA_RULE_FORM });
    },
  });

  const updateMut = useMutation({
    mutationFn: (args: {
      id: number;
      data: Partial<Omit<QARule, 'id' | 'created_at' | 'updated_at'>>;
    }) => api.qaRules.update(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qaRules'] });
      setEditId(null);
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => api.qaRules.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qaRules'] });
      showToast(t('qaRules.deleteSuccess'), 'success');
    },
  });

  const startEdit = (rule: QARule) => {
    setEditId(rule.id);
    setEditData(qaRuleToFormData(rule));
  };

  const saveEdit = () => {
    if (editId == null) return;
    updateMut.mutate({
      id: editId,
      data: formDataToCreatePayload(editData),
    });
  };

  const canAdd = !!form.rule_type && !!form.value.trim();

  return {
    form,
    setForm,
    editId,
    editData,
    setEditData,
    pendingDeleteId,
    setPendingDeleteId,
    rules,
    isLoading,
    addMut,
    updateMut,
    removeMut,
    startEdit,
    saveEdit,
    cancelEdit: () => setEditId(null),
    canAdd,
  };
};
