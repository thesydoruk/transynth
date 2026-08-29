import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import s from './WorkflowTab.module.scss';

/** RAG index status and rebuild control — used to live on the deleted Ops page. */
export const RagIndexSection = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    staleTime: 30_000,
  });

  const reindexMutation = useMutation({
    mutationFn: () => api.ops.reindexRag(),
    onSuccess: (result) => {
      setReindexMsg(
        t('settings.workflow.ragReindexResult', {
          indexed: result.indexed,
          total: result.total,
          failed: result.failed,
          skipped: result.skipped,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
    },
    onError: (err) => {
      setReindexMsg(String(err));
    },
  });

  const rag = data?.rag;
  const pgvectorOk = rag?.pgvectorAvailable ?? false;

  return (
    <div className={s.settingRow}>
      <div className={s.settingInfo}>
        <span className={s.settingLabel}>{t('settings.workflow.ragIndex')}</span>
        <span className={parentS.fieldNote}>
          {rag
            ? t('settings.workflow.ragIndexDesc', {
                indexed: rag.indexedCount.toLocaleString(),
                eligible: rag.eligibleCount.toLocaleString(),
              })
            : t('common.loading')}
        </span>
        {reindexMsg && <span className={s.reindexMsg}>{reindexMsg}</span>}
      </div>
      <button
        type="button"
        className={s.actionBtn}
        disabled={reindexMutation.isPending || !pgvectorOk}
        onClick={() => reindexMutation.mutate()}
      >
        {reindexMutation.isPending
          ? t('settings.workflow.ragReindexing')
          : t('settings.workflow.ragReindex')}
      </button>
    </div>
  );
};
