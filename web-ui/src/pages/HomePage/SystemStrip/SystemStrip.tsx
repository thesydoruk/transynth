import { useTranslation } from 'react-i18next';
import type { OpsOverview } from '../../../api';
import { SmCard } from '../SmCard';
import { fmtBytes, fmtUptime } from '../homeUtils';
import s from './SystemStrip.module.scss';

interface SystemStripProps {
  data: OpsOverview;
}

/** Compact operational status strip shown near the top of the overview page. */
export const SystemStrip = ({ data }: SystemStripProps) => {
  const { t } = useTranslation();
  const system = data.system;

  return (
    <section className={s.sysStrip}>
      <SmCard label={t('ops.uptime')} value={fmtUptime(system.uptimeSeconds)} />
      <SmCard label={t('ops.nodeVersion')} value={system.nodeVersion} />
      <SmCard
        label={t('ops.memory')}
        value={`${fmtBytes(system.heapUsedBytes)} / ${fmtBytes(system.heapTotalBytes)}`}
      />
      <SmCard
        label={t('ops.dbStatus')}
        value={system.dbConnected ? t('ops.dbOk') : t('ops.dbDown')}
        color={system.dbConnected ? '#4caf50' : '#e55'}
      />
    </section>
  );
};
