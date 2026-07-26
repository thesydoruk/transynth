/**
 * LLM narrator gender detection for BOOK/TERM/NOTE records.
 */
import { chatWithFallback } from './index';
import { maskLlmTextFields } from './llmTextMask';
import { parseLlmJson } from './jsonParse';
import { buildNarratorGenderDetectResponseFormat } from './responseSchemas';
import type { ChatCompletionMeta } from './provider';
import type { GameType } from '../types';
import { parseVerifyItemId } from './verifyTranslate';
import { parseNarratorGender, type NarratorGender } from '../dialog/narratorGender';

export class LlmNarratorGenderMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmNarratorGenderResult[];

  constructor(missingIds: number[], partialResults: LlmNarratorGenderResult[]) {
    super(`LLM gender-detect response missing item id=${missingIds[0]}`);
    this.name = 'LlmNarratorGenderMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmNarratorGenderMissingIdsError = (
  err: unknown,
): err is LlmNarratorGenderMissingIdsError => err instanceof LlmNarratorGenderMissingIdsError;

export type LlmNarratorGenderItem = {
  id: number;
  source_excerpt: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  path: string | null;
};

export type LlmNarratorGenderResult = {
  id: number;
  narrator_gender: NarratorGender;
  reason: string;
  confidence: number;
};

export type LlmNarratorGenderOptions = {
  items: LlmNarratorGenderItem[];
  model: string;
  srcLang: string;
  game?: GameType | string | null;
  modName?: string | null;
  signal?: AbortSignal;
};

const VALID_GENDERS = new Set<NarratorGender>(['male', 'female', 'neutral', 'unknown']);

const clampConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export const buildNarratorGenderSystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = game ? `${game} / Bethesda` : 'Bethesda';
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

export const buildNarratorGenderUserPayload = (
  opts: Omit<LlmNarratorGenderOptions, 'model'>,
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

const parseGenderItems = (
  raw: string,
  expectedIds: number[],
  completionMeta?: ChatCompletionMeta,
): Map<number, LlmNarratorGenderResult> => {
  const parsed = parseLlmJson(raw, {
    operation: 'gender_detect',
    itemIds: expectedIds,
    itemCount: expectedIds.length,
    finishReason: completionMeta?.finishReason,
    completionTokens: completionMeta?.completionTokens,
  });

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM gender-detect response must be a JSON object');
  }

  const rawItems = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) {
    throw new Error('LLM gender-detect response must contain an "items" array');
  }

  const byId = new Map<number, LlmNarratorGenderResult>();
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = parseVerifyItemId(row.id);
    if (id == null) continue;
    const genderRaw = parseNarratorGender(row.narrator_gender);
    const gender = VALID_GENDERS.has(genderRaw) ? genderRaw : 'unknown';
    byId.set(id, {
      id,
      narrator_gender: gender,
      reason:
        typeof row.reason === 'string' && row.reason.trim()
          ? row.reason.trim()
          : `Detected ${gender}.`,
      confidence: clampConfidence(row.confidence),
    });
  }
  return byId;
};

/** Run LLM gender detection on one batch. */
export const detectNarratorGenderWithLlm = async (
  opts: LlmNarratorGenderOptions,
): Promise<LlmNarratorGenderResult[]> => {
  if (opts.items.length === 0) return [];

  const expectedIds = opts.items.map((item) => item.id);
  const payload = buildNarratorGenderUserPayload(opts);
  const raw = await chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: buildNarratorGenderDetectResponseFormat(expectedIds.length),
    signal: opts.signal,
    logMeta: {
      operation: 'gender_detect',
      context: { itemIds: expectedIds, itemCount: expectedIds.length, srcLang: opts.srcLang },
    },
    messages: [
      { role: 'system', content: buildNarratorGenderSystemPrompt(opts.srcLang, opts.game) },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });

  if (!raw.content.trim()) throw new Error('LLM returned empty response');

  const parsed = parseGenderItems(raw.content, expectedIds, raw.meta);
  const results: LlmNarratorGenderResult[] = [];
  const missingIds: number[] = [];

  for (const item of opts.items) {
    const row = parsed.get(item.id);
    if (!row) {
      missingIds.push(item.id);
      continue;
    }
    results.push(row);
  }

  if (missingIds.length > 0) {
    throw new LlmNarratorGenderMissingIdsError(missingIds, results);
  }

  return results;
};
