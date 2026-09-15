/**
 * LLM translation quality audit — flags suspicious or incorrect translations.
 *
 * Request and response payloads are JSON-only.
 */
import { chatWithFallback } from './index';
import { participantPayloadFields } from './dialogParticipants';
import { compactLlmItemFields, compactLlmReferenceExamples } from './llmPayloadCompact';
import { assembleTranslatedText, compactLlmPartsFields } from './textParts';
import { parseLlmJson } from './jsonParse';
import { buildEnglishVerifySystemPrompt } from './prompts/en';
import { buildUkrainianVerifySystemPrompt } from './prompts/uk';
import { resolveBatchPromptFamily, type LlmPromptFamily } from './promptFamily';
import { dialogScenePayload } from './dialogScene';
import type { ChatCompletionMeta } from './provider';
import { buildVerifyResponseFormat } from './responseSchemas';
import { isUkrainianTargetLang, LlmResponseTruncatedError } from './translate';
import type { GameId } from '../types';
import { CONFIG } from '../config';
import { parseVerifySuggestionValue } from './verifySuggestionGuards';
import {
  finalizeVerifyItemResults,
  maskVerifyItemForLlm,
  unmaskVerifySuggestions,
} from './verifyItemFinalize';
import {
  LlmVerifyMissingIdsError,
  parseVerifyItemId,
  type LlmVerifyItem,
  type LlmVerifyItemResult,
  type LlmVerifyOptions,
  type LlmVerifyVerdict,
} from './verifyTranslateTypes';

export type {
  LlmVerifyItem,
  LlmVerifyItemResult,
  LlmVerifyOptions,
  LlmVerifyVerdict,
  VerifyDefectKind,
} from './verifyTranslateTypes';
export {
  LlmVerifyMissingIdsError,
  isBlockingVerifyResult,
  isLlmVerifyMissingIdsError,
  parseVerifyItemId,
} from './verifyTranslateTypes';
export {
  applyPlaceholderGuardToVerifyResult,
  finalizeVerifyItemResults,
  maskVerifyItemForLlm,
} from './verifyItemFinalize';

const VALID_VERDICTS = new Set<LlmVerifyVerdict>(['ok', 'suspicious', 'incorrect']);

/** Pick the verify system prompt for the target language. */
export const buildVerifySystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameId | string | null,
  family?: LlmPromptFamily | null,
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianVerifySystemPrompt(srcLang, game, family);
  }
  return buildEnglishVerifySystemPrompt(srcLang, targetLang, game);
};

export const buildVerifyTranslateUserPayload = (opts: Omit<LlmVerifyOptions, 'model'>): object => ({
  task: 'translation_quality_audit',
  source_language: opts.srcLang.trim().toLowerCase(),
  target_language: opts.targetLang.trim().toLowerCase(),
  game: opts.game ?? null,
  ...(opts.modName?.trim() ? { mod_name: opts.modName } : {}),
  ...(opts.glossary && opts.glossary.length > 0 ? { glossary: opts.glossary } : {}),
  ...(opts.dialogScene ? { dialog_scene: dialogScenePayload(opts.dialogScene) } : {}),
  items: opts.items.map((item) => {
    const structured = compactLlmPartsFields(item.parts, item.slots);
    return {
      id: item.id,
      ...(structured.parts
        ? {
            ...structured,
            ...(item.translation_parts && item.translation_parts.length > 0
              ? { translation_parts: item.translation_parts }
              : { translation: item.translation }),
          }
        : { source: item.source, translation: item.translation }),
      ...compactLlmItemFields(item),
      ...participantPayloadFields(item),
      ...compactLlmReferenceExamples(item.reference_examples),
    };
  }),
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

const parseSuggestion = (
  value: unknown,
  verdict: LlmVerifyVerdict,
  item?: LlmVerifyItem,
): string | null => {
  const assembled = assembleTranslatedText(
    Array.isArray(value) ? value : undefined,
    typeof value === 'string' ? value : undefined,
    item?.sourceParts,
    item?.restoreSlots,
  );
  return parseVerifySuggestionValue(assembled, verdict);
};

const parseVerifyItemsFromRaw = (
  raw: string,
  expectedIds?: number[],
  completionMeta?: ChatCompletionMeta,
  requestItems?: readonly LlmVerifyItem[],
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
      suggestion: parseSuggestion(
        row.suggestion,
        verdict,
        requestItems?.find((item) => item.id === id),
      ),
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
        content: buildVerifySystemPrompt(
          opts.srcLang,
          opts.targetLang,
          opts.game,
          resolveBatchPromptFamily(opts.game, items, opts.promptFamily),
        ),
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
  requestItems?: readonly LlmVerifyItem[],
): LlmVerifyItemResult[] => {
  const byId = parseVerifyItemsFromRaw(raw, expectedItemIds, completionMeta, requestItems);

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
    const masked = maskVerifyItemForLlm(item, opts.game);
    mappingById.set(item.id, masked.mapping);
    return masked.item;
  });

  const expectedIds = opts.items.map((item) => item.id);
  const { content: raw, meta } = await callVerifyTranslateLlm(opts, maskedItems);

  if (meta.finishReason === 'length') {
    throw new LlmResponseTruncatedError(
      `LLM verify response truncated at ${meta.completionTokens ?? '?'} completion tokens (max ${CONFIG.llmMaxTokens})`,
    );
  }

  const parsed = parseLlmVerifyTranslateResponse(raw, expectedIds, meta, maskedItems);
  const unmasked = unmaskVerifySuggestions(parsed, mappingById);
  return finalizeVerifyItemResults(opts.items, unmasked, opts.game, opts.targetLang);
};
