import { useTranslation } from 'react-i18next';
import { api, type VortexAgent, type VortexGroup, type VortexLatestLangpack } from '../../api';
import { agentIsOffline } from './useVortexPage';
import s from './VortexPage.module.scss';

type Props = {
  group: VortexGroup;
  agent: VortexAgent | null;
  latestLangpack: VortexLatestLangpack | null;
};

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : '—';

/** The resident agent's heartbeat: where it watches, what it waits for, what it last did. */
export const VortexAgentPanel = ({ group, agent, latestLangpack }: Props) => {
  const { t } = useTranslation();
  const offline = agent ? agentIsOffline(agent.last_seen_at, agent.state_json?.pollSec) : true;
  const pending = agent?.state_json?.pending ?? null;
  const delivered = agent?.state_json?.delivered ?? null;

  return (
    <section className={s.panel} aria-labelledby="vortex-agent-title">
      <div className={s.panelHead}>
        <h2 id="vortex-agent-title" className={s.panelTitle}>
          {t('vortex.agent.title')}
        </h2>
        {agent ? (
          <span className={offline ? s.badgeError : s.badgeOk}>
            {offline
              ? t('vortex.agent.offline')
              : t(`vortex.agent.states.${agent.state}`, agent.state)}
          </span>
        ) : (
          <span className={s.badgeMuted}>{t('vortex.agent.never')}</span>
        )}
      </div>
      <dl className={s.facts}>
        <dt>{t('vortex.agent.staging')}</dt>
        <dd className={s.mono}>{group.staging_path ?? '—'}</dd>
        <dt>{t('vortex.agent.gameDir')}</dt>
        <dd className={s.mono}>{group.game_dir ?? '—'}</dd>
        {agent && (
          <>
            <dt>{t('vortex.agent.machine')}</dt>
            <dd>
              {agent.agent_key}
              {agent.agent_version ? ` · ${agent.agent_version}` : ''}
            </dd>
            <dt>{t('vortex.agent.lastSeen')}</dt>
            <dd>{when(agent.last_seen_at)}</dd>
            <dt>{t('vortex.agent.lastSync')}</dt>
            <dd>{when(agent.last_sync_at)}</dd>
            {pending && (
              <>
                <dt>{t('vortex.agent.pending')}</dt>
                <dd>
                  {pending.orderChanged
                    ? t('vortex.agent.pendingOrder')
                    : t('vortex.agent.pendingUnits')}
                  {pending.settleUntil
                    ? ` · ${t('vortex.agent.settleUntil', { when: when(pending.settleUntil) })}`
                    : ''}
                </dd>
              </>
            )}
            {agent.last_error && (
              <>
                <dt>{t('vortex.agent.lastError')}</dt>
                <dd className={s.errorText}>{agent.last_error}</dd>
              </>
            )}
            {delivered && (
              <>
                <dt>{t('vortex.agent.delivered')}</dt>
                <dd>
                  {delivered.fileName} · {when(delivered.at)}
                </dd>
              </>
            )}
          </>
        )}
        <dt>{t('vortex.langpack.latest')}</dt>
        <dd>
          {latestLangpack ? (
            <a
              className={s.linkButton}
              href={api.vortex.langpackUrl(latestLangpack.runId)}
              download={latestLangpack.fileName}
            >
              {latestLangpack.fileName}
              {latestLangpack.byteSize != null
                ? ` (${(latestLangpack.byteSize / 1048576).toFixed(0)} MiB)`
                : ''}
            </a>
          ) : (
            t('vortex.langpack.none')
          )}
        </dd>
      </dl>
      {!agent && <p className={s.hint}>{t('vortex.agent.howToStart')}</p>}
    </section>
  );
};
