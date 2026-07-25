import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { BookEditorModal } from '../../../components/BookEditorModal';
import type { StringRow } from '../../../api';
import { SearchReplaceModal } from './SearchReplaceModal';
import { ApplyTranslationFromModModal } from './ApplyTranslationFromModModal';
import { AiVerifyModal } from './AiVerifyModal';
import type { useAiVerify } from '../hooks/useAiVerify';
import type { useApplyImported } from '../hooks/useApplyImported';

export interface ModEditorModalsProps {
  modId: number;
  gameId: string | undefined;
  srcLang: string;
  targetLang: string;
  activeRow: StringRow | null;
  draftTranslation: string;
  stringsRows: StringRow[] | undefined;
  refetchStats: () => void;
  aiVerify: ReturnType<typeof useAiVerify>;
  applyImported: ReturnType<typeof useApplyImported>;
  showSearchReplace: boolean;
  showApplyTranslationFromMod: boolean;
  showAiVerify: boolean;
  showBookEditor: boolean;
  onCloseSearchReplace: () => void;
  onCloseApplyTranslationFromMod: () => void;
  onCloseAiVerify: () => void;
  onCloseBookEditor: () => void;
  onDraftChange: (text: string) => void;
  onRowOpen: (row: StringRow) => void;
}

/** Lazy-mounted modals for the mod editor page. */
export const ModEditorModals = ({
  modId,
  gameId,
  srcLang,
  targetLang,
  activeRow,
  draftTranslation,
  stringsRows,
  refetchStats,
  aiVerify,
  applyImported,
  showSearchReplace,
  showApplyTranslationFromMod,
  showAiVerify,
  showBookEditor,
  onCloseSearchReplace,
  onCloseApplyTranslationFromMod,
  onCloseAiVerify,
  onCloseBookEditor,
  onDraftChange,
  onRowOpen,
}: ModEditorModalsProps) => {
  const qc = useQueryClient();

  return (
    <>
      {showSearchReplace && (
        <SearchReplaceModal
          modId={modId}
          targetLang={targetLang}
          onClose={onCloseSearchReplace}
          onApplied={() => {
            qc.invalidateQueries({ queryKey: ['strings', modId] });
          }}
        />
      )}
      {showApplyTranslationFromMod && gameId && (
        <ApplyTranslationFromModModal
          modId={modId}
          gameId={gameId}
          srcLang={srcLang}
          targetLang={targetLang}
          job={applyImported}
          onClose={onCloseApplyTranslationFromMod}
        />
      )}
      {showAiVerify && (
        <AiVerifyModal
          srcLang={srcLang}
          targetLang={targetLang}
          state={aiVerify}
          onClose={onCloseAiVerify}
          onRowClick={(stringId) => {
            const row = stringsRows?.find((r) => r.string_id === stringId);
            if (row) {
              onRowOpen(row);
              onCloseAiVerify();
            }
          }}
          onApplySuggestion={async (issue) => {
            if (!issue.suggestion) return;
            await api.strings.saveTranslation(issue.stringId, issue.suggestion, 'auto', targetLang);
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
          onApplyAllSuggestions={async (batch) => {
            for (const issue of batch) {
              if (!issue.suggestion) continue;
              await api.strings.saveTranslation(
                issue.stringId,
                issue.suggestion,
                'auto',
                targetLang,
              );
            }
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
        />
      )}
      {showBookEditor && activeRow && (
        <BookEditorModal
          source={activeRow.source}
          translation={draftTranslation}
          onSave={(markup) => {
            onDraftChange(markup);
            onCloseBookEditor();
          }}
          onClose={onCloseBookEditor}
        />
      )}
    </>
  );
};
