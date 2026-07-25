import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogLine } from '../../../../api';
import { DialogNavigator } from './components/DialogNavigator';
import { DialogTranscriptView, type DialogLineHandlers } from './components/DialogTranscriptView';
import type { CommitAdvance } from './components/DialogLineRow';
import { useDialogLineSave } from './hooks/useDialogLineSave';
import { useDialogsData } from './hooks/useDialogsData';
import { useDialogsKeyboard } from './hooks/useDialogsKeyboard';
import { useDialogsState } from './hooks/useDialogsState';
import { useDialogVoice } from './hooks/useDialogVoice';
import { useLineCursor } from './hooks/useLineCursor';
import { useNavigatorWidth } from './hooks/useNavigatorWidth';
import { useTranscriptFill } from './hooks/useTranscriptFill';
import { useTranscriptView } from './hooks/useTranscriptView';
import styles from './DialogsMode.module.scss';

/** Props for the dialogs editor. */
export interface DialogsModeProps {
  /** Numeric id of the currently open mod. */
  modId: number;
  /** Source language code used to resolve dialog text. */
  srcLang: string;
  /** Target language code translations are read from and written to. */
  targetLang: string;
}

/**
 * Dialogs editor: a navigator of topics, scenes, and quest conversations beside
 * the transcript of the selected one.
 *
 * Everything the user picks lives in the URL, so a reload or a shared link
 * reopens the same line. Editing is keyboard-driven — see `dialogs.hotkeyHint`
 * for the full set — and every save patches the cached transcript in place so
 * the reading position never moves.
 */
export const DialogsMode = ({ modId, srcLang, targetLang }: DialogsModeProps) => {
  const { t } = useTranslation();
  const state = useDialogsState();
  const searchRef = useRef<HTMLInputElement>(null);
  const { width, isResizing, startResize } = useNavigatorWidth();

  const data = useDialogsData({
    modId,
    scope: state.scope,
    groupKey: state.groupKey,
    search: state.search,
    sort: state.sort,
    hideDone: state.hideDone,
    srcLang,
    targetLang,
  });

  const view = useTranscriptView(data.transcript, state.filter, state.find);
  const cursor = useLineCursor(view);
  const voice = useDialogVoice(modId, targetLang);

  const save = useDialogLineSave({
    transcriptQueryKey: data.transcriptQueryKey,
    groupsQueryKey: data.groupsQueryKey,
    activeKey: data.activeKey,
    targetLang,
  });

  const fill = useTranscriptFill({
    modId,
    srcLang,
    targetLang,
    transcriptQueryKey: data.transcriptQueryKey,
    groupsQueryKey: data.groupsQueryKey,
  });

  const stepGroup = (delta: number) => {
    const groups = data.visibleGroups;
    if (groups.length === 0) return;
    const current = groups.findIndex((group) => group.key === data.activeKey);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : groups.length - 1
        : Math.min(Math.max(current + delta, 0), groups.length - 1);
    state.setGroupKey(groups[next].key);
  };

  const commitLine = (line: DialogLine, text: string, advance: CommitAdvance) => {
    void save.saveLine(line, text);
    if (advance === 'next') cursor.step(1, true);
    else if (advance === 'nextTodo') cursor.goToNextTodo(true);
    else cursor.closeEditor();
  };

  const handlers: DialogLineHandlers = {
    focusedId: cursor.focusedId,
    editingId: cursor.editingId,
    pendingIds: save.pendingIds,
    onFocus: (line) => cursor.focus(line.string_id),
    onEdit: (line) => cursor.edit(line.string_id),
    onCancel: cursor.closeEditor,
    onCommit: commitLine,
    onSetStatus: (line, status) => void save.setLineStatus(line, status),
    voiceFor: voice.voiceFor,
  };

  /** Prefer the original take: it is the reference a translator listens for. */
  const playFocusedVoice = () => {
    if (cursor.focusedId === null) return;
    const line = view.lineById.get(cursor.focusedId);
    const entry = view.entryByLineId.get(cursor.focusedId);
    if (!line || !entry) return;
    const lineVoice = voice.voiceFor(entry, line);
    if (!lineVoice) return;
    lineVoice.play(lineVoice.hasSource ? 'source' : 'translation');
  };

  useDialogsKeyboard({
    setScope: state.setScope,
    stepGroup,
    stepLine: (delta) => cursor.step(delta),
    goToNextTodo: () => cursor.goToNextTodo(),
    edit: () => cursor.edit(),
    playVoice: playFocusedVoice,
    clearFocus: () => {
      cursor.closeEditor();
      cursor.focus(null);
    },
    focusSearch: () => searchRef.current?.focus(),
    isEditing: cursor.editingId !== null,
  });

  const emptyMessage =
    data.activeKey !== null
      ? null
      : data.groupsQuery.isLoading
        ? t('dialogs.loadingGroups')
        : data.groups.length === 0
          ? t(`dialogs.empty.${state.scope}`)
          : t('dialogs.selectGroup');

  return (
    <div className={styles.root}>
      <div className={styles.navigatorPane} style={{ width }}>
        <DialogNavigator
          scope={state.scope}
          onScopeChange={state.setScope}
          search={state.search}
          onSearchChange={state.setSearch}
          sort={state.sort}
          onSortChange={state.setSort}
          hideDone={state.hideDone}
          onHideDoneChange={state.setHideDone}
          groups={data.visibleGroups}
          totalCount={data.groups.length}
          activeKey={data.activeKey}
          onSelect={state.setGroupKey}
          onStepGroup={stepGroup}
          isLoading={data.groupsQuery.isLoading}
          searchRef={searchRef}
        />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className={`${styles.divider} ${isResizing ? styles.dividerActive : ''}`}
        onMouseDown={startResize}
      />

      <DialogTranscriptView
        header={{
          label: data.transcript?.label ?? data.activeGroup?.label ?? '',
          sublabel: data.activeGroup?.sublabel ?? null,
          counts: view.counts,
          filter: state.filter,
          onFilterChange: state.setFilter,
          find: state.find,
          onFindChange: state.setFind,
          hiddenEntryCount: view.hiddenEntryCount,
          onNextTodo: () => cursor.goToNextTodo(true),
          onFill: (mode) => void fill.fill(mode, view.lines),
          fillProgress: fill.progress,
          isFetching: data.transcriptQuery.isFetching,
          error: save.error
            ? t('dialogs.saveFailed', { message: save.error })
            : voice.error
              ? t('dialogs.voiceFailed', { message: voice.error })
              : null,
          onDismissError: () => {
            save.dismissError();
            voice.clearError();
          },
        }}
        entries={view.entries}
        handlers={handlers}
        isLoading={data.transcriptQuery.isLoading}
        emptyMessage={emptyMessage}
      />
    </div>
  );
};
