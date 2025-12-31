import { openai } from './client.js';

export async function translateBatch(
  items: string[],
  model: string,
  styleMd: string | undefined,
  glossary: string[] | undefined
) {
  const system = "You are a professional game localizer for Bethesda games. Keep masked tokens like ¤PH0¤ and ¤GL0¤ unchanged. Return a JSON array only.";
  const user = {
    source_language: "auto",
    target_language: "target set by caller",
    style_guide: styleMd?.slice(0, 4000) || "",
    glossary_preview: (glossary || []).slice(0, 100),
    items
  };

  const resp = await openai.responses.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    input: [
      { role: "system", content: system },
      { role: "user", content: "Translate to the requested target language. Output a JSON object with an 'items' array in the same order.\n\n" + JSON.stringify(user) }
    ]
  });

  const text = (resp as any).output_text as string;
  const data = JSON.parse(text);
  if (!Array.isArray(data.items)) throw new Error("Unexpected response shape");
  return data.items as string[];
}
