/**
 * Which archive container a Creation Engine title uses, and the file names the
 * Creation Kit would give it.
 *
 * Fallout 4 and 76 pack assets into BA2; every earlier title uses BSA, whose
 * header version differs between Skyrim SE (105, LZ4) and the rest (104, zlib).
 */
import { defaultArchiveFileName as archiveFileName } from '../../formats/ba2';
import type { GameId } from '../../types';
import { creationEngineTitle } from './registry';

/** True when the title packs assets into BA2 rather than BSA. */
export const usesBa2Archives = (game: GameId): boolean =>
  creationEngineTitle(game).archive.kind === 'ba2';

/** Container this title's archives are written as. */
export const archiveKindForGame = (game: GameId): 'ba2' | 'bsa' =>
  creationEngineTitle(game).archive.kind;

/** BSA header version to write. Meaningless for BA2 titles. */
export const bsaVersionForGame = (game: GameId): number =>
  creationEngineTitle(game).archive.bsaVersion;

/** Archive file name the Creation Kit would produce for a plugin's strings. */
export const defaultArchiveFileName = (pluginStem: string, game: GameId): string =>
  archiveFileName(pluginStem, archiveKindForGame(game));
