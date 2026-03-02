import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import s from '../SettingsPage.module.scss';

/** Users tab displayed only when the backend enables multi-user mode. */
export const UsersTab = () => {
  const { t } = useTranslation();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 30_000 });

  return (
    <div className={s.section}>
      <h2 className={s.sectionTitle}>{t('settings.users.title')}</h2>
      <div className={s.linkCards}>
        <Link to="/users" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.users.manage')}</span>
          <span className={s.linkCardDesc}>{t('settings.users.manageDesc')}</span>
          {users != null && <span className={s.linkCardBadge}>{t('settings.users.userCount', { count: users.length })}</span>}
        </Link>
      </div>
    </div>
  );
};
