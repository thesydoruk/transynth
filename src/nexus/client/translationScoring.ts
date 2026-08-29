import type { NexusMod, TranslationCandidate } from '../types';
import type { ModRequirementNode } from './internalTypes';
import {
  containsAdultStyleTerms,
  countKeywordHits,
  extractImportantTokens,
  isLikelyTranslationCategory,
  normalizeTextForMatch,
  uniqueStrings,
} from './textUtils';

export const scoreTranslationCandidate = (
  sourceMod: NexusMod,
  candidate: NexusMod,
  translationKeywords: string[],
  language: string | null,
  includeDescriptionSearch: boolean,
): TranslationCandidate => {
  const reasons: string[] = [];
  let score = 0;

  const sourceName = normalizeTextForMatch(sourceMod.name);
  const candidateName = normalizeTextForMatch(candidate.name);
  const candidateSummary = normalizeTextForMatch(candidate.summary);
  const candidateDescription = normalizeTextForMatch(candidate.description);

  const sourceTokens = extractImportantTokens(sourceMod.name);
  const candidateTokens = extractImportantTokens(candidate.name);
  const sharedTokenCount = sourceTokens.filter((token) => candidateTokens.includes(token)).length;
  const sourceCoverage = sourceTokens.length > 0 ? sharedTokenCount / sourceTokens.length : 0;

  const titleKeywordHits = countKeywordHits(candidateName, translationKeywords);
  const summaryKeywordHits = countKeywordHits(candidateSummary, translationKeywords);
  const descriptionKeywordHits = includeDescriptionSearch
    ? countKeywordHits(candidateDescription, translationKeywords)
    : 0;

  if (candidate.game.domainName === sourceMod.game.domainName) {
    score += 10;
    reasons.push('same-game');
  }

  if (candidateName.includes(sourceName)) {
    score += 35;
    reasons.push('title-contains-source-mod-name');
  }

  if (sharedTokenCount >= 2) {
    score += 10;
    reasons.push('title-shares-source-mod-tokens');
  }

  if (sourceCoverage >= 0.4) {
    score += 12;
    reasons.push('high-source-token-coverage');
  } else if (sourceCoverage >= 0.25) {
    score += 6;
    reasons.push('medium-source-token-coverage');
  }

  if (titleKeywordHits > 0) {
    score += Math.min(24, 16 + (titleKeywordHits - 1) * 2);
    reasons.push('title-has-translation-keywords');
  }

  if (summaryKeywordHits > 0) {
    score += Math.min(12, 7 + (summaryKeywordHits - 1));
    reasons.push('summary-has-translation-keywords');
  }

  if (includeDescriptionSearch && descriptionKeywordHits > 0) {
    score += Math.min(8, 4 + (descriptionKeywordHits - 1));
    reasons.push('description-has-translation-keywords');
  }

  if (language) {
    if (candidateName.includes(language)) {
      score += 14;
      reasons.push(`title-contains-language-${language}`);
    }

    if (candidateSummary.includes(language)) {
      score += 5;
      reasons.push(`summary-contains-language-${language}`);
    }

    if (candidate.tags.some((tag) => normalizeTextForMatch(tag).includes(language))) {
      score += 10;
      reasons.push(`tag-contains-language-${language}`);
    }
  }

  if (isLikelyTranslationCategory(candidate.category)) {
    score += 10;
    reasons.push('translation-like-category');
  }

  if (candidate.endorsements >= 10) {
    score += 2;
    reasons.push('community-endorsed');
  }

  if ((sourceMod.adultContent ?? false) === false && (candidate.adultContent ?? false) === true) {
    score -= 10;
    reasons.push('adult-mismatch-penalty');
  }

  const sourceLooksAdultStyle = containsAdultStyleTerms(sourceName);
  const candidateLooksAdultStyle = containsAdultStyleTerms(`${candidateName} ${candidateSummary}`);
  if (!sourceLooksAdultStyle && candidateLooksAdultStyle && sourceCoverage < 0.4) {
    score -= 8;
    reasons.push('style-mismatch-penalty');
  }

  const hasStrongSourceLink =
    candidateName.includes(sourceName) || sourceCoverage >= 0.4 || sharedTokenCount >= 3;
  const hasTranslationSignal =
    titleKeywordHits > 0 ||
    summaryKeywordHits > 0 ||
    descriptionKeywordHits > 0 ||
    (language ? candidateName.includes(language) : false) ||
    isLikelyTranslationCategory(candidate.category);

  if (!hasStrongSourceLink) {
    score -= 12;
    reasons.push('weak-source-link-penalty');
  }

  if (!hasTranslationSignal) {
    score -= 12;
    reasons.push('missing-translation-signal-penalty');
  }

  if (!hasStrongSourceLink && !hasTranslationSignal) {
    score = 0;
    reasons.push('hard-reject-no-translation-or-source-link');
  } else if (score < 18) {
    score = 0;
    reasons.push('weak-match');
  }

  return { mod: candidate, score, reasons: uniqueStrings(reasons) };
};

export const isLikelyTranslationRequirementNode = (
  sourceMod: NexusMod,
  node: ModRequirementNode,
  translationKeywords: string[],
  language: string | null,
): boolean => {
  if (node.externalRequirement) return false;

  const sourceName = normalizeTextForMatch(sourceMod.name);
  const sourceTokens = extractImportantTokens(sourceMod.name);
  const candidateName = normalizeTextForMatch(node.modName);
  const candidateNotes = normalizeTextForMatch(node.notes ?? '');
  const candidateTokens = extractImportantTokens(node.modName);

  const sharedTokenCount = sourceTokens.filter((token) => candidateTokens.includes(token)).length;
  const hasSourceLink = candidateName.includes(sourceName) || sharedTokenCount >= 2;

  const combined = `${candidateName} ${candidateNotes}`;
  const hasKeyword = countKeywordHits(combined, translationKeywords) > 0;
  const hasLanguage = language ? combined.includes(normalizeTextForMatch(language)) : false;

  return hasSourceLink && (hasKeyword || hasLanguage);
};
