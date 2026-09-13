/**
 * Structured JSON translation via LLM.
 *
 * Both the request payload and the model response use JSON. Placeholder tokens
 * (¤PH…¤, ¤GL…¤, ¤FK…¤) must already be applied to source by the caller;
 * context and reference_examples are masked at send time when not pre-masked.
 */
import { CONFIG } from '../config';
import { chatWithFallback } from './index';
import {
  parseLlmItemId,
  parseLlmJson,
  tryParseLlmJson,
  isJsonUnterminatedAtEnd,
  trySalvageTruncatedTranslateJson,
} from './jsonParse';
import { participantPayloadFields, type LlmDialogParticipants } from './dialogParticipants';
import { compactLlmItemFields, compactLlmReferenceExamples } from './llmPayloadCompact';
import { buildEnglishTranslateSystemPrompt } from './prompts/en';
import { buildUkrainianTranslateSystemPrompt } from './prompts/uk';
import type { ChatCompletionMeta } from './provider';
import { buildTranslateResponseFormat } from './responseSchemas';
import type { GameType } from '../types';
import { resolveBatchPromptFamily, type LlmPromptFamily } from './promptFamily';
import { recastFo4UkDialogTranslations } from './dialogRecast';
import { dialogScenePayload, type DialogSceneContext } from './dialogScene';
import {
  assembleTranslatedText,
  compactLlmPartsFields,
  type LlmSlotHint,
  type LlmTextPart,
  type LlmTextSlot,
} from './textParts';

export type { LlmDialogParticipants, LlmParticipantGender } from './dialogParticipants';

/** Glossary entry included in the translation payload. */
export interface LlmGlossaryEntry {
  term: string;
  translation: string | null;
}

/** Retrieved few-shot example for LLM context (translation RAG). */
export interface LlmReferenceExample {
  source: string;
  translation: string;
  parts?: LlmTextPart[];
  translation_parts?: LlmTextPart[];
  slots?: LlmSlotHint[];
  grup: string | null;
  edid: string | null;
  field: string | null;
  match_method: string;
  similarity: number;
}

/** One string row sent to the LLM (source text must already be masked). */
export interface LlmTranslateItem extends LlmDialogParticipants {
  id: number;
  source: string;
  /** Translatable fragments + integer slot ids. Preferred over inline ¤PH¤ masks. */
  parts?: LlmTextPart[];
  /** Slot kinds only — raw tokens stay in {@link restoreSlots}. */
  slots?: LlmSlotHint[];
  /** Local restore table; never sent to the LLM. */
  restoreSlots?: LlmTextSlot[];
  /** Source parts used to validate the model's slot multiset. */
  sourceParts?: LlmTextPart[];
  grup: string | null;
  edid: string | null;
  field: string | null;
  form_id: string | null;
  context: string | null;
  reference_examples?: LlmReferenceExample[];
}

/** Options for {@link translateStrings}. */
export interface LlmTranslateOptions {
  items: LlmTranslateItem[];
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameType | string | null;
  modName?: string | null;
  glossary?: LlmGlossaryEntry[];
  styleGuide?: string;
  /** FO4 text family; inferred from item grup/field when omitted. */
  promptFamily?: LlmPromptFamily;
  /** Spoken scene window for the dialog family (neighbors + order). */
  dialogScene?: DialogSceneContext;
  /** Skip the FO4 UK dialog gender/register editor pass. */
  skipDialogRecast?: boolean;
  /** Aborts the in-flight LLM request when the owning job is stopped. */
  signal?: AbortSignal;
}

/** Parsed translation for one input item. */
export interface LlmTranslateResult {
  id: number;
  translation: string;
}

/** Thrown when the model hits max_tokens before completing the JSON batch response. */
export class LlmResponseTruncatedError extends Error {
  readonly finishReason = 'length';

  constructor(message: string) {
    super(message);
    this.name = 'LlmResponseTruncatedError';
  }
}

export const isLlmResponseTruncatedError = (err: unknown): err is LlmResponseTruncatedError =>
  err instanceof LlmResponseTruncatedError;

/** Some ids parsed; others missing from the model JSON — caller may persist partial results. */
export class LlmTranslateMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmTranslateResult[];

  constructor(missingIds: number[], partialResults: LlmTranslateResult[]) {
    super(`LLM response missing translation for id=${missingIds[0]}`);
    this.name = 'LlmTranslateMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmTranslateMissingIdsError = (err: unknown): err is LlmTranslateMissingIdsError =>
  err instanceof LlmTranslateMissingIdsError;

/** Language codes that select the dedicated Ukrainian system prompt. */
export const isUkrainianTargetLang = (targetLang: string): boolean => {
  const norm = targetLang.trim().toLowerCase();
  return norm === 'uk' || norm === 'ua' || norm === 'ukr' || norm === 'ukrainian';
};

/** System prompt instructing the model to consume and emit JSON. */
export const buildTranslateSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
  family?: LlmPromptFamily | null,
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianTranslateSystemPrompt(srcLang, game, family);
  }

  return buildEnglishTranslateSystemPrompt(srcLang, targetLang, game);
};

/** User message payload sent to the LLM. */
export const buildTranslateUserPayload = (opts: Omit<LlmTranslateOptions, 'model'>): object => {
  const glossary = (opts.glossary ?? [])
    .filter((g) => g.term.trim() !== '')
    .slice(0, 100)
    .map((g) => (g.translation ? { term: g.term, translation: g.translation } : { term: g.term }));

  return {
    source_language: opts.srcLang,
    target_language: opts.targetLang,
    game: opts.game ?? null,
    ...(opts.modName?.trim() ? { mod_name: opts.modName } : {}),
    ...(opts.styleGuide?.trim() ? { style_guide: opts.styleGuide.slice(0, 4000) } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(opts.dialogScene ? { dialog_scene: dialogScenePayload(opts.dialogScene) } : {}),
    items: opts.items.map((item) => {
      const structured = compactLlmPartsFields(item.parts, item.slots);
      return {
        id: item.id,
        ...(structured.parts ? structured : { source: item.source }),
        ...compactLlmItemFields(item),
        ...participantPayloadFields(item),
        ...compactLlmReferenceExamples(item.reference_examples),
      };
    }),
  };
};

const assembleItemTranslation = (
  id: number,
  rawParts: unknown,
  rawTranslation: unknown,
  requestItems?: readonly LlmTranslateItem[],
): string | null => {
  const request = requestItems?.find((item) => item.id === id);
  return assembleTranslatedText(
    rawParts,
    rawTranslation,
    request?.sourceParts,
    request?.restoreSlots,
  );
};

/**
 * Parse and validate the LLM JSON response.
 *
 * @throws When the payload is not valid JSON or does not contain all expected ids.
 */
export const parseLlmTranslateResponse = (
  raw: string,
  expectedIds: number[],
  completionMeta?: ChatCompletionMeta,
  requestItems?: readonly LlmTranslateItem[],
): LlmTranslateResult[] => {
  let parsed: unknown = tryParseLlmJson(raw);
  if (parsed === undefined && expectedIds.length === 1) {
    parsed = trySalvageTruncatedTranslateJson(raw, expectedIds[0]);
  }
  if (parsed === undefined) {
    try {
      parsed = parseLlmJson(raw, {
        operation: 'translate',
        itemIds: expectedIds,
        itemCount: expectedIds.length,
        finishReason: completionMeta?.finishReason,
        completionTokens: completionMeta?.completionTokens,
      });
    } catch (err) {
      if (expectedIds.length === 1 && isJsonUnterminatedAtEnd(err, raw.length)) {
        throw new LlmResponseTruncatedError(
          `LLM translate JSON truncated (${raw.length} chars, id=${expectedIds[0]})`,
        );
      }
      throw err;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM response must be a JSON object');
  }

  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    throw new Error('LLM response must contain an "items" array');
  }

  const byId = new Map<number, string>();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; translation?: unknown; parts?: unknown };
    const id = parseLlmItemId(row.id);
    if (id == null) continue;
    const assembled = assembleItemTranslation(id, row.parts, row.translation, requestItems);
    if (assembled == null) continue;
    byId.set(id, assembled);
  }

  const results: LlmTranslateResult[] = [];
  const missingIds: number[] = [];
  for (const id of expectedIds) {
    const translation = byId.get(id);
    // Blank output for a non-empty source is never a valid translation —
    // route it through the missing-ids solo retry instead of persisting it.
    if (translation === undefined || translation.trim() === '') {
      missingIds.push(id);
      continue;
    }
    results.push({ id, translation });
  }

  if (missingIds.length > 0) {
    throw new LlmTranslateMissingIdsError(missingIds, results);
  }

  return results;
};

/**
 * Translate structured items in a single LLM call.
 *
 * @returns Translations in the same order as {@link LlmTranslateOptions.items}.
 */
export const translateStrings = async (
  opts: LlmTranslateOptions,
): Promise<LlmTranslateResult[]> => {
  if (opts.items.length === 0) return [];

  const expectedIds = opts.items.map((item) => item.id);
  const family = resolveBatchPromptFamily(opts.game, opts.items, opts.promptFamily);
  const systemPrompt = buildTranslateSystemPrompt(opts.srcLang, opts.targetLang, opts.game, family);
  const payload = buildTranslateUserPayload(opts);

  const { content: text, meta } = await chatWithFallback({
    model: opts.model,
    responseFormat: buildTranslateResponseFormat(expectedIds.length),
    signal: opts.signal,
    logMeta: {
      operation: 'translate',
      context: {
        itemIds: expectedIds,
        itemCount: expectedIds.length,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        game: opts.game ?? null,
        modName: opts.modName ?? null,
        glossaryCount: opts.glossary?.length ?? 0,
        ragExampleCounts: opts.items.map((item) => item.reference_examples?.length ?? 0),
      },
    },
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ],
  });

  if (!text.trim()) {
    throw new Error('LLM returned empty response');
  }

  if (meta.finishReason === 'length') {
    throw new LlmResponseTruncatedError(
      `LLM response truncated at ${meta.completionTokens ?? '?'} completion tokens (max ${CONFIG.llmMaxTokens})`,
    );
  }

  const draft = parseLlmTranslateResponse(text, expectedIds, meta, opts.items);
  return recastFo4UkDialogTranslations(opts, draft);
};
