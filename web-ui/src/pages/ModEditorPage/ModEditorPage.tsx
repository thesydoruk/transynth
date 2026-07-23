import {
  toggleModAiTranslate,
  startModAiTranslateTm,
  stopModAiTranslate,
} from '../../modAiTranslateRunner';
import { toggleModAiVoice, stopModAiVoice } from '../../modAiVoiceRunner';
import { startModAiSkipDetect, stopModAiSkipDetect } from '../../modAiSkipDetectRunner';
import { EditorToolbar } from './components/EditorToolbar';
import { DialogsMode } from './components/DialogsMode';
import { ModEditorStringsBody } from './components/ModEditorStringsBody';
import { ModEditorModals } from './components/ModEditorModals';
import { ContextMenu } from './components/ContextMenu';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { EditorStatusBar } from './components/EditorStatusBar';
import { useModEditorPage } from './hooks/useModEditorPage';
import styles from './ModEditorPage.module.scss';

/**
 * Top-level page component for the mod-editor view.
 * State and handlers live in {@link useModEditorPage}; layout is delegated to sub-components.
 */
export const ModEditorPage = () => {
  const {
    modId,
    gameId,
    modals,
    filter,
    editorQueries,
    selection,
    row,
    saveMutation,
    clearSameAsSourceMut,
    saveIndicator,
    aiVerify,
    aiJobs,
    applyImported,
    batchTranslate,
    contextMenu,
    qaIssueRowCount,
  } = useModEditorPage();

  const { mod, strings, stats, sigs, suggestions, qaIssues, history, isLoading } = editorQueries;
  const total = strings?.total ?? 0;

  return (
    <div className={styles.root}>
      <EditorToolbar
        modName={mod?.name}
        srcLang={filter.srcLang}
        targetLang={filter.targetLang}
        availLangs={editorQueries.availLangs}
        selectedStatuses={filter.selectedStatuses}
        qaOnly={filter.qaOnly}
        stats={stats}
        selectedCount={selection.selectedCount}
        translateProgress={batchTranslate.translateProgress}
        clearSameAsSource={{
          isPending: clearSameAsSourceMut.isPending,
          isSuccess: clearSameAsSourceMut.isSuccess,
          cleared: clearSameAsSourceMut.data?.cleared ?? 0,
        }}
        gameId={gameId}
        modId={modId}
        hasInnrSignature={!!sigs?.some((s) => s.signature === 'INNR')}
        qaIssueRowCount={qaIssueRowCount}
        aiJobs={aiJobs}
        onSrcLangChange={(l) => {
          filter.setSrcLang(l);
          selection.clearSelection();
        }}
        onTargetLangChange={(l) => {
          filter.setTargetLang(l);
          selection.clearSelection();
        }}
        onSelectedStatusesChange={(next) => {
          filter.setSelectedStatuses(next);
          selection.clearSelection();
        }}
        onQaOnlyToggle={() => {
          filter.setQaOnly((v) => !v);
          selection.clearSelection();
        }}
        onClearSameAsSource={() => clearSameAsSourceMut.mutate()}
        onSearchReplace={() => modals.setShowSearchReplace(true)}
        onApplyTranslationFromMod={() => modals.setShowApplyTranslationFromMod(true)}
        applyImportedRunning={applyImported.isRunning}
        onVoice={() => modals.setShowVoice(true)}
        onShortcuts={() => modals.setShowShortcuts((v) => !v)}
        onBatchTranslate={batchTranslate.handleBatchTranslate}
        onNextQaIssue={() => row.handleNextQaIssue(strings?.rows ?? [])}
        pageMode={filter.pageMode}
        onPageModeChange={filter.setPageMode}
        onTranslateTm={() => startModAiTranslateTm(modId, filter.srcLang, filter.targetLang)}
        onTranslateLlm={() =>
          toggleModAiTranslate(modId, filter.srcLang, filter.targetLang, aiJobs.translate)
        }
        onTranslateStop={() => void stopModAiTranslate(modId, aiJobs.translate)}
        onAiVerify={() => modals.setShowAiVerify(true)}
        onSkipDetectHeuristic={() =>
          void startModAiSkipDetect(modId, filter.srcLang, false, aiJobs.skipDetect)
        }
        onSkipDetectWithLlm={() =>
          void startModAiSkipDetect(modId, filter.srcLang, true, aiJobs.skipDetect)
        }
        onSkipDetectStop={() => void stopModAiSkipDetect(modId, aiJobs.skipDetect.jobId)}
        onAiVoiceMissing={() =>
          toggleModAiVoice(modId, filter.srcLang, filter.targetLang, aiJobs.voice, 'missing')
        }
        onAiVoiceAll={() =>
          toggleModAiVoice(modId, filter.srcLang, filter.targetLang, aiJobs.voice, 'all')
        }
        onAiVoiceStop={() => void stopModAiVoice(modId, aiJobs.voice.jobId)}
      />

      {filter.pageMode === 'dialogs' ? (
        <DialogsMode modId={modId} srcLang={filter.srcLang} targetLang={filter.targetLang} />
      ) : (
        <ModEditorStringsBody
          modId={modId}
          sigCounts={editorQueries.sigCounts}
          signature={filter.signature}
          onSignatureChange={(sig) => {
            filter.setSignature(sig);
            selection.clearSelection();
          }}
          stringsTotal={strings?.total}
          selectedStatusesLength={filter.selectedStatuses.length}
          statsTotal={stats?.total}
          centerColRef={row.centerColRef}
          rows={strings?.rows ?? []}
          total={total}
          isLoading={isLoading}
          isRowSelected={selection.isRowSelected}
          allSelected={selection.allSelected}
          someSelected={selection.someSelected}
          hasNextPage={!!editorQueries.hasNextPage}
          isFetchingNextPage={editorQueries.isFetchingNextPage}
          onLoadMore={() => editorQueries.fetchNextPage()}
          activeRow={row.activeRow}
          focusedRow={row.focusedRow}
          srcLang={filter.srcLang}
          targetLang={filter.targetLang}
          sortCol={filter.sortCol}
          sortDir={filter.sortDir}
          columnFilters={filter.columnFilters}
          detailPanelHeight={row.detailPanelHeight}
          isResizing={row.isResizing}
          startDetailPanelResize={row.startDetailPanelResize}
          draftTranslation={row.draftTranslation}
          activeTab={row.activeTab}
          saveIndicator={saveIndicator}
          savePending={saveMutation.isPending}
          activeMaxLength={editorQueries.activeMaxLength}
          suggestions={suggestions ?? []}
          qaIssues={qaIssues ?? []}
          history={history ?? []}
          translAreaRef={row.translAreaRef}
          onRowSelect={row.handleRowSelect}
          onRowOpen={row.handleRowOpen}
          onToggleRow={selection.toggleRow}
          onToggleAll={selection.toggleAll}
          onSort={filter.handleSort}
          onColumnFilterChange={filter.handleColumnFilterChange}
          onContextMenu={contextMenu.handleContextMenu}
          onClear={row.handleClear}
          onDraftChange={row.setDraftTranslation}
          onSave={row.handleSave}
          onCopySource={row.handleCopySource}
          onTabChange={row.setActiveTab}
          onOpenBookEditor={() => modals.setShowBookEditor(true)}
        />
      )}

      <ModEditorModals
        modId={modId}
        gameId={gameId}
        srcLang={filter.srcLang}
        targetLang={filter.targetLang}
        activeRow={row.activeRow}
        draftTranslation={row.draftTranslation}
        stringsRows={strings?.rows}
        refetchStats={editorQueries.refetchStats}
        aiVerify={aiVerify}
        applyImported={applyImported}
        showSearchReplace={modals.showSearchReplace}
        showApplyTranslationFromMod={modals.showApplyTranslationFromMod}
        showAiVerify={modals.showAiVerify}
        showVoice={modals.showVoice}
        showBookEditor={modals.showBookEditor}
        onCloseSearchReplace={() => modals.setShowSearchReplace(false)}
        onCloseApplyTranslationFromMod={() => modals.setShowApplyTranslationFromMod(false)}
        onCloseAiVerify={() => modals.setShowAiVerify(false)}
        onCloseVoice={() => modals.setShowVoice(false)}
        onCloseBookEditor={() => modals.setShowBookEditor(false)}
        onDraftChange={row.setDraftTranslation}
        onRowOpen={row.handleRowOpen}
      />

      {modals.showShortcuts && <ShortcutsOverlay onClose={() => modals.setShowShortcuts(false)} />}

      {contextMenu.ctxMenu && (
        <ContextMenu
          anchor={contextMenu.ctxMenu}
          targetCount={contextMenu.ctxTargetCount}
          multiTarget={contextMenu.ctxMultiTarget}
          onClose={() => contextMenu.setCtxMenu(null)}
          onClear={contextMenu.ctxClear}
          onCopySource={contextMenu.ctxCopySource}
          onTextTransform={contextMenu.applyTextTransform}
          onBatchTranslate={batchTranslate.handleBatchTranslate}
          onBatchApplyTm={batchTranslate.handleBatchApplyTm}
          onRowTranslate={batchTranslate.handleRowTranslate}
          onSetSkip={contextMenu.ctxSetSkip}
          onSetStatus={contextMenu.ctxSetStatus}
        />
      )}

      <EditorStatusBar
        selectedCount={selection.selectedCount}
        activeRow={row.focusedRow ?? row.activeRow}
        stats={stats}
      />
    </div>
  );
};
