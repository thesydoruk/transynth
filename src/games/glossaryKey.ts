/**
 * Which game's stored rows a title reads and writes.
 *
 * Editions that ship the same text share a term list and a QA rule set rather
 * than duplicating them — Skyrim LE reads Skyrim SE's glossary, Fallout 76
 * reads Fallout 4's QA rules.
 */
import type { GameId } from '../types';
import { gamePlugin } from './registry';

/** Glossary storage key for a game id. */
export const glossaryGameKey = (game?: GameId | string | null): GameId =>
  gamePlugin(game).storageKeys.glossary;

/** QA rule storage key for a game id. */
export const qaRuleGameKey = (game?: GameId | string | null): GameId =>
  gamePlugin(game).storageKeys.qaRules;
