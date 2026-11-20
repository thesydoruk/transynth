import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { VortexMachine } from '../../api';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PageHeader } from '../../components/PageHeader';
import { useVortexPage } from './useVortexPage';
import { VortexAgentPanel } from './VortexAgentPanel';
import { VortexRunPanel } from './VortexRunPanel';
import s from './VortexPage.module.scss';

/**
 * The Vortex groups of a game: the machines that sync into the group, each
 * with its agent's heartbeat and its langpack, the stages the user starts by
 * hand, and the live run. Route: /games/:gameId/vortex.
 */
export const VortexPage = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const p = useVortexPage(gameId);
  const [forgetting, setForgetting] = useState<VortexMachine | null>(null);

  return (
    <div className={s.page}>
      <PageHeader title={t('vortex.title')} description={t('vortex.description')} />

      {p.groups.length > 1 && (
        <label className={s.filterLabel}>
          {t('vortex.group')}
          <select
            className={s.select}
            value={p.groupId ?? ''}
            onChange={(e) => p.setGroupId(Number(e.target.value))}
          >
            {p.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {p.error && (
        <div className={s.errorBar} role="alert">
          {p.error}
          <button type="button" className={s.linkButton} onClick={p.clearError}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {p.isLoading ? (
        <p className={s.muted}>{t('common.loading')}</p>
      ) : p.groups.length === 0 ? (
        <section className={s.panel}>
          <h2 className={s.panelTitle}>{t('vortex.empty.title')}</h2>
          <p className={s.hint}>{t('vortex.empty.body')}</p>
          <pre className={s.code}>{t('vortex.empty.command')}</pre>
        </section>
      ) : (
        p.state && (
          <div className={s.grid}>
            <div className={s.machines}>
              {p.machines.length === 0 ? (
                <VortexAgentPanel group={p.state.group} machine={null} />
              ) : (
                p.machines.map((machine) => (
                  <VortexAgentPanel
                    key={machine.id}
                    group={p.state!.group}
                    machine={machine}
                    onForget={p.machines.length > 1 ? setForgetting : undefined}
                  />
                ))
              )}
            </div>
            <VortexRunPanel
              run={p.run}
              runActive={p.runActive}
              history={p.history}
              machines={p.machines}
              machineId={p.machineId}
              onMachine={p.setMachineId}
              canStart={p.canStart}
              onStart={(stage) => p.start(stage)}
              onStop={p.stop}
            />
          </div>
        )
      )}

      {forgetting && (
        <ConfirmModal
          title={t('vortex.agent.forgetTitle', { name: forgetting.agent_key })}
          message={t('vortex.agent.forgetMessage')}
          confirmLabel={t('vortex.agent.forgetConfirm')}
          pending={p.forgetting}
          onConfirm={() => {
            void p.forget(forgetting.id).finally(() => setForgetting(null));
          }}
          onClose={() => setForgetting(null)}
        />
      )}
    </div>
  );
};
