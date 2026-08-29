import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../../components/ConfirmModal';
import { QARuleAddForm } from './components/QARuleAddForm';
import { QARulesTable } from './components/QARulesTable';
import { useQARulesPage } from './useQARulesPage';
import s from './QARulesPage.module.scss';

/** QA Rules management page. */
export const QARulesPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation();
  const {
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
    cancelEdit,
    canAdd,
  } = useQARulesPage();

  return (
    <>
      <div className={`${s.page} ${embedded ? s.pageEmbedded : ''}`}>
        <h1 className={s.title}>{t('qaRules.title')}</h1>
        <p className={s.description}>{t('qaRules.description')}</p>

        <QARuleAddForm form={form} onChange={setForm} canAdd={canAdd} addMut={addMut} />

        {isLoading ? (
          <div className={s.center}>{t('common.loading')}</div>
        ) : !rules?.length ? (
          <div className={s.center}>
            <p>{t('qaRules.noRules')}</p>
            <p className={s.emptyHint}>{t('qaRules.emptyHint')}</p>
          </div>
        ) : (
          <QARulesTable
            rules={rules}
            editId={editId}
            editData={editData}
            onEditDataChange={setEditData}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onDelete={setPendingDeleteId}
            updateMut={updateMut}
            removeMut={removeMut}
          />
        )}
      </div>

      {pendingDeleteId != null && (
        <ConfirmModal
          title={t('qaRules.deleteTitle')}
          message={t('qaRules.deleteMessage')}
          confirmLabel={t('qaRules.delete')}
          pending={removeMut.isPending}
          onConfirm={() => {
            removeMut.mutate(pendingDeleteId!);
            setPendingDeleteId(null);
          }}
          onClose={() => setPendingDeleteId(null)}
        />
      )}
    </>
  );
};
