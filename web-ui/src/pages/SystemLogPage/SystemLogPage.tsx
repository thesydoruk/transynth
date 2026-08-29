import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type SystemLogEntry, type SystemLogLevel, type SystemLogSource } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { PaginationControls } from '../../components/PaginationControls';
import s from './SystemLogPage.module.scss';

const PAGE_SIZE = 50;
const REFETCH_MS = 5_000;
const LEVELS: SystemLogLevel[] = ['error', 'warning', 'info'];
const SOURCES: SystemLogSource[] = ['llm', 'tts', 'job', 'system'];

const levelClass = (level: SystemLogLevel): string => {
  if (level === 'error') return `${s.badge} ${s.levelError}`;
  if (level === 'warning') return `${s.badge} ${s.levelWarning}`;
  return `${s.badge} ${s.levelInfo}`;
};

const jobLabel = (entry: SystemLogEntry): string => {
  if (entry.job_kind && entry.job_id != null) return `${entry.job_kind} #${entry.job_id}`;
  if (entry.job_kind) return entry.job_kind;
  if (entry.job_id != null) return `#${entry.job_id}`;
  return '—';
};

export const SystemLogPage = () => {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['systemLog', offset, level, source],
    queryFn: () =>
      api.systemLog.list({
        limit: PAGE_SIZE,
        offset,
        level: level || undefined,
        source: source || undefined,
      }),
    refetchInterval: REFETCH_MS,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={s.page}>
      <PageHeader title={t('systemLog.title')} description={t('systemLog.subtitle')} />

      <div className={s.filters}>
        <select
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('systemLog.allLevels')}</option>
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {t(`systemLog.level.${value}`)}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('systemLog.allSources')}</option>
          {SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(`systemLog.source.${value}`)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && entries.length === 0 ? (
        <div className={s.center}>{t('common.loading')}</div>
      ) : error ? (
        <div className={`${s.center} ${s.error}`}>
          {t('common.error', { message: String(error) })}
        </div>
      ) : entries.length === 0 ? (
        <div className={s.empty}>{t('systemLog.empty')}</div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t('systemLog.time')}</th>
              <th>{t('systemLog.levelLabel')}</th>
              <th>{t('systemLog.sourceLabel')}</th>
              <th>{t('systemLog.message')}</th>
              <th>{t('systemLog.job')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className={s.time}>{new Date(entry.created_at).toLocaleString()}</td>
                <td>
                  <span className={levelClass(entry.level)}>
                    {t(`systemLog.level.${entry.level}`)}
                  </span>
                </td>
                <td>
                  <span className={s.badge}>{t(`systemLog.source.${entry.source}`)}</span>
                </td>
                <td className={s.message}>{entry.message}</td>
                <td className={s.job}>{jobLabel(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className={s.pagination}>
          <PaginationControls
            info={
              <>
                {t('common.page', { page, totalPages })} ({t('systemLog.entries', { total })})
              </>
            }
            onPrev={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            onNext={() => setOffset((value) => value + PAGE_SIZE)}
            prevDisabled={offset === 0}
            nextDisabled={offset + PAGE_SIZE >= total}
          />
        </div>
      )}
    </div>
  );
};
