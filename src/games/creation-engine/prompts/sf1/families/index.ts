import type { LlmPromptFamily } from '../../../../../llm/promptFamily';
import { SF1_UK_DIALOG_TRANSLATE_PROMPT, SF1_UK_DIALOG_VERIFY_PROMPT } from './dialog';
import { SF1_UK_FACE_TRANSLATE_PROMPT, SF1_UK_FACE_VERIFY_PROMPT } from './face';
import { SF1_UK_ITEM_TRANSLATE_PROMPT, SF1_UK_ITEM_VERIFY_PROMPT } from './item';
import { SF1_UK_PROSE_TRANSLATE_PROMPT, SF1_UK_PROSE_VERIFY_PROMPT } from './prose';
import { SF1_UK_QUEST_TRANSLATE_PROMPT, SF1_UK_QUEST_VERIFY_PROMPT } from './quest';

/** The kinds of text `resolveSf1PromptFamily` tells apart. */
export type Sf1PromptFamily = 'dialog' | 'prose' | 'quest' | 'item' | 'face';

export const SF1_PROMPT_FAMILIES: readonly Sf1PromptFamily[] = [
  'dialog',
  'prose',
  'quest',
  'item',
  'face',
];

const SF1_UK_FAMILY_TRANSLATE: Record<Sf1PromptFamily, string> = {
  dialog: SF1_UK_DIALOG_TRANSLATE_PROMPT,
  prose: SF1_UK_PROSE_TRANSLATE_PROMPT,
  quest: SF1_UK_QUEST_TRANSLATE_PROMPT,
  item: SF1_UK_ITEM_TRANSLATE_PROMPT,
  face: SF1_UK_FACE_TRANSLATE_PROMPT,
};

const SF1_UK_FAMILY_VERIFY: Record<Sf1PromptFamily, string> = {
  dialog: SF1_UK_DIALOG_VERIFY_PROMPT,
  prose: SF1_UK_PROSE_VERIFY_PROMPT,
  quest: SF1_UK_QUEST_VERIFY_PROMPT,
  item: SF1_UK_ITEM_VERIFY_PROMPT,
  face: SF1_UK_FACE_VERIFY_PROMPT,
};

/** Starfield has no MCM; that family and a mixed batch read as names and UI. */
const sf1Family = (family: LlmPromptFamily): Sf1PromptFamily =>
  family === 'default' || family === 'mcm' ? 'item' : family;

export const sf1UkTranslatePrompt = (family: LlmPromptFamily = 'item'): string =>
  SF1_UK_FAMILY_TRANSLATE[sf1Family(family)];

export const sf1UkVerifyPrompt = (family: LlmPromptFamily = 'item'): string =>
  SF1_UK_FAMILY_VERIFY[sf1Family(family)];
