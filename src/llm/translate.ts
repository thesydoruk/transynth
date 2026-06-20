/**
 * Structured JSON translation via LLM.
 *
 * Both the request payload and the model response use JSON. Placeholder tokens
 * (¤PH…¤, ¤GL…¤, ¤FK…¤) must already be applied by the caller.
 */
import { chatWithFallback } from './index';
import { buildEnglishTranslateSystemPrompt } from './prompts/en';
import { buildUkrainianTranslateSystemPrompt } from './prompts/uk';
import { log } from '../logger';
import type { GameType } from '../types';

/** Glossary entry included in the translation payload. */
export interface LlmGlossaryEntry {
  term: string;
  translation: string | null;
}

/** Retrieved few-shot example for LLM context (translation RAG). */
export interface LlmReferenceExample {
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  match_method: string;
  similarity: number;
}

/** One string row sent to the LLM (source text must already be masked). */
export interface LlmTranslateItem {
  id: number;
  source: string;
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
}

/** Parsed translation for one input item. */
export interface LlmTranslateResult {
  id: number;
  translation: string;
}

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
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianTranslateSystemPrompt(srcLang, game);
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
    mod_name: opts.modName ?? null,
    style_guide: opts.styleGuide?.slice(0, 4000) ?? '',
    glossary,
    items: opts.items.map((item) => ({
      id: item.id,
      source: item.source,
      grup: item.grup,
      edid: item.edid,
      field: item.field,
      form_id: item.form_id,
      context: item.context,
      ...(item.reference_examples && item.reference_examples.length > 0
        ? { reference_examples: item.reference_examples }
        : {}),
    })),
  };
};

const stripMarkdownFence = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
};

/**
 * Parse and validate the LLM JSON response.
 *
 * @throws When the payload is not valid JSON or does not contain all expected ids.
 */
export const parseLlmTranslateResponse = (
  raw: string,
  expectedIds: number[],
): LlmTranslateResult[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(raw));
  } catch {
    throw new Error('LLM response is not valid JSON');
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
    const row = entry as { id?: unknown; translation?: unknown };
    if (typeof row.id !== 'number' || !Number.isInteger(row.id)) continue;
    if (typeof row.translation !== 'string') continue;
    byId.set(row.id, row.translation);
  }

  const results: LlmTranslateResult[] = [];
  for (const id of expectedIds) {
    const translation = byId.get(id);
    if (translation === undefined) {
      throw new Error(`LLM response missing translation for id=${id}`);
    }
    results.push({ id, translation });
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
  log.debug(`translateStrings: ${opts.items.length} items, model=${opts.model}`);

  const payload = buildTranslateUserPayload(opts);
  const text = await chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: buildTranslateSystemPrompt(opts.srcLang, opts.targetLang, opts.game),
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ],
  });

  const results = parseLlmTranslateResponse(text, expectedIds);
  log.debug(`translateStrings: received ${results.length} translations`);
  return results;
};
