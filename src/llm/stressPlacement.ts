import { chatWithFallback } from './index';
import { parseLlmJson } from './jsonParse';
import { buildStressPlaceResponseFormat } from './responseSchemas';
import {
  buildStressPlacementSystemPrompt,
  buildStressPlacementUserPayload,
} from './prompts/stressPlacement';
import type { ChatCompletionMeta } from './provider';
import { parseVerifyItemId } from './verifyTranslate';

export class LlmStressPlacementMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmStressPlacementResult[];

  constructor(missingIds: number[], partialResults: LlmStressPlacementResult[]) {
    super(`LLM stress-place response missing item id=${missingIds[0]}`);
    this.name = 'LlmStressPlacementMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmStressPlacementMissingIdsError = (
  err: unknown,
): err is LlmStressPlacementMissingIdsError => err instanceof LlmStressPlacementMissingIdsError;

export type LlmStressPlacementItem = {
  id: number;
  text: string;
};

export type LlmStressPlacementResult = {
  id: number;
  text_stressed: string;
};

export type LlmStressPlacementOptions = {
  items: LlmStressPlacementItem[];
  model: string;
  targetLang: string;
  signal?: AbortSignal;
  /** When true, ask vLLM/Gemma to run thinking mode for this call. */
  enableThinking?: boolean;
};

/** vLLM Gemma4 body fields that activate reasoning for a single request. */
export const stressPlaceThinkingExtraBody = {
  chat_template_kwargs: { enable_thinking: true },
} as const;

const parseItems = (
  raw: string,
  expectedIds: number[],
  completionMeta?: ChatCompletionMeta,
): Map<number, LlmStressPlacementResult> => {
  const parsed = parseLlmJson(raw, {
    operation: 'stress_place',
    itemIds: expectedIds,
    itemCount: expectedIds.length,
    finishReason: completionMeta?.finishReason,
    completionTokens: completionMeta?.completionTokens,
  }) as { items?: unknown };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const out = new Map<number, LlmStressPlacementResult>();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const id = parseVerifyItemId((entry as { id?: unknown }).id);
    const text = (entry as { text_stressed?: unknown }).text_stressed;
    if (id == null || typeof text !== 'string' || !text.trim()) continue;
    out.set(id, { id, text_stressed: text.trim() });
  }
  return out;
};

export const detectStressPlacementWithLlm = async (
  opts: LlmStressPlacementOptions,
): Promise<LlmStressPlacementResult[]> => {
  const expectedIds = opts.items.map((item) => item.id);
  const { content, meta } = await chatWithFallback({
    model: opts.model,
    messages: [
      { role: 'system', content: buildStressPlacementSystemPrompt(opts.targetLang) },
      { role: 'user', content: buildStressPlacementUserPayload(opts.items) },
    ],
    responseFormat: buildStressPlaceResponseFormat(expectedIds.length),
    signal: opts.signal,
    ...(opts.enableThinking ? { extraBody: { ...stressPlaceThinkingExtraBody } } : {}),
    logMeta: { operation: 'stress_place' },
  });

  const byId = parseItems(content, expectedIds, meta);
  const results: LlmStressPlacementResult[] = [];
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
