import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type GameInfo, type Mod } from '../../../api';
import { summarizeContent, type ContentSummary } from '../modsView';
import s from './GameHeader.module.scss';

type GameHeaderProps = {
  game: GameInfo;
  /** Every mod of the game, unfiltered. */
  mods: Mod[];
};

type StatGroupProps = {
  label: string;
  summary: ContentSummary;
  showCount?: boolean;
  format: (value: number) => string;
};

const StatGroup = ({ label, summary, showCount, format }: StatGroupProps) => {
  const { t } = useTranslation();
  return (
    <li className={s.statGroup}>
      <span className={s.statLabel}>{label}</span>
      {showCount && <span>{t('gamePage.modCount', { count: summary.count })}</span>}
      <span>{t('gamePage.strings', { value: format(summary.strings) })}</span>
      <span>{t('gamePage.translated', { value: summary.translatedPct })}</span>
      <span>{t('gamePage.approved', { value: summary.approvedPct })}</span>
    </li>
  );
};

/** Back link, cover, name and meta, then totals for the game and DLC and for mods. */
export const GameHeader = ({ game, mods }: GameHeaderProps) => {
  const { t, i18n } = useTranslation();
  const summary = useMemo(() => summarizeContent(mods), [mods]);
  const format = useMemo(() => {
    const fmt = new Intl.NumberFormat(i18n.language || 'uk-UA', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    });
    return (value: number) => fmt.format(value);
  }, [i18n.language]);

  return (
    <header className={s.header}>
      <Link to="/" className={s.backLink}>
        {t('games.backToGames')}
      </Link>
      <div className={s.identity}>
        <img src={api.games.coverUrl(game.id)} alt="" className={s.cover} loading="lazy" />
        <div className={s.identityText}>
          <h1 className={s.name}>{game.name}</h1>
          <p className={s.meta}>
            {game.developer} &middot; {game.releaseYear} &middot; {game.engine}
          </p>
        </div>
      </div>
      {(summary.game || summary.mods) && (
        <ul className={s.stats}>
          {summary.game && (
            <StatGroup label={t('gamePage.gameContent')} summary={summary.game} format={format} />
          )}
          {summary.mods && (
            <StatGroup
              label={t('gamePage.modsGroup')}
              summary={summary.mods}
              format={format}
              showCount
            />
          )}
        </ul>
      )}
    </header>
  );
};
