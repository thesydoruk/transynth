import type { LlmReferenceExample } from './translate';
import { compactLlmPartsFields } from './textParts';

const presentText = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

type CompactableItemFields = {
  grup?: string | null;
  edid?: string | null;
  field?: string | null;
  form_id?: string | null;
  context?: string | null;
};

/** Drop empty metadata so the model does not see null form_id / context / edid. */
export const compactLlmItemFields = (item: CompactableItemFields): Record<string, string> => ({
  ...(presentText(item.grup) ? { grup: item.grup!.trim() } : {}),
  ...(presentText(item.edid) ? { edid: item.edid!.trim() } : {}),
  ...(presentText(item.field) ? { field: item.field!.trim() } : {}),
  ...(presentText(item.form_id) ? { form_id: item.form_id!.trim() } : {}),
  ...(presentText(item.context) ? { context: item.context!.trim() } : {}),
});

/** RAG hints for the model: text + location only, no match_method / similarity. */
export const compactLlmReferenceExample = (
  example: LlmReferenceExample,
): Record<string, unknown> => {
  const structured = compactLlmPartsFields(example.parts, example.slots);
  const textFields = structured.parts
    ? {
        ...structured,
        ...(example.translation_parts && example.translation_parts.length > 0
          ? { translation_parts: [...example.translation_parts] }
          : { translation: example.translation }),
      }
    : { source: example.source, translation: example.translation };
  return {
    ...textFields,
    ...(presentText(example.grup) ? { grup: example.grup!.trim() } : {}),
    ...(presentText(example.edid) ? { edid: example.edid!.trim() } : {}),
    ...(presentText(example.field) ? { field: example.field!.trim() } : {}),
  };
};

export const compactLlmReferenceExamples = (
  examples: LlmReferenceExample[] | undefined,
):
  | { reference_examples: ReturnType<typeof compactLlmReferenceExample>[] }
  | Record<string, never> => {
  if (!examples || examples.length === 0) return {};
  return { reference_examples: examples.map(compactLlmReferenceExample) };
};
