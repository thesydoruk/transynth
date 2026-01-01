// Translation via LLM provider (Ollama or OpenAI)
import { getLLM } from './index.js';

export async function translateBatch(
  items: string[],
  model: string,
  styleMd: string | undefined,
  glossary: string[] | undefined
): Promise<string[]> {
  const system = "You are a professional game localizer for Bethesda games. Keep masked tokens like ¤PH0¤ and ¤GL0¤ unchanged. Return a JSON array only.";
  const user = {
    source_language: "auto",
    target_language: "target set by caller",
    style_guide: styleMd?.slice(0, 4000) || "",
    glossary_preview: (glossary || []).slice(0, 100),
    items
  };

  const llm = getLLM();
  const text = await llm.chat({
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
  return data.items as string[];
}
