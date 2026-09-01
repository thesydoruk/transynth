/**
 * Which chunks of a Disco Elysium line are actually voiced in its clip.
 *
 * Mixed narration+quote lines (e.g. `She says, "Okay."`) are resolved from
 * audio-intel ASR, not from clip duration. Missing / empty ASR keeps the
 * full line so a short prefix cannot drop the spoken quote — or vice versa.
 */
import {
  extractDiscoQuotedSpeech,
  hasDiscoNarrationOutsideQuotes,
  joinDiscoQuoteSpans,
} from '../../formats/po/discoLockitMarkup';
import {
  decideDiscoSpokenFromAsr,
  type DecideDiscoSpokenAsrOptions,
  type DiscoSpokenAsrDecision,
} from './discoSpokenAsr';

export { extractDiscoQuotedSpeech, hasDiscoNarrationOutsideQuotes };
export { decideDiscoSpokenFromAsr } from './discoSpokenAsr';
export type {
  DecideDiscoSpokenAsrOptions,
  DiscoSpokenAsrDecision,
  DiscoSpokenMode,
} from './discoSpokenAsr';

export type DiscoSpokenRowText = {
  source: string;
  translation: string;
  decision: DiscoSpokenAsrDecision;
};

export const applyDiscoSpokenDecision = (
  row: { source: string; translation: string },
  decision: DiscoSpokenAsrDecision,
): DiscoSpokenRowText => {
  if (decision.mode === 'quoted' || decision.mode === 'custom') {
    const mapped = decision.quoteIndexes?.length
      ? joinDiscoQuoteSpans(row.translation, decision.quoteIndexes)
      : extractDiscoQuotedSpeech(row.translation);
    // A quoteless translation is already just the spoken part, so it stays as
    // is. But when it does carry narration outside quotes and the spans could
    // not be mapped, cutting the source alone would voice that narration.
    const unsafeCut = decision.mode === 'custom' || hasDiscoNarrationOutsideQuotes(row.translation);
    if (!mapped && unsafeCut) {
      return {
        source: row.source,
        translation: row.translation,
        decision: { mode: 'full', spokenSource: row.source },
      };
    }
    return {
      source: decision.spokenSource,
      translation: mapped ?? row.translation,
      decision,
    };
  }
  return { source: row.source, translation: row.translation, decision };
};

/**
 * Spoken source + translation from an ASR transcript (no I/O).
 * `asrText` null/empty or low confidence → full text.
 */
export const resolveDiscoSpokenRowFromAsr = (
  row: { source: string; translation: string },
  asrText: string | null | undefined,
  options: DecideDiscoSpokenAsrOptions = {},
): DiscoSpokenRowText => {
  if (!hasDiscoNarrationOutsideQuotes(row.source)) {
    return applyDiscoSpokenDecision(row, { mode: 'full', spokenSource: row.source });
  }
  return applyDiscoSpokenDecision(row, decideDiscoSpokenFromAsr(row.source, asrText, options));
};
