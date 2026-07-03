/**
 * LLM translation quality audit — flags suspicious or incorrect translations.
 *
 * Request and response payloads are JSON-only.
 */
import { chatWithFallback } from './index';
import { parseLlmJson } from './jsonParse';
import { buildEnglishVerifySystemPrompt } from './prompts/en';
import { buildUkrainianVerifySystemPrompt } from './prompts/uk';
import type { ChatCompletionMeta } from './provider';
import { buildVerifyResponseFormat } from './responseSchemas';
import { isUkrainianTargetLang, type LlmReferenceExample } from './translate';
import type { GameType } from '../types';
import { compareProtectedTokens } from '../utils/placeholders';
import { maskLlmTextFields, unmaskLlmText } from './llmTextMask';
import {
  reconcileVerifyResult,
  parseVerifySuggestionValue,
  applyCorruptedTranslationGuard,
} from './verifySuggestionGuards';
import type { LlmGlossaryEntry } from './translate';

export type LlmVerifyVerdict = 'ok' | 'suspicious' | 'incorrect';

/** One source/translation pair sent to the verifier. */
export interface LlmVerifyItem {
  id: number;
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  context: string | null;
  reference_examples?: LlmReferenceExample[];
}

/** Per-item audit result returned by the LLM. */
export interface LlmVerifyItemResult {
  id: number;
  verdict: LlmVerifyVerdict;
  reason: string;
  confidence: number;
  /** Improved translation when verdict is suspicious or incorrect; null for ok. */
  suggestion: string | null;
}

export interface LlmVerifyOptions {
  items: LlmVerifyItem[];
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameType | string | null;
  modName?: string | null;
  /** Per-batch glossary terms (same filtering as translate). */
  glossary?: LlmGlossaryEntry[];
  /** Aborts the in-flight LLM request when the owning job is stopped. */
  signal?: AbortSignal;
}

const VALID_VERDICTS = new Set<LlmVerifyVerdict>(['ok', 'suspicious', 'incorrect']);

/** Some ids parsed; others missing from the model JSON — caller may persist partial results. */
export class LlmVerifyMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmVerifyItemResult[];

  constructor(missingIds: number[], partialResults: LlmVerifyItemResult[]) {
    super(`LLM verify response missing item id=${missingIds[0]}`);
    this.name = 'LlmVerifyMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmVerifyMissingIdsError = (err: unknown): err is LlmVerifyMissingIdsError =>
  err instanceof LlmVerifyMissingIdsError;

/** Mask text fields sent to the verify LLM; keeps raw items for post-audit guards. */
export const maskVerifyItemForLlm = (
  item: LlmVerifyItem,
): { item: LlmVerifyItem; mapping: Record<string, string> } => {
  const fields: Array<string | null | undefined> = [item.source, item.translation];
  for (const ref of item.reference_examples ?? []) {
    fields.push(ref.source, ref.translation);
  }
  if (item.context != null) fields.push(item.context);

  const { masked, mapping } = maskLlmTextFields(fields, { reuseKeysForIdenticalTokens: true });
  let idx = 0;
  const take = (): string => masked[idx++] as string;

  return {
    mapping,
    item: {
      ...item,
      source: take(),
      translation: take(),
      reference_examples: item.reference_examples?.map((ref) => ({
        ...ref,
        source: take(),
        translation: take(),
      })),
      context: item.context != null ? take() : item.context,
    },
  };
};

const unmaskVerifySuggestions = (
  results: LlmVerifyItemResult[],
  mappingById: Map<number, Record<string, string>>,
): LlmVerifyItemResult[] =>
  results.map((result) => {
    if (!result.suggestion) return result;
    const mapping = mappingById.get(result.id);
    if (!mapping || Object.keys(mapping).length === 0) return result;
    return { ...result, suggestion: unmaskLlmText(result.suggestion, mapping) };
  });

/** Apply placeholder guard and suggestion reconciliation to parsed LLM rows. */
export const finalizeVerifyItemResults = (
  items: LlmVerifyItem[],
  parsed: LlmVerifyItemResult[],
  game?: GameType | string | null,
): LlmVerifyItemResult[] => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return parsed.map((result) => {
    const item = itemById.get(result.id);
    if (!item) return result;
    const guarded = applyPlaceholderGuardToVerifyResult(item, result, game);
    const cleaned = applyCorruptedTranslationGuard(item, guarded);
    return reconcileVerifyResult(item, cleaned);
  });
};

/** Upgrade LLM ok → incorrect only when protected tokens are broken in the translation. */
export const applyPlaceholderGuardToVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
  game?: GameType | string | null,
): LlmVerifyItemResult => {
  const check = compareProtectedTokens(
    item.source,
    item.translation,
    game as GameType | undefined,
    { grup: item.grup, field: item.field },
  );
  if (check.ok) return result;

  if (result.verdict === 'ok') {
    return {
      id: result.id,
      verdict: 'incorrect',
      reason: check.message,
      confidence: Math.max(result.confidence, 0.95),
      suggestion: result.suggestion,
    };
  }

  if (!result.reason.includes('Protected token mismatch')) {
    return {
      ...result,
      reason: `${result.reason} ${check.message}`,
    };
  }

  return result;
};

/** @deprecated Use {@link buildEnglishVerifySystemPrompt} or {@link buildVerifySystemPrompt}. */
export const VERIFY_TRANSLATE_SYSTEM_PROMPT = buildEnglishVerifySystemPrompt('en', 'de');

/** Pick the verify system prompt for the target language. */
export const buildVerifySystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianVerifySystemPrompt(srcLang, game);
  }
  return buildEnglishVerifySystemPrompt(srcLang, targetLang, game);
};

export const buildVerifyTranslateUserPayload = (opts: Omit<LlmVerifyOptions, 'model'>): object => ({
  task: 'translation_quality_audit',
  source_language: opts.srcLang.trim().toLowerCase(),
  target_language: opts.targetLang.trim().toLowerCase(),
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  ...(opts.glossary && opts.glossary.length > 0 ? { glossary: opts.glossary } : {}),
  items: opts.items.map((item) => ({
    id: item.id,
    source: item.source,
    translation: item.translation,
    grup: item.grup,
    edid: item.edid,
    field: item.field,
    context: item.context,
    ...(item.reference_examples && item.reference_examples.length > 0
      ? { reference_examples: item.reference_examples }
      : {}),
  })),
});

const clampConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const parseVerdict = (value: unknown): LlmVerifyVerdict => {
  if (typeof value === 'string' && VALID_VERDICTS.has(value as LlmVerifyVerdict)) {
    return value as LlmVerifyVerdict;
  }
  return 'suspicious';
};

const parseSuggestion = (value: unknown, verdict: LlmVerifyVerdict): string | null =>
  parseVerifySuggestionValue(value, verdict);

/** Accept integer ids returned as JSON numbers or numeric strings. */
export const parseVerifyItemId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const parseVerifyItemsFromRaw = (
  raw: string,
  expectedIds?: number[],
  completionMeta?: ChatCompletionMeta,
): Map<number, LlmVerifyItemResult> => {
  const parsed = parseLlmJson(raw, {
    operation: 'verify',
    ...(expectedIds
      ? {
          itemIds: expectedIds,
          itemCount: expectedIds.length,
          finishReason: completionMeta?.finishReason,
          completionTokens: completionMeta?.completionTokens,
        }
      : {}),
  });

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM verify response must be a JSON object');
  }

  const body = parsed as Record<string, unknown>;
  const rawItems = body.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('LLM verify response must contain an "items" array');
  }

  const byId = new Map<number, LlmVerifyItemResult>();
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = parseVerifyItemId(row.id);
    if (id == null) continue;
    const verdict = parseVerdict(row.verdict);
    byId.set(id, {
      id,
      verdict,
      reason:
        typeof row.reason === 'string' && row.reason.trim()
          ? row.reason.trim()
          : 'No reason provided.',
      confidence: clampConfidence(row.confidence),
      suggestion: parseSuggestion(row.suggestion, verdict),
    });
  }

  return byId;
};

const callVerifyTranslateLlm = async (opts: LlmVerifyOptions, items: LlmVerifyItem[]) => {
  const expectedIds = items.map((item) => item.id);
  const payload = buildVerifyTranslateUserPayload({ ...opts, items });
  return chatWithFallback({
    model: opts.model,
    responseFormat: buildVerifyResponseFormat(expectedIds.length),
    signal: opts.signal,
    logMeta: {
      operation: 'verify_translate',
      context: {
        itemIds: expectedIds,
        itemCount: expectedIds.length,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        modName: opts.modName ?? null,
        ragExampleCounts: items.map((item) => item.reference_examples?.length ?? 0),
      },
    },
    messages: [
      {
        role: 'system',
        content: buildVerifySystemPrompt(opts.srcLang, opts.targetLang, opts.game),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });
};

/**
 * Parse and validate the LLM JSON translation audit response.
 */
export const parseLlmVerifyTranslateResponse = (
  raw: string,
  expectedItemIds: number[],
  completionMeta?: ChatCompletionMeta,
): LlmVerifyItemResult[] => {
  const byId = parseVerifyItemsFromRaw(raw, expectedItemIds, completionMeta);

  const items: LlmVerifyItemResult[] = [];
  const missingIds: number[] = [];
  for (const id of expectedItemIds) {
    const row = byId.get(id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    items.push(row);
  }

  if (missingIds.length > 0) {
    throw new LlmVerifyMissingIdsError(missingIds, items);
  }

  return items;
};

/** Run translation quality audit on a batch of items via LLM (JSON in/out). */
export const verifyTranslationsWithLlm = async (
  opts: LlmVerifyOptions,
): Promise<LlmVerifyItemResult[]> => {
  if (opts.items.length === 0) return [];

  const mappingById = new Map<number, Record<string, string>>();
  const maskedItems = opts.items.map((item) => {
    const masked = maskVerifyItemForLlm(item);
    mappingById.set(item.id, masked.mapping);
    return masked.item;
  });

  const expectedIds = opts.items.map((item) => item.id);
  const { content: raw, meta } = await callVerifyTranslateLlm(opts, maskedItems);
  const parsed = parseLlmVerifyTranslateResponse(raw, expectedIds, meta);
  const unmasked = unmaskVerifySuggestions(parsed, mappingById);
  return finalizeVerifyItemResults(opts.items, unmasked, opts.game);
};
