import type { LlmReferenceExample } from './translate';
import { normalizeForHash } from '../utils/textNorm';

const matchMethodRank = (method: LlmReferenceExample['match_method']): number => {
  switch (method) {
    case 'exact':
      return 0;
    case 'numeric':
      return 1;
    case 'punct_norm':
      return 2;
    case 'fuzzy':
      return 3;
    case 'embedding':
      return 4;
    default:
      return 5;
  }
};

const sortVerifyReferenceExamples = (
  examples: LlmReferenceExample[],
  source: string,
): LlmReferenceExample[] => {
  const sourceNorm = normalizeForHash(source);
  return [...examples].sort((a, b) => {
    const aTemplate = normalizeForHash(a.source) === sourceNorm ? 0 : 1;
    const bTemplate = normalizeForHash(b.source) === sourceNorm ? 0 : 1;
    if (aTemplate !== bTemplate) return aTemplate - bTemplate;

    const methodDiff = matchMethodRank(a.match_method) - matchMethodRank(b.match_method);
    if (methodDiff !== 0) return methodDiff;

    return b.similarity - a.similarity;
  });
};

/** Prefer RAG examples from the same record type; prioritize series templates for verify. */
export const filterVerifyReferenceExamples = (
  examples: LlmReferenceExample[] | undefined,
  item: { grup: string | null; field: string | null; source: string },
  max = 3,
): LlmReferenceExample[] | undefined => {
  if (!examples || examples.length === 0) return undefined;

  const sameGrupField = examples.filter((ex) => ex.grup === item.grup && ex.field === item.field);
  if (sameGrupField.length > 0) {
    return sortVerifyReferenceExamples(sameGrupField, item.source).slice(0, max);
  }

  const sameGrup = examples.filter((ex) => ex.grup === item.grup);
  if (sameGrup.length > 0) {
    return sortVerifyReferenceExamples(sameGrup, item.source).slice(0, max);
  }

  return sortVerifyReferenceExamples(examples, item.source).slice(0, Math.min(2, max));
};
