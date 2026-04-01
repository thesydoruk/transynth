/**
 * Batch translation via LLM.
 *
 * Sends a structured prompt to the chat-capable LLM provider and parses the
 * JSON response. Placeholder tokens (¤PH\u2026¤, ¤GL\u2026¤, ¤FK\u2026¤) must
 * already be applied by the caller before invoking this module.
 */
import { chatWithFallback } from './index';
import { log } from '../logger';

/**
 * Translate an array of strings in a single LLM call.
 *
 * Constructs a structured JSON prompt including an optional style guide and
 * glossary preview, sends it to the chat LLM, and returns the translated items
 * in the same order as the input.
 *
 * @param items    - Source strings to translate (masked placeholders applied).
 * @param model    - LLM model name (e.g. `gemma3:27b`, `gpt-4o`).
 * @param styleMd  - Optional Markdown style guide, truncated to 4 000 characters.
 * @param glossary - Optional list of glossary terms to include in the prompt.
 * @returns Array of translated strings in input order.
 * @throws If the model returns an unexpected JSON shape.
 */
export const translateBatch = async (
  items: string[],
  model: string,
  styleMd: string | undefined,
  glossary: string[] | undefined
): Promise<string[]> => {
  log.debug(`translateBatch: ${items.length} items, model=${model}`);
  const system = "You are a professional game localizer for Bethesda games. Keep masked tokens like ¤PH0¤ and ¤GL0¤ unchanged. Return a JSON array only.";
  const user = {
    source_language: "auto",
    target_language: "target set by caller",
    style_guide: styleMd?.slice(0, 4000) || "",
    glossary_preview: (glossary || []).slice(0, 100),
    items
  };

  const text = await chatWithFallback({
    model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: "Translate to the requested target language. Output a JSON object with an 'items' array in the same order.\n\n" + JSON.stringify(user),
      },
    ],
  });

  const data = JSON.parse(text);
  if (!Array.isArray(data.items)) throw new Error("Unexpected response shape");
  log.debug(`translateBatch: received ${data.items.length} translations`);
  return data.items as string[];
}
