import type { GameType } from '../../types';
import { FO3_UK_TRANSLATE_PROMPT } from './games/fo3/translate';
import { FO3_UK_VERIFY_PROMPT } from './games/fo3/verify';
import { FO4_UK_TRANSLATE_PROMPT } from './games/fo4/translate';
import { FO4_UK_VERIFY_PROMPT } from './games/fo4/verify';
import { FO76_UK_TRANSLATE_PROMPT } from './games/fo76/translate';
import { FO76_UK_VERIFY_PROMPT } from './games/fo76/verify';
import { FNV_UK_TRANSLATE_PROMPT } from './games/fnv/translate';
import { FNV_UK_VERIFY_PROMPT } from './games/fnv/verify';
import { MW_UK_TRANSLATE_PROMPT } from './games/mw/translate';
import { MW_UK_VERIFY_PROMPT } from './games/mw/verify';
import { OB_UK_TRANSLATE_PROMPT } from './games/ob/translate';
import { OB_UK_VERIFY_PROMPT } from './games/ob/verify';
import { resolveGameType } from './resolveGame';
import { SSE_UK_TRANSLATE_PROMPT } from './games/sse/translate';
import { SSE_UK_VERIFY_PROMPT } from './games/sse/verify';
import { DISCO_UK_TRANSLATE_PROMPT } from './games/disco/translate';
import { DISCO_UK_VERIFY_PROMPT } from './games/disco/verify';

const UK_TRANSLATE_PROMPTS: Record<GameType, string> = {
  fo4: FO4_UK_TRANSLATE_PROMPT,
  fo76: FO76_UK_TRANSLATE_PROMPT,
  fo3: FO3_UK_TRANSLATE_PROMPT,
  fnv: FNV_UK_TRANSLATE_PROMPT,
  ob: OB_UK_TRANSLATE_PROMPT,
  mw: MW_UK_TRANSLATE_PROMPT,
  sse: SSE_UK_TRANSLATE_PROMPT,
  sle: SSE_UK_TRANSLATE_PROMPT,
  disco: DISCO_UK_TRANSLATE_PROMPT,
};

const UK_VERIFY_PROMPTS: Record<GameType, string> = {
  fo4: FO4_UK_VERIFY_PROMPT,
  fo76: FO76_UK_VERIFY_PROMPT,
  fo3: FO3_UK_VERIFY_PROMPT,
  fnv: FNV_UK_VERIFY_PROMPT,
  ob: OB_UK_VERIFY_PROMPT,
  mw: MW_UK_VERIFY_PROMPT,
  sse: SSE_UK_VERIFY_PROMPT,
  sle: SSE_UK_VERIFY_PROMPT,
  disco: DISCO_UK_VERIFY_PROMPT,
};

/** System prompt for Ukrainian game localization (per-game standalone prompts). */
export const buildUkrainianTranslateSystemPrompt = (
  _srcLang: string,
  game?: GameType | string | null,
): string => UK_TRANSLATE_PROMPTS[resolveGameType(game)];

/** System prompt for Ukrainian localization quality audit (per-game standalone prompts). */
export const buildUkrainianVerifySystemPrompt = (
  _srcLang: string,
  game?: GameType | string | null,
): string => UK_VERIFY_PROMPTS[resolveGameType(game)];
