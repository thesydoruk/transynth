import type { GameType } from '../../types';
import type { GlossaryEntry } from './types';
import { FO3_UK_GLOSSARY } from './fo3-uk';
import { FO4_UK_GLOSSARY } from './fo4-uk';
import { FO76_UK_GLOSSARY } from './fo76-uk';
import { FNV_UK_GLOSSARY } from './fnv-uk';
import { MW_UK_GLOSSARY } from './mw-uk';
import { OB_UK_GLOSSARY } from './ob-uk';
import { SSE_UK_GLOSSARY } from './sse-uk';

export type { GlossaryEntry } from './types';

/** Canonical EN→UK terminology per game for prompts and glossary seeding. */
export const GAME_UK_GLOSSARIES: Record<GameType, GlossaryEntry[]> = {
  fo4: FO4_UK_GLOSSARY,
  fo76: FO76_UK_GLOSSARY,
  fo3: FO3_UK_GLOSSARY,
  fnv: FNV_UK_GLOSSARY,
  ob: OB_UK_GLOSSARY,
  mw: MW_UK_GLOSSARY,
  sse: SSE_UK_GLOSSARY,
  sle: SSE_UK_GLOSSARY,
};

export const getGameUkGlossary = (game: GameType): GlossaryEntry[] => GAME_UK_GLOSSARIES[game];
