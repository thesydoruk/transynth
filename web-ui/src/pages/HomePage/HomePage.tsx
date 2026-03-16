/**
 * HomePage — merged project Overview.
 *
 * Combines translation progress and operational health into one top-level page.
 * The page itself now only orchestrates data fetching and delegates each visual
 * block to a dedicated local component file to keep lint-compliant boundaries.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import {
  listAppJobs,
  subscribeAppJobs,
  type AppJob,
} from '../../appJobsQueue';
import {
  listNexusDownloadJobs,
  subscribeNexusDownloadJobs,
  type NexusDownloadJob,
} from '../../nexusDownloadQueue';
import { ModProgressSection } from './ModProgressSection';
import { ProjectStats } from './ProjectStats';
import { RecentImports } from './RecentImports';
import { SystemStrip } from './SystemStrip';
import { TechDetailsSection } from './TechDetailsSection';
import s from './HomePage.module.scss';

/**
 * HomePage — combined project overview and health dashboard.
 */
export const HomePage = () => {
  const { t } = useTranslation();
  const [appJobs, setAppJobs] = useState<AppJob[]>(() => listAppJobs());
  const [nexusDownloads, setNexusDownloads] = useState<NexusDownloadJob[]>(() => listNexusDownloadJobs());

  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.stats.dashboard,
    refetchInterval: 60_000,
  });

  const { data: ops, isLoading: opsLoading } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const unsubscribe = subscribeNexusDownloadJobs(() => {
      setNexusDownloads(listNexusDownloadJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppJobs(() => {
      setAppJobs(listAppJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  if (dashLoading || opsLoading) {
    return <div className={s.loading}>{t('common.loading')}</div>;
  }

  return (
    <div className={s.page}>
      {dash && <ProjectStats data={dash} />}

      {ops && <SystemStrip data={ops} />}
      {dash && <ModProgressSection data={dash} />}
      {ops && <RecentImports jobs={ops.importJobs} nexusDownloads={nexusDownloads} appJobs={appJobs} llmJobs={ops.llmJobs ?? []} />}
      {ops && <TechDetailsSection data={ops} />}
    </div>
  );
};

