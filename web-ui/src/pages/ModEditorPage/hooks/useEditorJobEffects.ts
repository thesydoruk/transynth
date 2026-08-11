import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { upsertModAiJob } from '../../../modAiJobsStore';
import { startModAiTranslate } from '../../../modAiTranslateRunner';
import { startModAiVoice } from '../../../modAiVoiceRunner';
import { toast } from '../../../components/Toast';
import type { useAiVerify } from './useAiVerify';
import type { useApplyImported } from './useApplyImported';
import type { useModAiJobsForMod } from '../../../hooks/useModAiJobsForMod';

export interface UseEditorJobEffectsParams {
  modId: number;
  srcLang: string;
  targetLang: string;
  refetchStats: () => void;
  aiVerify: ReturnType<typeof useAiVerify>;
  applyImported: ReturnType<typeof useApplyImported>;
  aiJobs: ReturnType<typeof useModAiJobsForMod>;
  showTranslateResultToast: (mode: 'llm' | 'tm', count: number) => void;
  setShowAiVerify: (open: boolean) => void;
}

/**
 * Side effects for background AI jobs, deep-link `?open=` params, and verify sync.
 */
export function useEditorJobEffects({
  modId,
  srcLang,
  targetLang,
  refetchStats,
  aiVerify,
  applyImported,
  aiJobs,
  showTranslateResultToast,
  setShowAiVerify,
}: UseEditorJobEffectsParams) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const prevApplyImportedStatus = useRef(applyImported.status);
  const prevAiVerifyStatus = useRef(aiVerify.status);
  const prevTranslateStatus = useRef(aiJobs.translate.status);
  const prevSkipDetectStatus = useRef(aiJobs.skipDetect.status);
  const prevGenderDetectStatus = useRef(aiJobs.genderDetect.status);

  useEffect(() => {
    // Skip idle: after reload the poll may restore a running job before useAiVerify
    // reattaches, and writing idle here would wipe that progress.
    if (aiVerify.status === 'idle') return;
    upsertModAiJob(modId, 'verify', {
      status: aiVerify.status,
      jobId: aiVerify.jobId,
      done: aiVerify.done,
      total: aiVerify.total,
      error: aiVerify.error,
    });
  }, [modId, aiVerify.status, aiVerify.jobId, aiVerify.done, aiVerify.total, aiVerify.error]);

  useEffect(() => {
    const open = searchParams.get('open');
    if (open === 'ai-translate') void startModAiTranslate(modId, srcLang, targetLang);
    if (open === 'ai-voice') void startModAiVoice(modId, srcLang, targetLang, 'missing');
    if (open === 'ai-verify') setShowAiVerify(true);
    if (open) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount / deep-link
  }, []);

  useEffect(() => {
    const wasRunning = prevTranslateStatus.current === 'running';
    const mode = aiJobs.translate.translateMode ?? 'llm';

    if (wasRunning && aiJobs.translate.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
      showTranslateResultToast(mode, aiJobs.translate.done);
    }
    if (wasRunning && aiJobs.translate.status === 'failed' && aiJobs.translate.error) {
      toast.error(aiJobs.translate.error);
    }
    prevTranslateStatus.current = aiJobs.translate.status;
  }, [
    aiJobs.translate.status,
    aiJobs.translate.done,
    aiJobs.translate.error,
    aiJobs.translate.translateMode,
    modId,
    qc,
    refetchStats,
    showTranslateResultToast,
  ]);

  useEffect(() => {
    if (
      prevAiVerifyStatus.current === 'running' &&
      (aiVerify.status === 'completed' || aiVerify.status === 'cancelled') &&
      (aiVerify.approved > 0 || aiVerify.fixed > 0)
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevAiVerifyStatus.current = aiVerify.status;
  }, [aiVerify.status, aiVerify.approved, aiVerify.fixed, modId, qc, refetchStats]);

  useEffect(() => {
    if (
      prevApplyImportedStatus.current === 'running' &&
      (applyImported.status === 'completed' || applyImported.status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevApplyImportedStatus.current = applyImported.status;
  }, [applyImported.status, modId, qc, refetchStats]);

  useEffect(() => {
    if (
      prevSkipDetectStatus.current === 'running' &&
      (aiJobs.skipDetect.status === 'completed' || aiJobs.skipDetect.status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevSkipDetectStatus.current = aiJobs.skipDetect.status;
  }, [aiJobs.skipDetect.status, modId, qc, refetchStats]);

  useEffect(() => {
    const wasRunning = prevGenderDetectStatus.current === 'running';

    if (wasRunning && aiJobs.genderDetect.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
      toast.success(
        t('modEditor.genderDetectCompleted', {
          done: aiJobs.genderDetect.done,
          total: aiJobs.genderDetect.total,
        }),
      );
    }
    if (wasRunning && aiJobs.genderDetect.status === 'failed' && aiJobs.genderDetect.error) {
      toast.error(aiJobs.genderDetect.error);
    }
    prevGenderDetectStatus.current = aiJobs.genderDetect.status;
  }, [
    aiJobs.genderDetect.status,
    aiJobs.genderDetect.done,
    aiJobs.genderDetect.total,
    aiJobs.genderDetect.error,
    modId,
    qc,
    refetchStats,
    t,
  ]);
}
