import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import type { FleetGpuView, FleetOverride, FleetServiceView } from '../../../api';
import { Button } from '../../../components/Button';
import parentS from '../SettingsPage.module.scss';
import s from './ServicesTab.module.scss';
import f from './FleetPanel.module.scss';

const REFETCH_MS = 10_000;

const idleSeconds = (svc: FleetServiceView, at: string | null): string => {
  if (svc.idleSinceMs === null || !at) return '-';
  return String(Math.max(0, Math.round((new Date(at).getTime() - svc.idleSinceMs) / 1000)));
};

const statusClass = (svc: FleetServiceView): string => {
  if (svc.status === 'running') return s.badgeOk;
  if (svc.status === 'failed' || svc.status === 'missing') return s.badgeError;
  return s.badgeSource;
};

const GpuRow = ({ gpu }: { gpu: FleetGpuView }) => {
  const { t } = useTranslation();
  const pct = (mb: number) => `${Math.min(100, (mb / Math.max(1, gpu.vramMb)) * 100)}%`;
  return (
    <div className={f.gpu}>
      <span className={s.mono}>
        {gpu.host} #{gpu.index} {gpu.name}
      </span>
      <div className={f.bar}>
        <div className={f.barCommitted} style={{ width: pct(gpu.committedMb) }} />
        {gpu.usedMb !== null && <div className={f.barUsed} style={{ width: pct(gpu.usedMb) }} />}
      </div>
      <span className={s.hint}>
        {t('settings.fleet.gpuLoad', {
          committed: gpu.committedMb,
          used: gpu.usedMb ?? '?',
          total: gpu.vramMb,
        })}
      </span>
    </div>
  );
};

/** Fleet — the GPU controller's view: cards, managed services, demand, recent actions. */
export const FleetPanel = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fleet = useQuery({
    queryKey: ['fleet'],
    queryFn: api.fleet.get,
    refetchInterval: REFETCH_MS,
  });
  const mutation = useMutation({
    mutationFn: (v: { name: string; action: FleetOverride | 'scheduler' }) =>
      v.action === 'scheduler'
        ? api.fleet.clearOverride(v.name)
        : api.fleet.override(v.name, v.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet'] }),
  });

  const data = fleet.data;
  let body;
  if (fleet.isLoading) {
    body = <div className={s.empty}>{t('common.loading')}</div>;
  } else if (fleet.error || !data) {
    body = (
      <div className={`${s.empty} ${s.error}`}>
        {t('common.error', { message: String(fleet.error) })}
      </div>
    );
  } else if (data.controller === 'offline') {
    body = <div className={s.empty}>{t('settings.fleet.offline')}</div>;
  } else {
    const demand = Object.entries(data.demand);
    body = (
      <>
        {data.gpus.map((gpu) => (
          <GpuRow key={`${gpu.host}|${gpu.index}`} gpu={gpu} />
        ))}

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t('settings.fleet.service')}</th>
                <th>{t('settings.fleet.kinds')}</th>
                <th>{t('settings.fleet.location')}</th>
                <th>{t('settings.fleet.status')}</th>
                <th>{t('settings.services.health')}</th>
                <th>{t('settings.fleet.vram')}</th>
                <th>{t('settings.fleet.priority')}</th>
                <th>{t('settings.fleet.idle')}</th>
                <th>{t('settings.fleet.override')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((svc) => (
                <tr key={svc.name}>
                  <td className={s.mono}>{svc.name}</td>
                  <td>{svc.kinds.join(', ')}</td>
                  <td className={s.mono}>
                    {svc.host} / {svc.gpu}
                  </td>
                  <td>
                    <span className={statusClass(svc)} title={svc.lastError ?? undefined}>
                      {t(`settings.fleet.statuses.${svc.status}`)}
                    </span>
                  </td>
                  <td>
                    <span className={svc.healthy ? s.badgeOk : s.badgeError}>
                      {svc.healthy
                        ? t('settings.services.healthy')
                        : t('settings.services.unhealthy')}
                    </span>
                  </td>
                  <td>{svc.vramMb}</td>
                  <td>{svc.priority}</td>
                  <td>{idleSeconds(svc, data.at)}</td>
                  <td>
                    {svc.manual ? (
                      <span className={s.badgeSource}>
                        {t(`settings.fleet.manual.${svc.manual}`)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={f.buttons}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ name: svc.name, action: 'start' })}
                    >
                      {t('settings.fleet.start')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ name: svc.name, action: 'stop' })}
                    >
                      {t('settings.fleet.stop')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={mutation.isPending || !svc.manual}
                      onClick={() => mutation.mutate({ name: svc.name, action: 'scheduler' })}
                    >
                      {t('settings.fleet.scheduler')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mutation.error && (
          <div className={`${s.empty} ${s.error}`}>
            {t('common.error', { message: String(mutation.error) })}
          </div>
        )}

        <div className={s.poolTotals}>
          {t('settings.fleet.demand')}:{' '}
          {demand.length === 0
            ? t('settings.fleet.noDemand')
            : demand
                .map(([kind, d]) =>
                  t('settings.fleet.demandKind', {
                    kind,
                    waiting: d?.waiting ?? 0,
                    active: d?.active ?? 0,
                  }),
                )
                .join('; ')}
        </div>

        <h3 className={f.subTitle}>{t('settings.fleet.actions')}</h3>
        {data.actions.length === 0 ? (
          <div className={s.empty}>{t('settings.fleet.noActions')}</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                {data.actions.slice(0, 10).map((a, i) => (
                  <tr key={`${a.at}|${a.service}|${i}`}>
                    <td>{new Date(a.at).toLocaleTimeString()}</td>
                    <td>{t(`settings.fleet.${a.type}`)}</td>
                    <td className={s.mono}>{a.service}</td>
                    <td>{a.reason}</td>
                    <td>
                      <span
                        className={a.ok ? s.badgeOk : s.badgeError}
                        title={a.error ?? undefined}
                      >
                        {a.ok ? t('settings.fleet.ok') : (a.error ?? t('settings.fleet.failed'))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={parentS.section}>
      <div className={s.kindHeader}>
        <h2 className={s.kindTitle}>{t('settings.fleet.title')}</h2>
        {data && (
          <span className={data.controller === 'online' ? s.badgeOk : s.badgeSource}>
            {t(`settings.fleet.controller.${data.controller}`)}
          </span>
        )}
      </div>
      {body}
    </div>
  );
};
