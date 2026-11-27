import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type VoiceEffortChoice,
  type VoiceLinePreview,
  type VoiceRegenerateParams,
  type VoiceRegeneratePreview,
} from '../../../../../api';
import { VOICE_REGENERATE_KEEP_CURRENT_ID } from '../../../../SettingsPage/VoiceTab/voiceSettingsConfig';
import type { CompareTrack } from '../compareTrack';
import { currentEffortChoice } from '../voiceEffort';

export const useVoiceRegenerateSession = (
  modId: number,
  line: VoiceLinePreview,
  srcLang: string,
  targetLang: string,
  hasCurrentTranslation: boolean,
  sessionId: string,
  onCommitted: () => void,
  stopPlayback: () => void,
  /** Tags reach synthesis for the game; only then is a choice sent with an attempt. */
  effortTagsActive = false,
) => {
  const { t } = useTranslation();
  const [params, setParams] = useState<VoiceRegenerateParams | null>(null);
  const [previews, setPreviews] = useState<VoiceRegeneratePreview[]>([]);
  const [selectedId, setSelectedId] = useState<string>(
    hasCurrentTranslation ? VOICE_REGENERATE_KEEP_CURRENT_ID : '',
  );
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Starts from the line's state; keeping an attempt stores its choice on the line.
  const [effortChoice, setEffortChoice] = useState<VoiceEffortChoice>(() =>
    currentEffortChoice(line),
  );

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.mods.initVoiceRegenerateSession(
          modId,
          line.lineKey,
          line.variant,
          sessionId,
          srcLang,
          targetLang,
          line.originPlugin ?? undefined,
        );
        if (cancelled) return;
        setParams(result.defaultParams);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateInitError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [line.lineKey, line.originPlugin, line.variant, modId, sessionId, srcLang, targetLang, t]);

  const discardSession = useCallback(async () => {
    try {
      await api.mods.discardVoiceRegenerate(modId, sessionId);
    } catch {
      // Best-effort cleanup when closing without commit.
    }
  }, [modId, sessionId]);

  const handleGenerate = async () => {
    if (!params) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await api.mods.generateVoiceRegeneratePreview(modId, sessionId, {
        lineKey: line.lineKey,
        variant: line.variant,
        srcLang,
        targetLang,
        speakerKey: line.speakerKey,
        originPlugin: line.originPlugin ?? undefined,
        params,
        ...(effortTagsActive ? { effortChoice } : {}),
      });
      const preview: VoiceRegeneratePreview = {
        id: result.previewId,
        attempt: result.attempt,
        createdAt: new Date().toISOString(),
        audioUrl: result.audioUrl,
        params: result.params,
        voiceSimilarity: result.voiceSimilarity ?? null,
        effortChoice: result.effortChoice ?? null,
      };
      setPreviews((current) => [...current, preview]);
      setSelectedId(preview.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateGenerateError'));
    } finally {
      setGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!selectedId) {
      setError(t('modEditor.voiceRegenerateSelectError'));
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      await api.mods.commitVoiceRegenerate(modId, sessionId, selectedId);
      stopPlayback();
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateCommitError'));
    } finally {
      setCommitting(false);
    }
  };

  const compareTracks: CompareTrack[] = useMemo(() => {
    const tracks: CompareTrack[] = [{ kind: 'source' }];
    if (hasCurrentTranslation) tracks.push({ kind: 'current' });
    for (const preview of previews) tracks.push({ kind: 'preview', preview });
    return tracks;
  }, [hasCurrentTranslation, previews]);

  return {
    params,
    setParams,
    effortChoice,
    setEffortChoice,
    selectedId,
    setSelectedId,
    loading,
    generating,
    committing,
    error,
    setError,
    compareTracks,
    discardSession,
    handleGenerate,
    handleCommit,
  };
};
