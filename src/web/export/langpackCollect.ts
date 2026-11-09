import type { Tx } from '../../db';
import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import type { GameId } from '../../types';
import { listDubbedVideos } from '../../video/db';
import type { ZipPackEntry } from './exportTypes';

/**
 * The mod's dubbed cutscenes, laid out as the mod manager deploys them
 * (`Video/<file>` for a Bethesda title). They ship in the langpack next to the
 * text and voice, so one archive carries the whole localization.
 */
const collectVideoEntries = async (
  db: Tx,
  modId: number,
  game: GameId,
): Promise<ZipPackEntry[]> => {
  const media = gamePlugin(game).media;
  if (!media) return [];
  return (await listDubbedVideos(db, modId)).map(({ asset, file }) => ({
    name: `${media.packDir}/${asset.file_name}`,
    absPath: file,
  }));
};

/**
 * Collect the loose localization files for one mod (no ZIP, no per-mod folder).
 *
 * What counts as "localized output" is entirely the game's business — string
 * tables and a patched plugin for Creation Engine, language folders of `.po`
 * and `.wav` for Disco Elysium — plus the dubbed videos of a game with media.
 * An empty result means the mod has nothing exportable yet; callers decide
 * whether that is an error.
 */
export const collectLangpackEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameId = DEFAULT_GAME_ID,
): Promise<ZipPackEntry[]> => [
  ...(await gamePlugin(game).export.collectLangpackEntries({
    db,
    modId,
    modPath,
    srcLang,
    targetLang,
  })),
  ...(await collectVideoEntries(db, modId, game)),
];
