import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GameInfo, NexusModItem } from '../../api';
import s from './GameModsPage.module.scss';

interface ModTileProps {
  game: GameInfo;
  mod: NexusModItem;
}

/** Renders one NexusMods search result card with thumbnail fallback handling. */
export const ModTile = ({ game, mod }: ModTileProps) => {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const imageUrl = mod.thumbnailUrl || mod.pictureUrl;
  const modUrl = `https://www.nexusmods.com/${game.domainName}/mods/${mod.modId}`;

  return (
    <article className={s.card}>
      <div className={s.imageWrap}>
        {!imgError && imageUrl ? (
          <img
            className={s.image}
            src={imageUrl}
            alt={mod.name}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className={s.imageFallback}>{mod.name.slice(0, 2).toUpperCase()}</div>
        )}
      </div>

      <div className={s.cardBody}>
        <h3 className={s.modName}>
          <Link to={`/games/${game.id}/nexus/${mod.modId}`} className={s.cardLink}>
            {mod.name}
          </Link>
        </h3>
        <p className={s.summary}>{mod.summary || t('games.noSummary')}</p>

        <div className={s.meta}>
          <span className={s.metaChip}>{t('games.downloads', { count: mod.downloads.toLocaleString() })}</span>
          <span className={s.metaChip}>{t('games.endorsements', { count: mod.endorsements.toLocaleString() })}</span>
        </div>

        <div className={s.footer}>
          <span className={s.author}>{mod.author || t('games.unknownAuthor')}</span>
          <a className={s.openLink} href={modUrl} target="_blank" rel="noreferrer">
            {t('games.openOnNexus')}
          </a>
        </div>
      </div>
    </article>
  );
};