import s from './GameTile.module.scss';

/**
 * SkeletonGameTile — shimmer placeholder shown in the games grid
 * while the /api/games list is loading.
 */
export const SkeletonGameTile = () => <div className={`${s.tile} ${s.skeleton}`} />;
