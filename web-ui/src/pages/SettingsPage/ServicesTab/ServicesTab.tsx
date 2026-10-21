import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import type { ServiceSource } from '../../../api';
import { Button } from '../../../components/Button';
import parentS from '../SettingsPage.module.scss';
import { FleetPanel } from './FleetPanel';
import { ServicesEditor, type SavedServiceRow } from './ServicesEditor';
import s from './ServicesTab.module.scss';

const SOURCE_KEY: Record<ServiceSource, string> = {
  settings: 'settings.services.source.settings',
  'legacy-llm': 'settings.services.source.legacyLlm',
  env: 'settings.services.source.env',
  asr: 'settings.services.source.asr',
};

const REFETCH_MS = 15_000;

/** Services — every external service kind with endpoints, live health and pool load. */
export const ServicesTab = () => {
  const { t } = useTranslation();
  const services = useQuery({
    queryKey: ['services'],
    queryFn: api.services.get,
    refetchInterval: REFETCH_MS,
  });
  const projectSettings = useQuery({
    queryKey: ['projectSettings'],
    queryFn: () => api.projectSettings.getAll(),
    staleTime: 30_000,
  });

  if (services.isLoading || projectSettings.isLoading) {
    return <div className={s.center}>{t('common.loading')}</div>;
  }
  const failure = services.error ?? projectSettings.error;
  if (failure || !services.data) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(failure) })}
      </div>
    );
  }

  const savedRows = (projectSettings.data?.['services.endpoints'] ?? []) as SavedServiceRow[];

  return (
    <>
      <FleetPanel />

      <div className={s.toolbar}>
        <Button
          variant="secondary"
          size="sm"
          disabled={services.isFetching}
          onClick={() => void services.refetch()}
        >
          {services.isFetching ? t('settings.services.refreshing') : t('settings.services.refresh')}
        </Button>
        <span className={s.hint}>
          {t('settings.services.probedAt', {
            time: new Date(services.data.probedAt).toLocaleTimeString(),
          })}
        </span>
      </div>

      {services.data.services.map((svc) => (
        <div key={svc.kind} className={parentS.section}>
          <div className={s.kindHeader}>
            <h2 className={s.kindTitle}>{svc.label}</h2>
            <span className={s.badgeSource}>{t(SOURCE_KEY[svc.source])}</span>
          </div>
          {svc.endpoints.length === 0 ? (
            <div className={s.empty}>{t('settings.services.noEndpoints')}</div>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>{t('settings.services.host')}</th>
                    <th>{t('settings.services.maxParallel')}</th>
                    <th>{t('settings.services.managed')}</th>
                    <th>{t('settings.services.health')}</th>
                    <th>{t('settings.services.inFlight')}</th>
                    <th>{t('settings.services.queued')}</th>
                  </tr>
                </thead>
                <tbody>
                  {svc.endpoints.map((ep) => (
                    <tr key={`${ep.kind}|${ep.host}`}>
                      <td className={s.mono}>{ep.host}</td>
                      <td>{ep.maxParallel}</td>
                      <td>{ep.managed ? t('settings.services.managedYes') : '-'}</td>
                      <td>
                        <span
                          className={ep.healthy ? s.badgeOk : s.badgeError}
                          title={ep.error ?? undefined}
                        >
                          {ep.healthy
                            ? t('settings.services.healthy')
                            : t('settings.services.unhealthy')}
                        </span>
                      </td>
                      <td>{ep.inFlight}</td>
                      <td>{ep.queued}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {svc.pool && (
            <div className={s.poolTotals}>
              {t('settings.services.poolTotals', {
                inFlight: svc.pool.inFlight,
                queued: svc.pool.queued,
                max: svc.pool.max,
                healthyMax: svc.pool.healthyMax,
              })}
            </div>
          )}
        </div>
      ))}

      <ServicesEditor savedRows={savedRows} />
    </>
  );
};
