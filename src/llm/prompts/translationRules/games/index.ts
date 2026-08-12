import type { GameType } from '../../../../types';
import type { GameRules } from '../types';
import { fo3Rules } from './fo3';
import { fo4Rules } from './fo4';
import { fo76Rules } from './fo76';
import { fnvRules } from './fnv';
import { mwRules } from './mw';
import { obRules } from './ob';
import { sleRules } from './sle';
import { sseRules } from './sse';
import { discoRules } from './disco';

export const GAME_RULES: Record<GameType, GameRules> = {
  fo4: fo4Rules,
  fo76: fo76Rules,
  fo3: fo3Rules,
  fnv: fnvRules,
  ob: obRules,
  mw: mwRules,
  sse: sseRules,
  sle: sleRules,
  disco: discoRules,
};
