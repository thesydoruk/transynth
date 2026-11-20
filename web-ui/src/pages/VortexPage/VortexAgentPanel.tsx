import { useTranslation } from 'react-i18next';
import { api, type VortexGroup, type VortexMachine } from '../../api';
import { Button } from '../../components/Button';
import { agentIsOffline } from './useVortexPage';
import s from './VortexPage.module.scss';

type Props = {
  group: VortexGroup;
  /** One machine of the group; null while no agent has reported yet. */
  machine: VortexMachine | null;
  /** Offered for an offline machine when the group has another one. */
  onForget?: (machine: VortexMachine) => void;
};

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : '—';

/**
 * One machine of the group: where its agent watches, what it holds, what it
 * waits for, what it last did, and the langpack made for it.
 */
export const VortexAgentPanel = ({ group, machine, onForget }: Props) => {
  const { t } = useTranslation();
  const offline = machine
    ? agentIsOffline(machine.last_seen_at, machine.state_json?.pollSec)
    : true;
  const pending = machine?.state_json?.pending ?? null;
  const delivered = machine?.state_json?.delivered ?? null;
  const langpack = machine?.latestLangpack ?? null;
  const titleId = `vortex-agent-title-${machine?.id ?? 'none'}`;

  return (
    <section className={s.panel} aria-labelledby={titleId}>
      <div className={s.panelHead}>
        <h2 id={titleId} className={s.panelTitle}>
          {machine ? machine.agent_key : t('vortex.agent.title')}
        </h2>
        {machine ? (
          <span className={offline ? s.badgeError : s.badgeOk}>
            {offline
              ? t('vortex.agent.offline')
              : t(`vortex.agent.states.${machine.state}`, machine.state)}
          </span>
        ) : (
          <span className={s.badgeMuted}>{t('vortex.agent.never')}</span>
        )}
      </div>
      <dl className={s.facts}>
        <dt>{t('vortex.agent.staging')}</dt>
        <dd className={s.mono}>{machine?.staging_path ?? group.staging_path ?? '—'}</dd>
        <dt>{t('vortex.agent.gameDir')}</dt>
        <dd className={s.mono}>{machine?.game_dir ?? group.game_dir ?? '—'}</dd>
        {machine && (
          <>
            <dt>{t('vortex.agent.mods')}</dt>
            <dd>{machine.mod_count ?? t('vortex.agent.modsUnknown')}</dd>
            {machine.game_version && (
              <>
                <dt>{t('vortex.agent.gameVersion')}</dt>
                <dd>{machine.game_version}</dd>
              </>
            )}
            {machine.agent_version && (
              <>
                <dt>{t('vortex.agent.version')}</dt>
                <dd>{machine.agent_version}</dd>
              </>
            )}
            <dt>{t('vortex.agent.lastSeen')}</dt>
            <dd>{when(machine.last_seen_at)}</dd>
            <dt>{t('vortex.agent.lastSync')}</dt>
            <dd>{when(machine.last_sync_at)}</dd>
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
            {machine.last_error && (
              <>
                <dt>{t('vortex.agent.lastError')}</dt>
                <dd className={s.errorText}>{machine.last_error}</dd>
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
          {langpack ? (
            <a
              className={s.linkButton}
              href={api.vortex.langpackUrl(langpack.runId)}
              download={langpack.fileName}
            >
              {langpack.fileName}
              {langpack.byteSize != null
                ? ` (${(langpack.byteSize / 1048576).toFixed(0)} MiB)`
                : ''}
            </a>
          ) : (
            t('vortex.langpack.none')
          )}
        </dd>
      </dl>
      {!machine && <p className={s.hint}>{t('vortex.agent.howToStart')}</p>}
      {machine && offline && onForget && (
        <div className={s.panelActions}>
          <Button variant="dangerGhost" size="sm" onClick={() => onForget(machine)}>
            {t('vortex.agent.forget')}
          </Button>
        </div>
      )}
    </section>
  );
};
