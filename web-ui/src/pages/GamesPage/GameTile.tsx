import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo } from '../../api';
import s from './GamesPage.module.scss';

interface GameTileProps {
  game: GameInfo;
}

/**
 * GameTile — a single game card in the catalogue grid.
 * Shows a skeleton while the cover image loads and an initials fallback on error.
 */
export const GameTile = ({ game }: GameTileProps) => {
  const { t } = useTranslation();
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const initials = game.name
    .split(' ')
    .filter((word) => /^[A-Z0-9]/i.test(word))
    .map((word) => word[0]!.toUpperCase())
    .slice(0, 3)
    .join('');

  return (
    <div className={s.tile}>
      <div className={s.cover}>
        {imgState === 'loading' && <div className={s.coverSkeleton} />}
        {imgState === 'error' && (
          <div className={s.coverFallback}>
            <span className={s.initials}>{initials}</span>
          </div>
        )}
        <img
          src={api.games.coverUrl(game.id)}
          alt={game.name}
          className={`${s.coverImg} ${imgState === 'loaded' ? s.coverImgVisible : ''}`}
          onLoad={() => setImgState('loaded')}
          onError={() => setImgState('error')}
          loading="lazy"
        />
      </div>

      <div className={s.body}>
        <div className={s.titleRow}>
          <span className={s.gameName}>{game.name}</span>
          <span className={s.year}>{game.releaseYear}</span>
        </div>
        <div className={s.developer}>{game.developer}</div>
        <div className={s.tags}>
          <span className={s.tag}>{game.engine}</span>
          <span className={`${s.tag} ${game.localized ? s.tagLocalized : s.tagInline}`}>
            {game.localized ? t('games.localizedPlugin') : t('games.inlinePlugin')}
          </span>
        </div>
        <div className={s.idRow}>
          <code className={s.gameId}>{game.id}</code>
        </div>
      </div>
    </div>
  );
};