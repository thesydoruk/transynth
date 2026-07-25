import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type VoiceLinePreview } from '../../../../api';
import { VoiceNavigator } from './components/VoiceNavigator';
import { VoiceLinesView } from './components/VoiceLinesView';
import { useVoiceActions } from './hooks/useVoiceActions';
import { useVoiceNavigatorWidth } from './hooks/useVoiceNavigatorWidth';
import { useVoicePlayback } from './hooks/useVoicePlayback';
import { useVoiceState } from './hooks/useVoiceState';
import { speakerDubbedCount } from './voiceLineKeys';
import { VoiceRegenerateModal } from './VoiceRegenerateModal';
import styles from './VoiceMode.module.scss';

export interface VoiceModeProps {
  modId: number;
  srcLang: string;
  targetLang: string;
}

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['voice-lines', modId, srcLang, targetLang],
    queryFn: () => api.mods.voiceLines(modId, srcLang, targetLang),
  });

  const playback = useVoicePlayback(modId);
  const actions = useVoiceActions(modId, srcLang, targetLang, (line) =>
    playback.handlePlay(line, 'translation'),
  );

  const speakers = data?.ok ? data.speakers : [];

  const visibleSpeakers = useMemo(() => {
    const query = state.search.trim().toLowerCase();
    if (!query) return speakers;
    return speakers.filter((speaker) => speaker.displayName.toLowerCase().includes(query));
  }, [speakers, state.search]);

  useEffect(() => {
    if (visibleSpeakers.length === 0) return;
    if (!state.speakerKey || !visibleSpeakers.some((speaker) => speaker.key === state.speakerKey)) {
      state.setSpeakerKey(visibleSpeakers[0]!.key);
    }
  }, [state.speakerKey, state.setSpeakerKey, visibleSpeakers]);

  const activeSpeaker = speakers.find((speaker) => speaker.key === state.speakerKey) ?? null;

  const lineCounts = useMemo(() => {
    const lines = activeSpeaker?.lines ?? [];
    return {
      total: lines.length,
      needsTranslation: lines.filter((line) => !line.translation?.trim()).length,
      needsVoice: lines.filter((line) => line.translation?.trim() && !line.hasTranslationAudio)
        .length,
    };
  }, [activeSpeaker]);

  const visibleLines = useMemo(() => {
    const lines = activeSpeaker?.lines ?? [];
    let filtered = lines;
    if (state.filter === 'needsTranslation') {
      filtered = lines.filter((line) => !line.translation?.trim());
    } else if (state.filter === 'needsVoice') {
      filtered = lines.filter((line) => line.translation?.trim() && !line.hasTranslationAudio);
    }
    const query = state.find.trim().toLowerCase();
    if (!query) return filtered;
    return filtered.filter(
      (line) =>
        (line.source ?? '').toLowerCase().includes(query) ||
        (line.translation ?? '').toLowerCase().includes(query),
    );
  }, [activeSpeaker, state.filter, state.find]);

  const hiddenLineCount = (activeSpeaker?.lines.length ?? 0) - visibleLines.length;
  const dubbed = activeSpeaker ? speakerDubbedCount(activeSpeaker.lines) : 0;

  const stepSpeaker = (delta: number) => {
    if (visibleSpeakers.length === 0) return;
    const current = visibleSpeakers.findIndex((speaker) => speaker.key === state.speakerKey);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : visibleSpeakers.length - 1
        : Math.min(Math.max(current + delta, 0), visibleSpeakers.length - 1);
    state.setSpeakerKey(visibleSpeakers[next]!.key);
  };

  const loadError =
    error instanceof Error
      ? error.message
      : data && !data.ok
        ? data.message
        : isLoading
          ? null
          : null;

  const panelError =
    loadError ?? playback.playError ?? actions.refError ?? actions.generateError ?? null;

  const emptyMessage =
    isLoading || !data
      ? t('modEditor.voiceLoading')
      : data.ok && speakers.length === 0
        ? t('modEditor.voiceNoLines')
        : !activeSpeaker
          ? t('voice.selectSpeaker')
          : null;

  const handleSetReference = (line: VoiceLinePreview) => {
    if (!activeSpeaker) return;
    actions.dismissRefError();
    actions.setReferenceMut.mutate({ speakerKey: activeSpeaker.key, line });
  };

  const handleGenerate = (line: VoiceLinePreview) => {
    actions.dismissGenerateError();
    actions.generateMut.mutate(line);
  };

  return (
    <div className={styles.root}>
      <div className={styles.navigatorPane} style={{ width }}>
        <VoiceNavigator
          speakers={visibleSpeakers}
          totalCount={speakers.length}
          activeKey={state.speakerKey}
          search={state.search}
          onSearchChange={state.setSearch}
          onSelect={state.setSpeakerKey}
          onStepSpeaker={stepSpeaker}
          isLoading={isLoading}
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
        speakerName={activeSpeaker?.displayName ?? ''}
        dubbed={dubbed}
        total={activeSpeaker?.lines.length ?? 0}
        hasReference={Boolean(activeSpeaker?.referencePick)}
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
        }}
        onPlay={playback.handlePlay}
        onSetReference={handleSetReference}
        onGenerate={handleGenerate}
        onRegenerate={setRegenerateLine}
        emptyMessage={emptyMessage}
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
            await qc.invalidateQueries({ queryKey: ['voice-lines', modId, srcLang, targetLang] });
          }}
        />
      )}
    </div>
  );
};
