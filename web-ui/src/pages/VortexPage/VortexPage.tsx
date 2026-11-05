import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { useVortexPage } from './useVortexPage';
import { VortexAgentPanel } from './VortexAgentPanel';
import { VortexRunPanel } from './VortexRunPanel';
import s from './VortexPage.module.scss';

/**
 * The Vortex groups of a game: the resident agent's heartbeat, the stages the
 * user starts by hand, the live run and the langpack. Route: /games/:gameId/vortex.
 */
export const VortexPage = () => {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const p = useVortexPage(gameId);

  return (
    <div className={s.page}>
      <PageHeader
        title={t('vortex.title')}
        description={t('vortex.description')}
        actions={
          <Link to={`/games/${gameId}`} className={s.btnGhost}>
            {t('vortex.backToHub')}
          </Link>
        }
      />

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
            <VortexAgentPanel
              group={p.state.group}
              agent={p.state.agent}
              latestLangpack={p.state.latestLangpack}
              onDownload={() => void p.downloadLangpack()}
            />
            <VortexRunPanel
              run={p.run}
              runActive={p.runActive}
              history={p.history}
              canStart={p.canStart}
              onStart={(stage) => p.start(stage)}
              onStop={p.stop}
            />
          </div>
        )
      )}
    </div>
  );
};
