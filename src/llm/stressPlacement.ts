import { chatWithFallback } from './index';
import { parseLlmJson } from './jsonParse';
import { buildStressPlaceResponseFormat } from './responseSchemas';
import {
  buildStressPlacementSystemPrompt,
  buildStressPlacementUserPayload,
} from './prompts/stressPlacement';
import type { ChatCompletionMeta } from './provider';
import { parseVerifyItemId } from './verifyTranslate';
import { stripStressMarks } from '../voice/stressedTranslation';

export class LlmStressPlacementMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmStressWordResult[];

  constructor(missingIds: number[], partialResults: LlmStressWordResult[]) {
    super(`LLM stress-place response missing word id=${missingIds[0]}`);
    this.name = 'LlmStressPlacementMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmStressPlacementMissingIdsError = (
  err: unknown,
): err is LlmStressPlacementMissingIdsError => err instanceof LlmStressPlacementMissingIdsError;

/** One word that dictionary could not resolve (OOV / heteronym). */
export type LlmStressWordItem = {
  id: number;
  word: string;
  /** Full dialogue line for disambiguation. */
  context: string;
  /** 0-based letter-token index in `context`. */
  wordIndex: number;
};

export type LlmStressWordResult = {
  id: number;
  word_stressed: string;
};

export type LlmStressPlacementOptions = {
  words: LlmStressWordItem[];
  model: string;
  targetLang: string;
  signal?: AbortSignal;
  enableThinking?: boolean;
};

/** vLLM Gemma4 body fields that activate reasoning for a single request. */
export const stressPlaceThinkingExtraBody = {
  chat_template_kwargs: { enable_thinking: true },
} as const;

const parseItems = (
  raw: string,
  expectedIds: number[],
  expectedById: ReadonlyMap<number, LlmStressWordItem>,
  completionMeta?: ChatCompletionMeta,
): Map<number, LlmStressWordResult> => {
  const parsed = parseLlmJson(raw, {
    operation: 'stress_place',
    itemIds: expectedIds,
    itemCount: expectedIds.length,
    finishReason: completionMeta?.finishReason,
    completionTokens: completionMeta?.completionTokens,
  }) as { items?: unknown };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const out = new Map<number, LlmStressWordResult>();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const id = parseVerifyItemId((entry as { id?: unknown }).id);
    const text = (entry as { word_stressed?: unknown }).word_stressed;
    if (id == null || typeof text !== 'string' || !text.trim()) continue;
    const expected = expectedById.get(id);
    if (!expected) continue;
    const stressed = text.trim().normalize('NFC');
    if (stripStressMarks(stressed) !== expected.word.normalize('NFC')) continue;
    if (!stressed.includes('\u0301')) continue;
    out.set(id, { id, word_stressed: stressed });
  }
  return out;
};

/** Ask the LLM to stress only unresolved words (dictionary OOV / heteronyms). */
export const detectUnresolvedWordStressWithLlm = async (
  opts: LlmStressPlacementOptions,
): Promise<LlmStressWordResult[]> => {
  if (opts.words.length === 0) return [];
  const expectedIds = opts.words.map((item) => item.id);
  const expectedById = new Map(opts.words.map((item) => [item.id, item]));
  const { content, meta } = await chatWithFallback({
    model: opts.model,
    messages: [
      { role: 'system', content: buildStressPlacementSystemPrompt(opts.targetLang) },
      { role: 'user', content: buildStressPlacementUserPayload(opts.words) },
    ],
    responseFormat: buildStressPlaceResponseFormat(expectedIds.length),
    signal: opts.signal,
    ...(opts.enableThinking ? { extraBody: { ...stressPlaceThinkingExtraBody } } : {}),
    logMeta: { operation: 'stress_place' },
  });

  const byId = parseItems(content, expectedIds, expectedById, meta);
  const results: LlmStressWordResult[] = [];
  const missing: number[] = [];
  for (const id of expectedIds) {
    const hit = byId.get(id);
    if (!hit) missing.push(id);
    else results.push(hit);
  }
  if (missing.length > 0) {
    throw new LlmStressPlacementMissingIdsError(missing, results);
  }
  return results;
};
