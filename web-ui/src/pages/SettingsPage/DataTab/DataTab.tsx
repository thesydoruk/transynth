import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import s from '../SettingsPage.module.scss';

/** Data management tab with jump links to glossary and rule pages. */
export const DataTab = () => {
  const { t } = useTranslation();
  const { data: qaRules } = useQuery({ queryKey: ['qaRules'], queryFn: () => api.qaRules.list(), staleTime: 30_000 });
  const { data: tradRules } = useQuery({ queryKey: ['tradAuto'], queryFn: () => api.tradAuto.list(), staleTime: 30_000 });
  const { data: glossary } = useQuery({ queryKey: ['glossary'], queryFn: () => api.glossary.list(), staleTime: 30_000 });

  return (
    <div className={s.section}>
      <h2 className={s.sectionTitle}>{t('settings.data.title')}</h2>
      <p className={s.fieldNote}>{t('settings.data.desc')}</p>
      <br />
      <div className={s.linkCards}>
        <Link to="/qa-rules" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.qaRules')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.qaRulesDesc')}</span>
          {qaRules != null && <span className={s.linkCardBadge}>{t('settings.data.ruleCount', { count: qaRules.length })}</span>}
        </Link>
        <Link to="/tradauto" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.tradAuto')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.tradAutoDesc')}</span>
          {tradRules != null && <span className={s.linkCardBadge}>{t('settings.data.ruleCount', { count: tradRules.length })}</span>}
        </Link>
        <Link to="/glossary" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.glossary')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.glossaryDesc')}</span>
          {glossary != null && <span className={s.linkCardBadge}>{t('settings.data.termCount', { count: glossary.length })}</span>}
        </Link>
      </div>
    </div>
  );
};
