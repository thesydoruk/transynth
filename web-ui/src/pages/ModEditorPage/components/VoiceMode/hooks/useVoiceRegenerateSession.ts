import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type VoiceLinePreview,
  type VoiceRegenerateParams,
  type VoiceRegeneratePreview,
} from '../../../../../api';
import { VOICE_REGENERATE_KEEP_CURRENT_ID } from '../../../../SettingsPage/VoiceTab/voiceSettingsConfig';
import type { CompareTrack } from '../compareTrack';

export const useVoiceRegenerateSession = (
  modId: number,
  line: VoiceLinePreview,
  srcLang: string,
  targetLang: string,
  hasCurrentTranslation: boolean,
  sessionId: string,
  onCommitted: () => void,
  stopPlayback: () => void,
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

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.mods.initVoiceRegenerateSession(
          modId,
          line.formidLower6,
          line.variant,
          sessionId,
          srcLang,
          targetLang,
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
  }, [line.formidLower6, line.variant, modId, sessionId, srcLang, targetLang, t]);

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
        formidLower6: line.formidLower6,
        variant: line.variant,
        srcLang,
        targetLang,
        params,
      });
      const preview: VoiceRegeneratePreview = {
        id: result.previewId,
        attempt: result.attempt,
        createdAt: new Date().toISOString(),
        audioUrl: result.audioUrl,
        params: result.params,
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
