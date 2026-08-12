import type { GameType } from '../../types';

const GAME_LABELS: Record<GameType, string> = {
  fo4: 'Fallout 4',
  fo76: 'Fallout 76',
  fo3: 'Fallout 3',
  fnv: 'Fallout: New Vegas',
  ob: 'The Elder Scrolls IV: Oblivion',
  mw: 'The Elder Scrolls III: Morrowind',
  sse: 'Skyrim Special Edition',
  sle: 'Skyrim Legendary Edition',
  disco: 'Disco Elysium',
};

const isGameType = (value: string | null | undefined): value is GameType => {
  return value != null && value in GAME_LABELS;
};

/** Human-readable game title for localization prompts. */
export const gameLabel = (
  game: GameType | string | null | undefined,
  fallback = 'Bethesda game',
): string => {
  if (game == null || game === '') return fallback;
  if (isGameType(game)) return GAME_LABELS[game];
  return game;
};
