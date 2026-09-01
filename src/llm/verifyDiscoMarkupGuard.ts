import {
  discoMarkupMismatchReason,
  discoMarkupMismatchSeverity,
  discoMarkupMismatches,
} from '../formats/po/discoLockitMarkup';
import type { GameType } from '../types';

type MarkupGuardItem = { source: string; translation: string };
type MarkupGuardResult = {
  verdict: 'ok' | 'suspicious' | 'incorrect';
  reason: string;
  confidence: number;
};

/**
 * Upgrade LLM ok/suspicious when Disco lockit markup counts do not mirror.
 * Lost quotes → incorrect; other marks → suspicious (matches Disco verify prompt).
 */
export const applyDiscoMarkupGuardToVerifyResult = <T extends MarkupGuardResult>(
  item: MarkupGuardItem,
  result: T,
  game?: GameType | string | null,
): T => {
  if (game !== 'disco') return result;
  const mismatches = discoMarkupMismatches(item.source, item.translation);
  const severity = discoMarkupMismatchSeverity(mismatches);
  if (!severity) return result;

  const message = discoMarkupMismatchReason(mismatches);
  const verdict =
    result.verdict === 'incorrect' || severity === 'incorrect' ? 'incorrect' : 'suspicious';
  const reason = result.reason.includes('Disco markup mismatch')
    ? result.reason
    : result.verdict === 'ok'
      ? message
      : `${result.reason} ${message}`;

  if (result.verdict === verdict && reason === result.reason) return result;
  return {
    ...result,
    verdict,
    reason,
    confidence: Math.max(result.confidence, 0.95),
  };
};
