const PROMPT_JSON_INDENT = '  ';

/**
 * Format a value as readable indented JSON for LLM system prompts.
 * Same layout as few-shot input/output examples in standalone prompts.
 */
export const promptJsonFormat = (value: unknown): string =>
  JSON.stringify(value, null, PROMPT_JSON_INDENT);

/** Compact JSON array: one object per line. Use for long few-shot lists. */
export const promptJsonItems = (items: readonly object[]): string =>
  `{"items":[\n${items.map((item) => `  ${JSON.stringify(item)}`).join(',\n')}\n]}`;
