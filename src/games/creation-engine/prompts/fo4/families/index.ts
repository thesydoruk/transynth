import type { LlmPromptFamily } from '../../../../../llm/promptFamily';
import { FO4_UK_DIALOG_TRANSLATE_PROMPT, FO4_UK_DIALOG_VERIFY_PROMPT } from './dialog';
import { FO4_UK_ITEM_TRANSLATE_PROMPT, FO4_UK_ITEM_VERIFY_PROMPT } from './item';
import { FO4_UK_PROSE_TRANSLATE_PROMPT, FO4_UK_PROSE_VERIFY_PROMPT } from './prose';
import { FO4_UK_QUEST_TRANSLATE_PROMPT, FO4_UK_QUEST_VERIFY_PROMPT } from './quest';
import { FO4_UK_MCM_TRANSLATE_PROMPT, FO4_UK_MCM_VERIFY_PROMPT } from './mcm';
import { FO4_UK_FACE_TRANSLATE_PROMPT, FO4_UK_FACE_VERIFY_PROMPT } from './face';

const FO4_UK_FAMILY_TRANSLATE: Record<Exclude<LlmPromptFamily, 'default'>, string> = {
  dialog: FO4_UK_DIALOG_TRANSLATE_PROMPT,
  item: FO4_UK_ITEM_TRANSLATE_PROMPT,
  prose: FO4_UK_PROSE_TRANSLATE_PROMPT,
  quest: FO4_UK_QUEST_TRANSLATE_PROMPT,
  mcm: FO4_UK_MCM_TRANSLATE_PROMPT,
  face: FO4_UK_FACE_TRANSLATE_PROMPT,
};

const FO4_UK_FAMILY_VERIFY: Record<Exclude<LlmPromptFamily, 'default'>, string> = {
  dialog: FO4_UK_DIALOG_VERIFY_PROMPT,
  item: FO4_UK_ITEM_VERIFY_PROMPT,
  prose: FO4_UK_PROSE_VERIFY_PROMPT,
  quest: FO4_UK_QUEST_VERIFY_PROMPT,
  mcm: FO4_UK_MCM_VERIFY_PROMPT,
  face: FO4_UK_FACE_VERIFY_PROMPT,
};

export const fo4UkTranslatePrompt = (family: LlmPromptFamily = 'item'): string =>
  family === 'default' ? FO4_UK_ITEM_TRANSLATE_PROMPT : FO4_UK_FAMILY_TRANSLATE[family];

export const fo4UkVerifyPrompt = (family: LlmPromptFamily = 'item'): string =>
  family === 'default' ? FO4_UK_ITEM_VERIFY_PROMPT : FO4_UK_FAMILY_VERIFY[family];
