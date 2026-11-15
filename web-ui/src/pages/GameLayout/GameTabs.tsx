import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { useContentLangs } from '../../hooks/useContentLangs';
import { GAME_SECTIONS, routes, type GameSection } from '../../routes';
import s from './GameLayout.module.scss';

/** The game's sections as tabs; counts show only when there is something to count. */
export const GameTabs = ({ gameId }: { gameId: string }) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { srcLang, targetLang } = useContentLangs();
  const { data: reference } = useQuery({
    queryKey: ['reference', 'count', gameId, srcLang, targetLang],
    queryFn: () => api.reference.count(gameId, srcLang, targetLang),
  });
  const { data: vortex } = useQuery({
    queryKey: ['vortex-groups', gameId],
    queryFn: () => api.vortex.groups(gameId),
  });

  const counts: Partial<Record<GameSection, number>> = {
    reference: reference?.count,
    vortex: vortex?.groups.length,
  };

  // On a phone the tabs are a scrolling strip; the active one must be in it.
  const stripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [pathname]);

  return (
    <nav ref={stripRef} className={s.tabs} aria-label={t('gamePage.linksLabel')}>
      {GAME_SECTIONS.map((section) => {
        const count = counts[section];
        return (
          <NavLink
            key={section}
            to={routes.gameSection(gameId, section)}
            end={section === 'mods'}
            className={({ isActive }) => (isActive ? `${s.tab} ${s.tabActive}` : s.tab)}
          >
            {t(`gamePage.links.${section}`)}
            {count != null && count > 0 && <span className={s.tabCount}>{count}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
};
