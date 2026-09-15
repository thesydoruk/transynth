import type { GameId } from '../../types';
import { findGamePlugin } from '../../games/registry';

/**
 * Human-readable game title for localization prompts.
 *
 * An unregistered id is echoed back rather than replaced, so a prompt built
 * for a game the app no longer ships still names the right thing.
 */
export const gameLabel = (
  game: GameId | string | null | undefined,
  fallback = 'Bethesda game',
): string => {
  if (game == null || game === '') return fallback;
  return findGamePlugin(game)?.prompts.label ?? game;
};
