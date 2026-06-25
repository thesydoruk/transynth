/**
 * Lenient parsing of LLM JSON responses (markdown fences, trailing prose, jsonrepair).
 */
import { jsonrepair } from 'jsonrepair';
import { logLlm } from '../logging/loggers';

export const stripMarkdownFence = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
};

/** Extract the outermost `{ ... }` block when the model adds prose around JSON. */
export const extractJsonObject = (text: string): string => {
  const stripped = stripMarkdownFence(text);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
};

const extractJsonErrorPosition = (err: unknown): number | null => {
  if (!(err instanceof SyntaxError)) return null;
  const match = err.message.match(/position (\d+)/);
  return match ? Number(match[1]) : null;
};

const formatSnippet = (text: string, position: number, radius = 120): string => {
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return JSON.stringify(text.slice(start, end));
};

/** Structured warn log when LLM output fails JSON.parse (for post-mortem analysis). */
export const logLlmJsonParseFailure = (
  raw: string,
  err: unknown,
  context?: Record<string, unknown>,
): void => {
  const error = err instanceof Error ? err.message : String(err);
  const errorPosition = extractJsonErrorPosition(err);
  logLlm.warn('LLM response JSON parse failed', {
    error,
    responseChars: raw.length,
    errorPosition,
    ...(errorPosition != null ? { snippetAroundError: formatSnippet(raw, errorPosition) } : {}),
    responseHead: JSON.stringify(raw.slice(0, 240)),
    ...(raw.length > 240 ? { responseTail: JSON.stringify(raw.slice(-240)) } : {}),
    ...context,
  });
};

const parseJsonText = (text: string): unknown => JSON.parse(text);

/** Unwrap one level when the model returns JSON as a string literal. */
const unwrapStringJson = (parsed: unknown): unknown => {
  if (typeof parsed !== 'string') return parsed;
  try {
    return parseJsonText(parsed);
  } catch {
    return parseJsonText(jsonrepair(parsed));
  }
};

const repairAndParse = (text: string): unknown => unwrapStringJson(parseJsonText(jsonrepair(text)));

const parseCandidate = (text: string): unknown => {
  try {
    return unwrapStringJson(parseJsonText(text));
  } catch (err) {
    try {
      return repairAndParse(text);
    } catch (repairErr) {
      throw repairErr ?? err;
    }
  }
};

const uniqueCandidates = (raw: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [extractJsonObject(raw), stripMarkdownFence(raw)]) {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

/**
 * Parse JSON from an LLM response using extraction helpers and jsonrepair.
 * @returns Parsed value, or undefined when repair/parse fails (no logging).
 */
export const tryParseLlmJson = (raw: string): unknown | undefined => {
  for (const candidate of uniqueCandidates(raw)) {
    try {
      return parseCandidate(candidate);
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
};

/** Repair LLM JSON text via jsonrepair; returns original text when repair fails. */
export const repairLlmJsonContent = (raw: string): string => {
  const parsed = tryParseLlmJson(raw);
  if (parsed === undefined) return raw;
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
};

/**
 * Parse JSON from an LLM response using extraction helpers and jsonrepair.
 *
 * @throws When no strategy yields valid JSON.
 */
export const parseLlmJson = (raw: string, logContext?: Record<string, unknown>): unknown => {
  const parsed = tryParseLlmJson(raw);
  if (parsed !== undefined) return parsed;

  let lastErr: unknown = new Error('unable to parse JSON');
  const first = uniqueCandidates(raw)[0];
  if (first) {
    try {
      parseCandidate(first);
    } catch (err) {
      lastErr = err;
    }
  }

  const hint = lastErr instanceof Error ? lastErr.message : String(lastErr);
  logLlmJsonParseFailure(raw, lastErr, logContext);
  throw new Error(`LLM response is not valid JSON (${hint})`);
};
