/**
 * Lenient parsing of LLM JSON responses (markdown fences, trailing prose, minor syntax issues).
 */

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

const fixTrailingCommas = (text: string): string => text.replace(/,\s*([\]}])/g, '$1');

/**
 * Parse JSON from an LLM response using several recovery strategies.
 *
 * @throws When no strategy yields valid JSON.
 */
export const parseLlmJson = (raw: string): unknown => {
  const candidates = [
    stripMarkdownFence(raw),
    extractJsonObject(raw),
    fixTrailingCommas(stripMarkdownFence(raw)),
    fixTrailingCommas(extractJsonObject(raw)),
  ];

  let lastErr: unknown;
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }

  const hint = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`LLM response is not valid JSON (${hint})`);
};
