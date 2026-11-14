import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import s from './GameHeader.module.scss';

type GameLinksProps = {
  gameId: string;
  srcLang: string;
  targetLang: string;
};

/** Links to the game's other pages; counts show only when there is something to count. */
export const GameLinks = ({ gameId, srcLang, targetLang }: GameLinksProps) => {
  const { t } = useTranslation();
  const { data: reference } = useQuery({
    queryKey: ['reference', 'count', gameId, srcLang, targetLang],
    queryFn: () => api.reference.count(gameId, srcLang, targetLang),
  });
  const { data: vortex } = useQuery({
    queryKey: ['vortex-groups', gameId],
    queryFn: () => api.vortex.groups(gameId),
  });

  const links: Array<{ to: string; label: string; count?: number }> = [
    { to: `/games/${gameId}/nexus`, label: t('gamePage.links.nexus') },
    { to: `/games/${gameId}/coherence`, label: t('gamePage.links.coherence') },
    { to: `/games/${gameId}/diff`, label: t('gamePage.links.diff') },
    {
      to: `/games/${gameId}/reference`,
      label: t('gamePage.links.reference'),
      count: reference?.count,
    },
    {
      to: `/games/${gameId}/vortex`,
      label: t('gamePage.links.vortex'),
      count: vortex?.groups.length,
    },
    { to: '/glossary', label: t('gamePage.links.glossary') },
    { to: '/settings?tab=voice', label: t('gamePage.links.voice') },
  ];

  return (
    <nav className={s.links} aria-label={t('gamePage.linksLabel')}>
      {links.map(({ to, label, count }) => (
        <Link key={to} to={to} className={s.link}>
          {label}
          {count != null && count > 0 && <span className={s.linkCount}>{count}</span>}
        </Link>
      ))}
    </nav>
  );
};
