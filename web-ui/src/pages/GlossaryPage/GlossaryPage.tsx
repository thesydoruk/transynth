import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { GlossaryEnforcePanel } from './components/GlossaryEnforcePanel';
import { GlossaryTable } from './components/GlossaryTable';
import { GlossaryToolbar } from './components/GlossaryToolbar';
import { useGlossaryPage } from './useGlossaryPage';
import s from './GlossaryPage.module.scss';

export const GlossaryPage = () => {
  const { t } = useTranslation();
  const {
    srcLang,
    setSrcLang,
    tgtLang,
    setTgtLang,
    q,
    setQ,
    newTerm,
    setNewTerm,
    newTranslation,
    setNewTranslation,
    editId,
    editTerm,
    setEditTerm,
    editTranslation,
    setEditTranslation,
    enforceModId,
    setEnforceModId,
    newTermRef,
    mods,
    data,
    isLoading,
    enforce,
    add,
    remove,
    update,
    startEdit,
    cancelEdit,
    saveEdit,
  } = useGlossaryPage();

  const emptyHint = t('glossary.emptyTranslatorHint');

  return (
    <div className={s.page}>
      <PageHeader title={t('glossary.title')} description={t('glossary.description')} />

      <GlossaryToolbar
        srcLang={srcLang}
        tgtLang={tgtLang}
        q={q}
        newTerm={newTerm}
        newTranslation={newTranslation}
        newTermRef={newTermRef}
        addPending={add.isPending}
        addError={add.isError ? add.error?.message : undefined}
        onSrcLangChange={setSrcLang}
        onTgtLangChange={setTgtLang}
        onQueryChange={setQ}
        onNewTermChange={setNewTerm}
        onNewTranslationChange={setNewTranslation}
        onAdd={() => add.mutate()}
      />

      <GlossaryEnforcePanel
        mods={mods}
        enforceModId={enforceModId}
        onModChange={setEnforceModId}
        onEnforce={() => enforce.mutate()}
        enforcePending={enforce.isPending}
        enforceSuccess={enforce.isSuccess}
        checked={enforce.data?.checked}
        violations={enforce.data?.violations}
        enforceError={enforce.isError ? enforce.error?.message : undefined}
      />

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
        <GlossaryTable
          entries={data}
          editId={editId}
          editTerm={editTerm}
          editTranslation={editTranslation}
          updatePending={update.isPending}
          removePending={remove.isPending}
          onEditTermChange={setEditTerm}
          onEditTranslationChange={setEditTranslation}
          onStartEdit={startEdit}
          onSaveEdit={saveEdit}
          onCancelEdit={cancelEdit}
          onRemove={(id) => remove.mutate(id)}
        />
      )}
      {update.isError && (
        <div className={s.addError}>{t('common.error', { message: String(update.error) })}</div>
      )}
    </div>
  );
};
