/**
 * LLM translation quality audit — flags suspicious or incorrect translations.
 *
 * Request and response payloads are JSON-only.
 */
import { chatWithFallback } from './index';
import { buildUkrainianVerifySystemPrompt } from './prompts/uk';
import { isUkrainianTargetLang } from './translate';
import { log } from '../logger';
import type { GameType } from '../types';

export type LlmVerifyVerdict = 'ok' | 'suspicious' | 'incorrect';

/** One source/translation pair sent to the verifier. */
export interface LlmVerifyItem {
  id: number;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  context: string | null;
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
}

const VALID_VERDICTS = new Set<LlmVerifyVerdict>(['ok', 'suspicious', 'incorrect']);

export const VERIFY_TRANSLATE_SYSTEM_PROMPT = `You verify video game mod localization translations against their source strings.

Rules:
- You receive a JSON object and must respond with JSON only (no markdown, no prose outside JSON).
- source_language and target_language describe the language pair.
- Strings may contain game placeholders like ¤PH0¤, %1, {0}, HTML tags, or FormIDs — they must be preserved in the translation.
- For each item, set verdict to one of: "ok", "suspicious", "incorrect".
  - "ok": translation is accurate, natural, and appropriate for the context.
  - "suspicious": possible error, awkward phrasing, meaning drift, untranslated fragments, or minor issue worth human review.
  - "incorrect": clear error — wrong meaning, wrong language, copy of source when translation expected, broken placeholders, or nonsense.
- Include a short reason for every item (even ok).
- confidence is 0.0–1.0.
- For verdict "ok", set suggestion to null.
- For verdict "suspicious" or "incorrect", provide suggestion with an improved translation that fixes the issue while preserving all placeholders and markup.

Respond with this JSON shape:
{
  "items": [
    { "id": 1, "verdict": "ok", "reason": "Accurate translation.", "confidence": 0.95, "suggestion": null },
    { "id": 2, "verdict": "incorrect", "reason": "Wrong meaning.", "confidence": 0.9, "suggestion": "Corrected text here." }
  ]
}

Include one entry in "items" for every input id.`;

/** Pick the verify system prompt for the target language. */
export const buildVerifySystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  if (isUkrainianTargetLang(targetLang)) {
    return buildUkrainianVerifySystemPrompt(srcLang, game);
  }
  return VERIFY_TRANSLATE_SYSTEM_PROMPT;
};

export const buildVerifyTranslateUserPayload = (opts: Omit<LlmVerifyOptions, 'model'>): object => ({
  task: 'translation_quality_audit',
  source_language: opts.srcLang.trim().toLowerCase(),
  target_language: opts.targetLang.trim().toLowerCase(),
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  items: opts.items.map((item) => ({
    id: item.id,
    source: item.source,
    translation: item.translation,
    signature: item.signature,
    path: item.path,
    edid: item.edid,
    context: item.context,
  })),
});

const stripJsonFence = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
};

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

const parseSuggestion = (value: unknown, verdict: LlmVerifyVerdict): string | null => {
  if (verdict === 'ok') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

/**
 * Parse and validate the LLM JSON translation audit response.
 */
export const parseLlmVerifyTranslateResponse = (
  raw: string,
  expectedItemIds: number[],
): LlmVerifyItemResult[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    throw new Error('LLM verify response is not valid JSON');
  }

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
    if (typeof row.id !== 'number' || !Number.isInteger(row.id)) continue;
    const verdict = parseVerdict(row.verdict);
    byId.set(row.id, {
      id: row.id,
      verdict,
      reason:
        typeof row.reason === 'string' && row.reason.trim()
          ? row.reason.trim()
          : 'No reason provided.',
      confidence: clampConfidence(row.confidence),
      suggestion: parseSuggestion(row.suggestion, verdict),
    });
  }

  const items: LlmVerifyItemResult[] = [];
  for (const id of expectedItemIds) {
    const row = byId.get(id);
    if (!row) {
      throw new Error(`LLM verify response missing item id=${id}`);
    }
    items.push(row);
  }

  return items;
};

/** Run translation quality audit on a batch of items via LLM (JSON in/out). */
export const verifyTranslationsWithLlm = async (
  opts: LlmVerifyOptions,
): Promise<LlmVerifyItemResult[]> => {
  if (opts.items.length === 0) return [];

  const expectedIds = opts.items.map((item) => item.id);
  log.debug(
    `verifyTranslationsWithLlm: mod=${opts.modName ?? '?'}, items=${opts.items.length}, ${opts.srcLang}->${opts.targetLang}`,
  );

  const payload = buildVerifyTranslateUserPayload(opts);
  const text = await chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: buildVerifySystemPrompt(opts.srcLang, opts.targetLang, opts.game),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });

  return parseLlmVerifyTranslateResponse(text, expectedIds);
};
