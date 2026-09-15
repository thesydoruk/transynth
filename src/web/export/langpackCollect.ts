import type { Tx } from '../../db';
import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import type { GameId } from '../../types';
import type { ZipPackEntry } from './exportTypes';

/**
 * Collect the loose localization files for one mod (no ZIP, no per-mod folder).
 *
 * What counts as "localized output" is entirely the game's business — string
 * tables and a patched plugin for Creation Engine, language folders of `.po`
 * and `.wav` for Disco Elysium. An empty result means the mod has nothing
 * exportable yet; callers decide whether that is an error.
 */
export const collectLangpackEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameId = DEFAULT_GAME_ID,
): Promise<ZipPackEntry[]> =>
  gamePlugin(game).export.collectLangpackEntries({ db, modId, modPath, srcLang, targetLang });
