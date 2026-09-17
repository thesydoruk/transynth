/**
 * Pair the takes the count-zip refuses to pair, by listening to them.
 *
 * One unvoiced line in a conversation makes take count and lockit row count
 * disagree, and {@link ./voiceTextIndex} then leaves that whole conversation
 * without text — hundreds of lines for a main character. What it lacks is a way
 * to tell which row has no take; audio-intel supplies exactly that, so here the
 * English clip is transcribed and matched against the rows it could belong to.
 *
 * Measured on the Final Cut pack (951 equal-count conversations used as ground
 * truth, one row removed from one side): 99.8% of accepted pairs are the pair
 * the intact group had, at 96% coverage. The handful that differ are lockit
 * rows with identical or near-identical text, where either pairing voices the
 * same words.
 */
import { transcribeWavCached } from '../../../audioIntel/cache';
import { mapWithConcurrency } from '../../../utils/concurrency';
import {
  alignTakesToLines,
  voiceMatchScore,
  voiceMatchTokens,
  type AlignTakesOptions,
} from './alignTakes';
import {
  applyDiscoAlternateRefs,
  buildDiscoVoiceGroups,
  discoGroupZipsByCount,
  discoVoiceTextRefFor,
  getDiscoVoiceTextIndex,
  type DiscoVoiceGroup,
  type DiscoVoiceTextRef,
} from './voiceTextIndex';

/**
 * A take pairs with a row when they share roughly a third of their words —
 * enough to rule out a neighbouring line, loose enough for a transcript that
 * drops stage directions. Below that the take keeps no text at all.
 */
const DISCO_ASR_ALIGN_DEFAULTS: AlignTakesOptions = {
  gapPenalty: 0.75,
  minScore: 0.3,
};

export type DiscoAlignedRef = DiscoVoiceTextRef & {
  /** Transcript-vs-lockit similarity that earned the pair, 0…1. */
  score: number;
};

export type AlignDiscoTakesOptions = Partial<AlignTakesOptions> & {
  /** Transcriber, injectable for tests. Default: cached audio-intel. */
  transcribe?: (wavPath: string) => Promise<string>;
  concurrency?: number;
  onProgress?: (transcribed: number, total: number) => void;
  shouldAbort?: () => boolean;
};

export type AlignDiscoTakesResult = {
  /** Wav stem → the lockit row it was matched to. */
  refs: Map<string, DiscoAlignedRef>;
  /** Conversations that needed alignment. */
  groups: number;
  /** Takes in those conversations. */
  takes: number;
  transcribed: number;
  transcribeFailures: number;
};

const defaultTranscribe = async (wavPath: string): Promise<string> =>
  (await transcribeWavCached(wavPath)).text ?? '';

/** Conversations the count-zip could not pair, minus takes already mapped. */
const groupsNeedingAlignment = (extractRoot: string): DiscoVoiceGroup[] => {
  const index = getDiscoVoiceTextIndex(extractRoot);
  return buildDiscoVoiceGroups(extractRoot).filter((group) => {
    if (group.takes.length === 0 || group.lines.length === 0) return false;
    if (discoGroupZipsByCount(group)) return false;
    return group.takes.some((take) => !index.has(take.stem));
  });
};

/**
 * Transcribe and pair every take the index left without text.
 *
 * Pure I/O orchestration: the pairing itself is {@link alignTakesToLines}.
 */
export const alignDiscoTakesByAsr = async (
  extractRoot: string,
  options: AlignDiscoTakesOptions = {},
): Promise<AlignDiscoTakesResult> => {
  const transcribe = options.transcribe ?? defaultTranscribe;
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const gapPenalty = options.gapPenalty ?? DISCO_ASR_ALIGN_DEFAULTS.gapPenalty;
  const minScore = options.minScore ?? DISCO_ASR_ALIGN_DEFAULTS.minScore;

  const groups = groupsNeedingAlignment(extractRoot);
  const takes = groups.flatMap((group) => group.takes);
  const result: AlignDiscoTakesResult = {
    refs: new Map(),
    groups: groups.length,
    takes: takes.length,
    transcribed: 0,
    transcribeFailures: 0,
  };
  if (takes.length === 0) return result;

  const transcripts = new Map<string, string[]>();
  await mapWithConcurrency(
    takes,
    concurrency,
    async (take) => {
      try {
        transcripts.set(take.stem, voiceMatchTokens(await transcribe(take.absPath)));
        result.transcribed += 1;
      } catch {
        result.transcribeFailures += 1;
      }
      options.onProgress?.(result.transcribed + result.transcribeFailures, takes.length);
    },
    { shouldAbort: options.shouldAbort },
  );

  for (const group of groups) {
    if (options.shouldAbort?.()) break;
    const lineTokens = group.lines.map((line) => voiceMatchTokens(line.msgid));
    const scores = group.takes.map((take) => {
      const takeTokens = transcripts.get(take.stem) ?? [];
      return lineTokens.map((tokens) => voiceMatchScore(takeTokens, tokens));
    });
    for (const pair of alignTakesToLines(scores, { gapPenalty, minScore })) {
      const take = group.takes[pair.take]!;
      const line = group.lines[pair.line]!;
      result.refs.set(take.stem, { ...discoVoiceTextRefFor(line), score: pair.score });
      const alternates = new Map<string, DiscoVoiceTextRef>();
      applyDiscoAlternateRefs(group, take, line, alternates);
      for (const [stem, ref] of alternates) result.refs.set(stem, { ...ref, score: pair.score });
    }
  }

  return result;
};
