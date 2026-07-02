import type { LlmReferenceExample } from './translate';

/** Prefer RAG examples from the same record type; avoid cross-grup naming patterns. */
export const filterVerifyReferenceExamples = (
  examples: LlmReferenceExample[] | undefined,
  item: { grup: string | null; field: string | null },
  max = 3,
): LlmReferenceExample[] | undefined => {
  if (!examples || examples.length === 0) return undefined;

  const sameGrupField = examples.filter((ex) => ex.grup === item.grup && ex.field === item.field);
  if (sameGrupField.length > 0) {
    return sameGrupField.slice(0, max);
  }

  const sameGrup = examples.filter((ex) => ex.grup === item.grup);
  if (sameGrup.length > 0) {
    return sameGrup.slice(0, max);
  }

  return examples.slice(0, Math.min(2, max));
};
