import { useTranslation } from 'react-i18next';
import type { OpsOverview } from '../../api';
import { MiniCard } from './MiniCard';
import { fmtBytes, fmtUptime } from './opsUtils';
import s from './OpsPage.module.scss';

interface SystemSectionProps {
  data: OpsOverview;
}

/** System health cards: uptime, Node version, memory, RSS, and DB status. */
export const SystemSection = ({ data }: SystemSectionProps) => {
  const { t } = useTranslation();
  const system = data.system;

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.system')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.uptime')} value={fmtUptime(system.uptimeSeconds)} />
        <MiniCard label={t('ops.nodeVersion')} value={system.nodeVersion} />
        <MiniCard
          label={t('ops.memory')}
          value={fmtBytes(system.heapUsedBytes)}
          sub={`/ ${fmtBytes(system.heapTotalBytes)}`}
        />
        <MiniCard label={t('ops.rss')} value={fmtBytes(system.memoryRssBytes)} />
        <MiniCard
          label={t('ops.dbStatus')}
          value={system.dbConnected ? t('ops.dbOk') : t('ops.dbDown')}
          color={system.dbConnected ? '#4caf50' : '#e55'}
        />
      </div>
    </section>
  );
};
