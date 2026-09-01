import fs from 'node:fs';
import { readAudioIntelCache, transcribeWavCached } from '../../audioIntel/cache';
import { resolveDiscoSpokenRowFromAsr, type DiscoSpokenRowText } from './discoSpokenText';

export type ResolveDiscoSpokenOptions = {
  /**
   * When false, only reuse a disk-cached transcript (count / dry inventory).
   * Default true: call audio-intel on a cache miss.
   */
  transcribe?: boolean;
};

/**
 * Spoken source + translation for one voiced line, decided by audio-intel
 * on the original English clip. Service / file / empty ASR → full text.
 */
export const resolveDiscoSpokenRowText = async (
  row: { source: string; translation: string },
  clipWavPath: string,
  options: ResolveDiscoSpokenOptions = {},
): Promise<DiscoSpokenRowText> => {
  const transcribe = options.transcribe !== false;
  if (!clipWavPath || !fs.existsSync(clipWavPath)) {
    return resolveDiscoSpokenRowFromAsr(row, null);
  }

  let asr: string | null = null;
  let confidence: number | null = null;
  let transcribed = false;
  if (!transcribe) {
    const cached = readAudioIntelCache(clipWavPath);
    asr = cached?.text ?? null;
    confidence = cached?.confidence ?? null;
    transcribed = cached != null;
  } else {
    try {
      const transcript = await transcribeWavCached(clipWavPath);
      asr = transcript.text;
      confidence = transcript.confidence;
      transcribed = true;
    } catch {
      const cached = readAudioIntelCache(clipWavPath);
      asr = cached?.text ?? null;
      confidence = cached?.confidence ?? null;
      transcribed = cached != null;
    }
  }
  return resolveDiscoSpokenRowFromAsr(row, asr, { confidence, transcribed });
};
