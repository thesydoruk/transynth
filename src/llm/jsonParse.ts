/**
 * Parsing LLM JSON responses (markdown fences, string wrappers, extraction).
 */
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
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/(?:position|at position) (\d+)/i);
  return match ? Number(match[1]) : null;
};

/** True when JSON.parse failed because a string literal ran to EOF (typical output truncation). */
export const isJsonUnterminatedAtEnd = (err: unknown, rawLength: number): boolean => {
  if (!(err instanceof Error)) return false;
  if (!/Unterminated string/i.test(err.message)) return false;
  const pos = extractJsonErrorPosition(err);
  return pos != null && pos >= rawLength - 4;
};

const unescapePartialJsonString = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === undefined) break;
    switch (next) {
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'u': {
        const hex = value.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 5;
          break;
        }
        out += next;
        break;
      }
      default:
        out += next;
        break;
    }
    i++;
  }
  return out;
};

/**
 * Best-effort recovery when a single-item translate response is truncated mid-string.
 * Handles double-encoded JSON wrappers from some vLLM builds.
 */
export const trySalvageTruncatedTranslateJson = (
  raw: string,
  expectedId: number,
): { items: Array<{ id: number; translation: string }> } | undefined => {
  const markers = [
    `"id":${expectedId},"translation":"`,
    `"id": ${expectedId}, "translation": "`,
    `\\"id\\":${expectedId},\\"translation\\":\\"`,
    `\\"id\\": ${expectedId}, \\"translation\\": \\"`,
  ];

  for (const candidate of uniqueCandidates(raw)) {
    for (const marker of markers) {
      const idx = candidate.indexOf(marker);
      if (idx < 0) continue;
      let tail = candidate.slice(idx + marker.length);
      tail = tail.replace(/\\?"\}\s*\]\s*\}\\?"?\s*$/u, '');
      tail = tail.replace(/"\}\s*\]\s*\}"?\s*$/u, '');
      const translation = unescapePartialJsonString(tail).trim();
      if (translation.length >= 8) {
        return { items: [{ id: expectedId, translation }] };
      }
    }
  }

  return undefined;
};

const tryCloseOuterStringWrapper = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('"') || trimmed.endsWith('"')) return [];
  return [`${trimmed}"`];
};

/** Recursively unwrap JSON returned as a string literal (common with some vLLM models). */
export const peelStringWrappers = (text: string, maxDepth = 4): string => {
  let current = text.trim();
  for (let i = 0; i < maxDepth; i++) {
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed !== 'string') return current;
      current = parsed.trim();
    } catch {
      return current;
    }
  }
  return current;
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

/** Unwrap nested JSON string literals returned by some models. */
const unwrapStringJson = (parsed: unknown): unknown => {
  let value = parsed;
  for (let i = 0; i < 4; i++) {
    if (typeof value !== 'string') return value;
    value = parseJsonText(value);
  }
  return value;
};

const parseCandidate = (text: string): unknown => unwrapStringJson(parseJsonText(text));

const pushCandidate = (seen: Set<string>, out: string[], candidate: string): void => {
  const trimmed = candidate.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  out.push(trimmed);
};

const looksLikeJsonText = (text: string): boolean => {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || /^```(?:json)?/i.test(t);
};

const uniqueCandidates = (raw: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const trimmed = raw.trim();
  const peeled = peelStringWrappers(trimmed);
  const extracted = (text: string) => extractJsonObject(stripMarkdownFence(text));

  for (const candidate of [
    ...tryCloseOuterStringWrapper(trimmed),
    ...(looksLikeJsonText(peeled) ? [peeled] : []),
    ...(looksLikeJsonText(trimmed) ? [trimmed] : []),
    extracted(peeled),
    extracted(trimmed),
    stripMarkdownFence(peeled),
    stripMarkdownFence(trimmed),
  ]) {
    pushCandidate(seen, out, candidate);
  }
  return out;
};

/**
 * Parse JSON from an LLM response using extraction helpers.
 * @returns Parsed value, or undefined when parse fails (no logging).
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

/**
 * Parse JSON from an LLM response using extraction helpers.
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
