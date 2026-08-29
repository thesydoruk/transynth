const PROMPT_JSON_INDENT = '  ';

/**
 * Format a value as readable indented JSON for LLM system prompts.
 * Same layout as few-shot input/output examples in standalone prompts.
 */
export const promptJsonFormat = (value: unknown): string =>
  JSON.stringify(value, null, PROMPT_JSON_INDENT);
