/**
 * Detect whether imported mod strings match the expected source locale (LLM audit).
 *
 * Request and response payloads are JSON-only.
 */
import { MCM_LOCALE_ALIASES } from '../bethesda/parsers/mcmDiscovery';
import { chatWithFallback } from './index';
import type { GameType } from '../types';

/** Bethesda / project locale codes the LLM may return. */
export const LOCALE_DETECT_ALLOWED_LANGS = [...MCM_LOCALE_ALIASES.keys()].sort();

/** One string row sent to the locale auditor. */
export interface LlmLocaleDetectSample {
  id: number;
  text: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
}

export type LocaleDetectVerdict = 'match' | 'mismatch' | 'mixed' | 'uncertain';

/** Per-sample language guess returned by the LLM. */
export interface LlmLocaleDetectSampleResult {
  id: number;
  detected_language: string;
  confidence: number;
}

/** Parsed LLM locale audit response. */
export interface LlmLocaleDetectResult {
  overall_detected_language: string;
  overall_confidence: number;
  verdict: LocaleDetectVerdict;
  matches_expected: boolean;
  is_mixed: boolean;
  summary: string;
  samples: LlmLocaleDetectSampleResult[];
}

export interface LlmLocaleDetectOptions {
  samples: LlmLocaleDetectSample[];
  model: string;
  expectedLang: string;
  storedLang: string;
  isLocalized: boolean;
  allowedLanguages?: readonly string[];
  game?: GameType | string | null;
  modName?: string | null;
  fileName?: string | null;
}

const VALID_VERDICTS = new Set<LocaleDetectVerdict>(['match', 'mismatch', 'mixed', 'uncertain']);

export const LOCALE_DETECT_SYSTEM_PROMPT = `You audit the source language of video game mod localization strings.

Rules:
- You receive a JSON object and must respond with JSON only (no markdown, no prose outside JSON).
- Strings may contain game placeholders like ¤PH0¤, %1, {0}, HTML tags, or FormIDs — ignore them when judging language.
- "expected_language" is what the import pipeline assumed as the source locale.
- "allowed_languages" is the exhaustive list of codes you may use for overall_detected_language and samples[].detected_language.
- Never invent other language codes or full names (no "russian", "english", etc.).
- "plugin_localized_flag" is the ESP localized bit (external STRINGS vs inline text); it does not prove the text language.
- Non-localized plugins sometimes ship with an embedded translation (e.g. ru text while expected en).
- If samples disagree, set verdict to "mixed" and is_mixed to true.
- verdict must be one of: "match", "mismatch", "mixed", "uncertain".
- matches_expected is true only when overall_detected_language equals expected_language.
- overall_confidence and per-sample confidence are 0.0–1.0.

Respond with this JSON shape:
{
  "overall_detected_language": "en",
  "overall_confidence": 0.95,
  "verdict": "match",
  "matches_expected": true,
  "is_mixed": false,
  "summary": "one sentence explanation",
  "samples": [
    { "id": 1, "detected_language": "en", "confidence": 0.98 }
  ]
}

Include one entry in "samples" for every input sample id.`;

const normalizeAllowedLang = (lang: string, allowed: Set<string>): string => {
  const code = lang.trim().toLowerCase();
  return allowed.has(code) ? code : 'unknown';
};

export const buildLocaleDetectUserPayload = (
  opts: Omit<LlmLocaleDetectOptions, 'model'>,
): object => ({
  task: 'mod_locale_audit',
  expected_language: opts.expectedLang.trim().toLowerCase(),
  stored_language: opts.storedLang.trim().toLowerCase(),
  allowed_languages: opts.allowedLanguages ?? LOCALE_DETECT_ALLOWED_LANGS,
  plugin_localized_flag: opts.isLocalized,
  game: opts.game ?? null,
  mod_name: opts.modName ?? null,
  file_name: opts.fileName ?? null,
  samples: opts.samples.map((s) => ({
    id: s.id,
    text: s.text,
    signature: s.signature,
    path: s.path,
    edid: s.edid,
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

const parseVerdict = (value: unknown): LocaleDetectVerdict => {
  if (typeof value === 'string' && VALID_VERDICTS.has(value as LocaleDetectVerdict)) {
    return value as LocaleDetectVerdict;
  }
  return 'uncertain';
};

/**
 * Parse and validate the LLM JSON locale audit response.
 */
export const parseLlmLocaleDetectResponse = (
  raw: string,
  expectedSampleIds: number[],
  allowedLanguages: readonly string[] = LOCALE_DETECT_ALLOWED_LANGS,
): LlmLocaleDetectResult => {
  const allowed = new Set(allowedLanguages.map((lang) => lang.toLowerCase()));
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    throw new Error('LLM locale detect response is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM locale detect response must be a JSON object');
  }

  const body = parsed as Record<string, unknown>;
  const rawSamples = body.samples;
  if (!Array.isArray(rawSamples)) {
    throw new Error('LLM locale detect response must contain a "samples" array');
  }

  const byId = new Map<number, LlmLocaleDetectSampleResult>();
  for (const entry of rawSamples) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'number' || !Number.isInteger(row.id)) continue;
    if (typeof row.detected_language !== 'string' || !row.detected_language.trim()) continue;
    byId.set(row.id, {
      id: row.id,
      detected_language: normalizeAllowedLang(row.detected_language, allowed),
      confidence: clampConfidence(row.confidence),
    });
  }

  const samples: LlmLocaleDetectSampleResult[] = [];
  for (const id of expectedSampleIds) {
    const row = byId.get(id);
    if (!row) {
      throw new Error(`LLM locale detect response missing sample id=${id}`);
    }
    samples.push(row);
  }

  const overallLang =
    typeof body.overall_detected_language === 'string' && body.overall_detected_language.trim()
      ? normalizeAllowedLang(body.overall_detected_language, allowed)
      : 'unknown';

  return {
    overall_detected_language: overallLang,
    overall_confidence: clampConfidence(body.overall_confidence),
    verdict: parseVerdict(body.verdict),
    matches_expected: body.matches_expected === true,
    is_mixed: body.is_mixed === true,
    summary:
      typeof body.summary === 'string' && body.summary.trim()
        ? body.summary.trim()
        : 'No summary provided.',
    samples,
  };
};

/** Run locale audit on a sample of mod strings via LLM (JSON in/out). */
export const detectLocaleWithLlm = async (
  opts: LlmLocaleDetectOptions,
): Promise<LlmLocaleDetectResult> => {
  if (opts.samples.length === 0) {
    throw new Error('Locale detect requires at least one sample string');
  }

  const expectedSampleIds = opts.samples.map((s) => s.id);
  const allowedLanguages = opts.allowedLanguages ?? LOCALE_DETECT_ALLOWED_LANGS;
  const payload = buildLocaleDetectUserPayload({ ...opts, allowedLanguages });
  const text = await chatWithFallback({
    model: opts.model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    logMeta: {
      operation: 'locale_detect',
      context: {
        sampleIds: expectedSampleIds,
        sampleCount: expectedSampleIds.length,
        expectedLang: opts.expectedLang,
        storedLang: opts.storedLang,
        modName: opts.modName ?? null,
        fileName: opts.fileName ?? null,
      },
    },
    messages: [
      { role: 'system', content: LOCALE_DETECT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });

  return parseLlmLocaleDetectResponse(text, expectedSampleIds, allowedLanguages);
};
