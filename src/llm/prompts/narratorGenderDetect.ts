import type { GameType } from '../../types';
import { maskLlmTextFields } from '../llmTextMask';
import { gameLabel } from './gameLabel';

export type NarratorGenderDetectPromptItem = {
  id: number;
  source_excerpt: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  path: string | null;
};

export type NarratorGenderDetectUserPayloadOpts = {
  items: NarratorGenderDetectPromptItem[];
  srcLang: string;
  game?: GameType | string | null;
  modName?: string | null;
};

/** System prompt for BOOK/TERM/NOTE narrator gender pre-pass. */
export const buildNarratorGenderSystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game, 'Bethesda');

  return [
    `You detect the grammatical gender of the narrator in ${title} source text (${srcLang}).`,
    'Output is used for Ukrainian translation: first-person verbs and adjectives must agree with narrator gender.',
    '',
    '### INPUT:',
    '- Each item is one record (book page, terminal entry, note) with source_excerpt (may be truncated).',
    '- grup/edid/field/path give Creation Kit context.',
    '',
    '### narrator_gender values:',
    '- "male": first-person narrator is grammatically male (he/his in source, male diary voice).',
    '- "female": first-person narrator is grammatically female (she/her, female diary voice).',
    '- "neutral": third-person only, impersonal, or no gendered first-person (signs, ads, logs).',
    '- "unknown": ambiguous — do not guess from stereotypes.',
    '',
    '### RULES:',
    '- Judge from source text and edid; English often hides gender — use body references, names, pronouns.',
    '- Personal diaries in first person ("I", "my") usually need male or female, not neutral.',
    '- When truly unclear, return "unknown" with low confidence.',
    '- Output valid JSON only.',
  ].join('\n');
};

/** User JSON payload for narrator gender detection batches. */
export const buildNarratorGenderUserPayload = (
  opts: NarratorGenderDetectUserPayloadOpts,
): object => ({
  task: 'narrator_gender_detect',
  source_language: opts.srcLang.trim().toLowerCase(),
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  items: opts.items.map((item) => {
    const { masked } = maskLlmTextFields([item.source_excerpt]);
    return {
      id: item.id,
      source_excerpt: masked[0] ?? item.source_excerpt,
      grup: item.grup,
      edid: item.edid,
      field: item.field,
      path: item.path,
    };
  }),
});
