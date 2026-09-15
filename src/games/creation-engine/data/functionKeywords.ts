/**
 * Legacy Creation Engine `FunctionKeywords` corpora.
 *
 * These are engine identifiers that appear inside translatable strings and
 * must survive translation verbatim; the placeholder masker protects them.
 * Editions that share an engine share a corpus.
 */
import fo3Keywords from './function-keywords/fo3.json' with { type: 'json' };
import fo4Keywords from './function-keywords/fo4.json' with { type: 'json' };
import fnvKeywords from './function-keywords/fnv.json' with { type: 'json' };
import sseKeywords from './function-keywords/sse.json' with { type: 'json' };
import sleKeywords from './function-keywords/sle.json' with { type: 'json' };

export const FO3_FUNCTION_KEYWORDS: readonly string[] = fo3Keywords;
export const FO4_FUNCTION_KEYWORDS: readonly string[] = fo4Keywords;
export const FNV_FUNCTION_KEYWORDS: readonly string[] = fnvKeywords;
export const SSE_FUNCTION_KEYWORDS: readonly string[] = sseKeywords;
export const SLE_FUNCTION_KEYWORDS: readonly string[] = sleKeywords;
