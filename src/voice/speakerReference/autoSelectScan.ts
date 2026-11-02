import type { Tx } from '../../db';
import { log } from '../../logger';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import {
  BETHESDA_VOICE_MARKUP,
  stripVoiceNonSpeechBlocks,
  type VoiceTtsMarkupStyle,
} from '../prepareVoiceTtsText';
import { setVoiceSpeakerRef, type VoiceSpeakerRefPick } from '../voiceSpeakerRefs';
import {
  isPreferredAutoSelectPick,
  pickAutoSelectCandidate,
  type AutoSelectMetrics,
} from './autoSelect';
import {
  entryReferenceId,
  getOrDecodeEntryReferenceWav,
  getOrReuseSpeakerReferenceWav,
  sourceDigest,
} from './cache';
import { AUTO_SELECT_MAX_CANDIDATES, AUTO_SELECT_PREFERRED_STOP_COUNT } from './constants';
import type { VoiceReferenceEligibility } from './eligibility';
import type { ResolveSpeakerReferenceInput, ResolvedSpeakerReference } from './resolve';
import { analyzeReferenceWav } from './scoring';
import { countEnglishSyllables } from './syllables';

export type CacheDirs = {
  speaker: string;
  entry: string;
  work: string;
};

type ScoredEntry = AutoSelectMetrics & {
  entry: VoiceFileEntry;
  wavPath: string;
  score: number;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Speaker reference scan cancelled', 'AbortError');
};

/**
 * Evenly spaced subset of a pool larger than the scan budget. Takes are listed
 * by FormID, so a spread covers many quests instead of the first few.
 */
export const spreadCandidates = <T>(entries: T[], max: number): T[] => {
  if (entries.length <= max) return entries;
  const step = entries.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(entries[Math.floor(i * step)]!);
  return out;
};

const syllableCountForEntry = (
  entry: VoiceFileEntry,
  getSourceText: ResolveSpeakerReferenceInput['getSourceText'],
  markup: VoiceTtsMarkupStyle,
): number | null => {
  if (!getSourceText) return null;
  const source = getSourceText(entry.lineKey, entry.variant, entry.originPlugin);
  if (!source) return null;
  const spoken = stripVoiceNonSpeechBlocks(source, markup);
  const count = countEnglishSyllables(spoken);
  return count > 0 ? count : null;
};

const scoreEntryReference = async (
  entry: VoiceFileEntry,
  dirs: CacheDirs,
  getSourceText: ResolveSpeakerReferenceInput['getSourceText'],
  markup: VoiceTtsMarkupStyle,
): Promise<ScoredEntry | null> => {
  try {
    const wavPath = await getOrDecodeEntryReferenceWav(entry, dirs.entry, dirs.work);
    const analysis = analyzeReferenceWav(wavPath);
    return {
      entry,
      wavPath,
      score: analysis.score,
      qualityScore: analysis.score,
      durationSec: analysis.durationSec,
      activeSec: analysis.activeSec,
      syllableCount: syllableCountForEntry(entry, getSourceText, markup),
    };
  } catch (err) {
    log.warn(
      `Speaker ref skip ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
};

const finalizeAutoReference = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  dirs: CacheDirs,
  scored: ScoredEntry,
): Promise<ResolvedSpeakerReference> => {
  const pick: VoiceSpeakerRefPick = {
    lineKey: scored.entry.lineKey,
    variant: scored.entry.variant,
    originPlugin: scored.entry.originPlugin ?? null,
  };
  await setVoiceSpeakerRef(db, modId, speakerKey, pick, scored.score);

  const autoMarker = `auto:${entryReferenceId(scored.entry)}:${sourceDigest(scored.entry.absolutePath)}`;
  const outPath = await getOrReuseSpeakerReferenceWav(
    speakerKey,
    dirs.speaker,
    autoMarker,
    async () => scored.wavPath,
  );

  log.info(
    `Speaker ref "${speakerKey}": auto ${scored.entry.fileName} (score=${scored.score.toFixed(1)})`,
  );
  return { wavPath: outPath, pick, source: 'auto', score: scored.score };
};

/**
 * Rank the speaker's takes and save the best one as the reference.
 *
 * The current line wins outright when it is 8–12 s and in tempo. Otherwise the
 * scan is bounded: at most {@link AUTO_SELECT_MAX_CANDIDATES} takes spread over
 * the pool, stopping early once {@link AUTO_SELECT_PREFERRED_STOP_COUNT} 8–12 s
 * in-tempo takes are ranked — a player voice has 13k takes, and decoding them
 * all stalled whole jobs. Small pools are still ranked in full.
 */
export const autoSelectReference = async (
  input: ResolveSpeakerReferenceInput,
  dirs: CacheDirs,
  isEligible: VoiceReferenceEligibility,
): Promise<ResolvedSpeakerReference | null> => {
  const { db, modId, speakerKey, preferredEntry, signal } = input;
  const markup = input.markup ?? BETHESDA_VOICE_MARKUP;
  const analyze = (entry: VoiceFileEntry) =>
    scoreEntryReference(entry, dirs, input.getSourceText, markup);

  throwIfAborted(signal);
  const preferredScored = isEligible(
    preferredEntry.lineKey,
    preferredEntry.variant,
    preferredEntry.originPlugin,
  )
    ? await analyze(preferredEntry)
    : null;
  if (preferredScored && isPreferredAutoSelectPick(preferredScored)) {
    return finalizeAutoReference(db, modId, speakerKey, dirs, preferredScored);
  }

  const candidates: ScoredEntry[] = [];
  if (preferredScored) candidates.push(preferredScored);
  const eligible = input
    .getFallbackEntries()
    .filter((entry) => isEligible(entry.lineKey, entry.variant, entry.originPlugin));
  const pool = spreadCandidates(eligible, AUTO_SELECT_MAX_CANDIDATES);
  let preferredFound = 0;
  let considered = 0;
  for (const entry of pool) {
    throwIfAborted(signal);
    considered += 1;
    const scored = await analyze(entry);
    if (!scored) continue;
    candidates.push(scored);
    if (isPreferredAutoSelectPick(scored)) {
      preferredFound += 1;
      if (preferredFound >= AUTO_SELECT_PREFERRED_STOP_COUNT) break;
    }
  }
  if (considered < eligible.length) {
    log.info(
      `Speaker ref "${speakerKey}": auto-select ranked ${considered} of ${eligible.length} takes`,
    );
  }

  const best = pickAutoSelectCandidate(candidates);
  if (!best) {
    log.warn(`Speaker ref "${speakerKey}": no suitable reference found`);
    return null;
  }

  return finalizeAutoReference(db, modId, speakerKey, dirs, best);
};
