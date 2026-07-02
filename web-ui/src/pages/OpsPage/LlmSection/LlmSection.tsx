import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { OpsOverview } from '../../../api';
import { api } from '../../../api';
import { MiniCard } from '../MiniCard';
import s from '../OpsPage.module.scss';
import ls from './LlmSection.module.scss';

interface LlmSectionProps {
  data: OpsOverview;
}

/** LLM stats, auto-translation counts, and translation RAG index status. */
export const LlmSection = ({ data }: LlmSectionProps) => {
  const { t } = useTranslation();
  const llm = data.llm;
  const rag = data.rag;
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);

  const reindexMutation = useMutation({
    mutationFn: () => api.ops.reindexRag(),
    onSuccess: (result) => {
      setReindexMsg(
        `${result.indexed}/${result.total} indexed, ${result.failed} failed, ${result.skipped} removed`,
      );
    },
    onError: (err) => {
      setReindexMsg(String(err));
    },
  });

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.llm')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.autoTranslated')} value={llm.autoTranslated.toLocaleString()} />
      </div>
      {llm.byModel.length > 0 && (
        <table className={s.compactTable}>
          <thead>
            <tr>
              <th className={s.th}>{t('ops.model')}</th>
              <th className={s.thR}>{t('ops.count')}</th>
            </tr>
          </thead>
          <tbody>
            {llm.byModel.map((model) => (
              <tr key={model.model} className={s.tr}>
                <td className={s.tdMono}>{model.model}</td>
                <td className={s.tdR}>{model.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className={ls.subheading}>{t('ops.rag')}</h3>
      <div className={s.cards}>
        <MiniCard
          label={t('ops.ragPgvector')}
          value={rag.pgvectorAvailable ? t('ops.dbOk') : t('ops.dbDown')}
        />
        <MiniCard
          label={t('ops.ragIndexed')}
          value={`${rag.indexedCount.toLocaleString()} / ${rag.eligibleCount.toLocaleString()}`}
        />
        <MiniCard label={t('ops.ragEmbedModel')} value={rag.embedModel || '—'} />
      </div>
      <div className={ls.actions}>
        <button
          type="button"
          className={ls.reindexBtn}
          disabled={reindexMutation.isPending || !rag.pgvectorAvailable}
          onClick={() => reindexMutation.mutate()}
        >
          {reindexMutation.isPending ? t('ops.ragReindexing') : t('ops.ragReindex')}
        </button>
        {reindexMsg && <span className={ls.reindexMsg}>{reindexMsg}</span>}
      </div>
    </section>
  );
};
