import { useTranslation } from 'react-i18next';
import type { OpsOverview } from '../../api';
import { MiniCard } from './MiniCard';
import s from './OpsPage.module.scss';

interface LlmSectionProps {
  data: OpsOverview;
}

/** LLM and auto-translation stats: cache size, totals, and per-model usage. */
export const LlmSection = ({ data }: LlmSectionProps) => {
  const { t } = useTranslation();
  const llm = data.llm;

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.llm')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.cacheEntries')} value={llm.cacheEntries.toLocaleString()} />
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
    </section>
  );
};