import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import type { StringRow, RagSuggestion, QAIssue, TranslationHistoryEntry } from '../../../api';
import { editorCapabilities, type EditorCapabilities } from '../editorCapabilities';
import { SignaturePanel, type SigCount } from './SignaturePanel';
import { StringGrid, type SortCol, type SortDir, type ColumnFilters } from './StringGrid';
import { DetailPanel, type BottomTab } from './DetailPanel';
import styles from '../ModEditorPage.module.scss';

export interface ModEditorStringsBodyProps {
  modId: number;
  sigCounts: SigCount[];
  signature: string;
  onSignatureChange: (sig: string) => void;
  stringsTotal: number | undefined;
  selectedStatusesLength: number;
  statsTotal: number | undefined;
  centerColRef: RefObject<HTMLDivElement | null>;
  rows: StringRow[];
  total: number;
  isLoading: boolean;
  isRowSelected: (id: number) => boolean;
  allSelected: boolean;
  someSelected: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  activeRow: StringRow | null;
  focusedRow: StringRow | null;
  srcLang: string;
  targetLang: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  columnFilters: ColumnFilters;
  detailPanelHeight: number;
  isResizing: boolean;
  startDetailPanelResize: (e: React.MouseEvent) => void;
  draftTranslation: string;
  activeTab: BottomTab;
  saveIndicator: 'idle' | 'saving' | 'saved';
  savePending: boolean;
  activeMaxLength: number | null;
  suggestions: RagSuggestion[];
  qaIssues: QAIssue[];
  history: TranslationHistoryEntry[];
  translAreaRef: RefObject<HTMLTextAreaElement | null>;
  onRowSelect: (row: StringRow) => void;
  onRowOpen: (row: StringRow) => void;
  onToggleRow: (row: StringRow, e: React.MouseEvent) => void;
  onToggleAll: () => void;
  onSort: (col: SortCol) => void;
  onColumnFilterChange: (col: keyof ColumnFilters, value: string) => void;
  onContextMenu: (e: React.MouseEvent, row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onCopySource: () => void;
  onTabChange: (tab: BottomTab) => void;
  onOpenBookEditor: () => void;
  capabilities?: EditorCapabilities;
}

/** Strings-mode body: signature sidebar, grid, and resizable detail panel. */
export const ModEditorStringsBody = ({
  modId,
  sigCounts,
  signature,
  onSignatureChange,
  stringsTotal,
  selectedStatusesLength,
  statsTotal,
  centerColRef,
  rows,
  total,
  isLoading,
  isRowSelected,
  allSelected,
  someSelected,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  activeRow,
  focusedRow,
  srcLang,
  targetLang,
  sortCol,
  sortDir,
  columnFilters,
  detailPanelHeight,
  isResizing,
  startDetailPanelResize,
  draftTranslation,
  activeTab,
  saveIndicator,
  savePending,
  activeMaxLength,
  suggestions,
  qaIssues,
  history,
  translAreaRef,
  onRowSelect,
  onRowOpen,
  onToggleRow,
  onToggleAll,
  onSort,
  onColumnFilterChange,
  onContextMenu,
  onClear,
  onDraftChange,
  onSave,
  onCopySource,
  onTabChange,
  onOpenBookEditor,
  capabilities: capabilitiesProp,
}: ModEditorStringsBodyProps) => {
  const { t } = useTranslation();
  const capabilities = capabilitiesProp ?? editorCapabilities('fo4');

  return (
    <div className={styles.body}>
      {capabilities.showSignaturePanel && (
        <SignaturePanel
          sigCounts={sigCounts}
          activeSignature={signature}
          totalFiltered={stringsTotal}
          statusFilterActive={selectedStatusesLength > 0}
          modTotal={statsTotal}
          onSelect={onSignatureChange}
        />
      )}

      <div className={styles.centerCol} ref={centerColRef}>
        <div className={styles.gridArea}>
          <StringGrid
            rows={rows}
            total={total}
            isLoading={isLoading}
            isRowSelected={isRowSelected}
            allSelected={allSelected}
            someSelected={someSelected}
            hasMore={hasNextPage}
            isFetchingMore={isFetchingNextPage}
            onLoadMore={onLoadMore}
            activeRow={activeRow}
            focusedRow={focusedRow}
            srcLang={srcLang}
            targetLang={targetLang}
            sortCol={sortCol}
            sortDir={sortDir}
            columnFilters={columnFilters}
            capabilities={capabilities}
            onRowSelect={onRowSelect}
            onRowOpen={onRowOpen}
            onToggleRow={onToggleRow}
            onToggleAll={onToggleAll}
            onSort={onSort}
            onColumnFilterChange={onColumnFilterChange}
            onContextMenu={onContextMenu}
            onClear={onClear}
            onCopySource={(row) => {
              onRowOpen(row);
              setTimeout(() => onDraftChange(row.source), 0);
            }}
          />
        </div>

        {activeRow && (
          <>
            <div
              className={`${styles.detailPanelResizeHandle} ${isResizing ? styles.detailPanelResizeHandleActive : ''}`}
              onMouseDown={startDetailPanelResize}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('modEditor.resizeDetailPanel')}
              aria-valuenow={detailPanelHeight}
              aria-valuemin={240}
            />
            <div className={styles.detailPanelSizer} style={{ height: detailPanelHeight }}>
              <DetailPanel
                modId={modId}
                activeRow={activeRow}
                draftTranslation={draftTranslation}
                srcLang={srcLang}
                targetLang={targetLang}
                activeTab={activeTab}
                saveIndicator={saveIndicator}
                savePending={savePending}
                activeMaxLength={activeMaxLength}
                suggestions={suggestions}
                qaIssues={qaIssues}
                history={history}
                translAreaRef={translAreaRef}
                capabilities={capabilities}
                onDraftChange={onDraftChange}
                onSave={onSave}
                onCopySource={onCopySource}
                onTabChange={onTabChange}
                onOpenBookEditor={onOpenBookEditor}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
