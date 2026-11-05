import { useTranslation } from 'react-i18next';
import type { VortexRun, VortexRunStatus, VortexStage } from '../../api';
import { Button } from '../../components/Button';
import { STAGE_BUTTONS } from './useVortexPage';
import s from './VortexPage.module.scss';

type Props = {
  run: VortexRunStatus | null;
  runActive: boolean;
  history: VortexRun[];
  canStart: (stage: VortexStage) => { ok: boolean; missing: string | null };
  onStart: (stage: VortexStage) => void;
  onStop: (runId: number) => void;
};

const STATUS_CLASS: Record<string, string> = {
  completed: 'badgeOk',
  failed: 'badgeError',
  cancelled: 'badgeMuted',
  skipped: 'badgeMuted',
};

/** Stage buttons, the live run with its per-mod jobs, and the run history. */
export const VortexRunPanel = ({ run, runActive, history, canStart, onStart, onStop }: Props) => {
  const { t } = useTranslation();
  const statusClass = (status: string) => s[STATUS_CLASS[status] ?? 'badgeInfo'];

  return (
    <section className={s.panel} aria-labelledby="vortex-run-title">
      <div className={s.panelHead}>
        <h2 id="vortex-run-title" className={s.panelTitle}>
          {t('vortex.stages.title')}
        </h2>
      </div>
      <p className={s.hint}>{t('vortex.stages.hint')}</p>
      <div className={s.stageButtons}>
        {STAGE_BUTTONS.map((stage) => {
          const gate = canStart(stage);
          const title = gate.missing
            ? t('vortex.stages.needsHost', { service: gate.missing.toUpperCase() })
            : runActive
              ? t('vortex.stages.busy')
              : undefined;
          return (
            <Button
              key={stage}
              variant={stage === 'export' ? 'primary' : 'secondary'}
              size="sm"
              disabled={!gate.ok}
              title={title}
              onClick={() => onStart(stage)}
            >
              {t(`vortex.stages.names.${stage}`)}
            </Button>
          );
        })}
      </div>

      {run && (
        <div className={s.runBox}>
          <div className={s.panelHead}>
            <strong>
              {t('vortex.run.current', { id: run.id, stage: run.stage ?? run.current_stage ?? '' })}
            </strong>
            <span className={statusClass(run.status)}>{run.status}</span>
            {run.progress.total > 0 && (
              <span className={s.muted}>
                {run.progress.done}/{run.progress.total}
              </span>
            )}
            {runActive && (
              <Button variant="dangerGhost" size="sm" onClick={() => onStop(run.id)}>
                {t('vortex.run.stop')}
              </Button>
            )}
          </div>
          {run.error && <p className={s.errorText}>{run.error}</p>}
          {run.modJobs.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t('vortex.run.mod')}</th>
                  <th>{t('vortex.run.job')}</th>
                  <th>{t('vortex.run.progress')}</th>
                  <th>{t('vortex.run.status')}</th>
                </tr>
              </thead>
              <tbody>
                {run.modJobs.map((job) => (
                  <tr key={job.modId}>
                    <td>{job.name}</td>
                    <td className={s.mono}>{job.jobId ?? '—'}</td>
                    <td>{job.total > 0 ? `${job.done}/${job.total}` : '—'}</td>
                    <td>
                      <span className={statusClass(job.status)}>{job.status}</span>
                      {job.error && <span className={s.errorText}> {job.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details className={s.history}>
          <summary>{t('vortex.history.title', { count: history.length })}</summary>
          <table className={s.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('vortex.history.stage')}</th>
                <th>{t('vortex.history.startedBy')}</th>
                <th>{t('vortex.run.status')}</th>
                <th>{t('vortex.history.when')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td className={s.mono}>{row.id}</td>
                  <td>{row.stage ?? row.last_completed_stage ?? '—'}</td>
                  <td>{row.started_by ?? '—'}</td>
                  <td>
                    <span className={statusClass(row.status)}>{row.status}</span>
                    {row.error && <span className={s.errorText}> {row.error}</span>}
                  </td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
};
