import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../api';
import type { CommitAdvance } from '../DialogsMode/components/DialogLineRow/DialogLineRow';
import type { VoiceLineHandlers } from './components/VoiceLinesView/VoiceLinesView';
import { VoiceNavigator } from './components/VoiceNavigator';
import { VoiceLinesView } from './components/VoiceLinesView';
import { useVoiceActions } from './hooks/useVoiceActions';
import { useVoiceData } from './hooks/useVoiceData';
import { useVoiceKeyboard } from './hooks/useVoiceKeyboard';
import { useVoiceLineCursor } from './hooks/useVoiceLineCursor';
import { useVoiceLineSave } from './hooks/useVoiceLineSave';
import { useVoiceLineView } from './hooks/useVoiceLineView';
import { useVoiceNavigatorWidth } from './hooks/useVoiceNavigatorWidth';
import { useVoicePlayback } from './hooks/useVoicePlayback';
import { useVoiceState } from './hooks/useVoiceState';
import { VoiceRegenerateModal } from './VoiceRegenerateModal';
import styles from './VoiceMode.module.scss';

export interface VoiceModeProps {
  modId: number;
  srcLang: string;
  targetLang: string;
}

/** Orphan audio has no dialogue record, so it is not translation work. */
const needsTranslation = (line: VoiceLinePreview): boolean =>
  !line.isOrphanAudio && !line.translation?.trim();

/**
 * Voice editor: speakers in a navigator beside the dubbed lines of the selected one.
 * Layout and interaction patterns mirror {@link DialogsMode}.
 */
export const VoiceMode = ({ modId, srcLang, targetLang }: VoiceModeProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const state = useVoiceState();
  const searchRef = useRef<HTMLInputElement>(null);
  const { width, isResizing, startResize } = useVoiceNavigatorWidth();
  const [regenerateLine, setRegenerateLine] = useState<VoiceLinePreview | null>(null);

  const data = useVoiceData({
    modId,
    speakerKey: state.speakerKey,
    search: state.search,
    srcLang,
    targetLang,
  });

  const playback = useVoicePlayback(modId);
  const actions = useVoiceActions({
    modId,
    srcLang,
    targetLang,
    speakersQueryKey: data.speakersQueryKey,
    linesQueryKey: data.linesQueryKey,
    onGenerateSuccess: (line) => playback.handlePlay(line, 'translation'),
  });

  const lineView = useVoiceLineView(data.lines);
  const cursor = useVoiceLineCursor(lineView.lineIds, lineView.lineById);
  const save = useVoiceLineSave({
    linesQueryKey: data.linesQueryKey,
    targetLang,
  });

  const commitLine = (line: VoiceLinePreview, text: string, advance: CommitAdvance) => {
    void save.saveLine(line, text);
    if (advance === 'next') cursor.step(1, true);
    else if (advance === 'nextTodo') cursor.goToNextTodo(true);
    else cursor.closeEditor();
  };

  const lineHandlers: VoiceLineHandlers = {
    focusedId: cursor.focusedId,
    editingId: cursor.editingId,
    pendingIds: save.pendingIds,
    onFocus: (line) => {
      if (line.stringId != null) cursor.focus(line.stringId);
    },
    onEdit: (line) => {
      if (line.stringId != null) cursor.edit(line.stringId);
    },
    onCancel: cursor.closeEditor,
    onCommit: commitLine,
  };

  useVoiceKeyboard({
    stepLine: (delta) => cursor.step(delta),
    goToNextTodo: () => cursor.goToNextTodo(),
    edit: () => cursor.edit(),
    playVoice: () => {
      if (cursor.focusedId === null) return;
      const line = lineView.lineById.get(cursor.focusedId);
      if (!line) return;
      void playback.handlePlay(line, line.hasTranslationAudio ? 'translation' : 'source');
    },
    clearFocus: () => cursor.focus(null),
    isEditing: cursor.editingId !== null,
  });

  useEffect(() => {
    if (data.visibleSpeakers.length === 0) return;
    if (
      !state.speakerKey ||
      !data.visibleSpeakers.some((speaker) => speaker.key === state.speakerKey)
    ) {
      state.setSpeakerKey(data.visibleSpeakers[0]!.key);
    }
  }, [state.speakerKey, state.setSpeakerKey, data.visibleSpeakers]);

  const lineCounts = useMemo(() => {
    const lines = data.lines;
    return {
      total: lines.length,
      needsTranslation: lines.filter(needsTranslation).length,
      needsVoice: lines.filter((line) => line.translation?.trim() && !line.hasTranslationAudio)
        .length,
    };
  }, [data.lines]);

  const visibleLines = useMemo(() => {
    let filtered = data.lines;
    if (state.filter === 'needsTranslation') {
      filtered = data.lines.filter(needsTranslation);
    } else if (state.filter === 'needsVoice') {
      filtered = data.lines.filter((line) => line.translation?.trim() && !line.hasTranslationAudio);
    }
    const query = state.find.trim().toLowerCase();
    if (!query) return filtered;
    return filtered.filter(
      (line) =>
        (line.source ?? '').toLowerCase().includes(query) ||
        (line.translation ?? '').toLowerCase().includes(query),
    );
  }, [data.lines, state.filter, state.find]);

  const hiddenLineCount = data.lines.length - visibleLines.length;

  const stepSpeaker = (delta: number) => {
    if (data.visibleSpeakers.length === 0) return;
    const current = data.visibleSpeakers.findIndex((speaker) => speaker.key === data.activeKey);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : data.visibleSpeakers.length - 1
        : Math.min(Math.max(current + delta, 0), data.visibleSpeakers.length - 1);
    state.setSpeakerKey(data.visibleSpeakers[next]!.key);
  };

  const speakersError = data.speakersQuery.error;
  const linesError = data.linesQuery.error;
  const loadError =
    speakersError instanceof Error
      ? speakersError.message
      : data.speakersQuery.data && !data.speakersQuery.data.ok
        ? data.speakersQuery.data.message
        : linesError instanceof Error
          ? linesError.message
          : data.linesQuery.data && !data.linesQuery.data.ok
            ? data.linesQuery.data.message
            : null;

  const panelError =
    loadError ??
    playback.playError ??
    actions.refError ??
    actions.generateError ??
    save.error ??
    null;

  const emptyMessage =
    data.speakersQuery.isLoading || !data.speakersQuery.data
      ? t('modEditor.voiceLoading')
      : data.speakersQuery.data.ok && data.speakers.length === 0
        ? t('modEditor.voiceNoLines')
        : !data.activeSpeaker
          ? t('voice.selectSpeaker')
          : null;

  const handleSetReference = (line: VoiceLinePreview) => {
    if (!data.activeSpeaker) return;
    actions.dismissRefError();
    actions.setReferenceMut.mutate({ speakerKey: data.activeSpeaker.key, line });
  };

  const handleGenerate = (line: VoiceLinePreview) => {
    actions.dismissGenerateError();
    actions.generateMut.mutate(line);
  };

  return (
    <div className={styles.root}>
      <div className={styles.navigatorPane} style={{ width }}>
        <VoiceNavigator
          speakers={data.visibleSpeakers}
          totalCount={data.speakers.length}
          activeKey={data.activeKey}
          search={state.search}
          onSearchChange={state.setSearch}
          onSelect={state.setSpeakerKey}
          onStepSpeaker={stepSpeaker}
          isLoading={data.speakersQuery.isLoading}
          searchRef={searchRef}
        />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className={`${styles.divider} ${isResizing ? styles.dividerActive : ''}`}
        onMouseDown={startResize}
      />

      <VoiceLinesView
        speakerName={data.activeSpeaker?.displayName ?? ''}
        dubbed={data.activeSpeaker?.dubbedCount ?? 0}
        total={data.activeSpeaker?.lineCount ?? 0}
        orphans={data.activeSpeaker?.orphanCount ?? 0}
        hasReference={Boolean(data.activeSpeaker?.referencePick)}
        lines={visibleLines}
        hiddenLineCount={hiddenLineCount}
        filter={state.filter}
        onFilterChange={state.setFilter}
        counts={lineCounts}
        find={state.find}
        onFindChange={state.setFind}
        playingTrack={playback.playingTrack}
        loadingTrack={playback.loadingTrack}
        setReferencePending={actions.setReferenceMut.isPending}
        generatePending={actions.generateMut.isPending}
        regenerateLine={regenerateLine}
        error={panelError}
        onDismissError={() => {
          actions.dismissRefError();
          actions.dismissGenerateError();
          save.dismissError();
        }}
        onPlay={playback.handlePlay}
        onSetReference={handleSetReference}
        onGenerate={handleGenerate}
        onRegenerate={setRegenerateLine}
        lineHandlers={lineHandlers}
        emptyMessage={emptyMessage}
        isLoadingLines={data.linesQuery.isLoading && data.lines.length === 0}
      />

      {regenerateLine && (
        <VoiceRegenerateModal
          modId={modId}
          line={regenerateLine}
          srcLang={srcLang}
          targetLang={targetLang}
          hasCurrentTranslation={Boolean(regenerateLine.hasTranslationAudio)}
          onClose={() => setRegenerateLine(null)}
          onCommitted={async () => {
            setRegenerateLine(null);
            await qc.invalidateQueries({ queryKey: data.speakersQueryKey });
            await qc.invalidateQueries({ queryKey: data.linesQueryKey });
          }}
        />
      )}
    </div>
  );
};
