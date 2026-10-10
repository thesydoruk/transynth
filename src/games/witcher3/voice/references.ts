/**
 * What the shared reference picker needs to clone a Witcher 3 speaker from
 * more than one take.
 *
 * A short line ("Hmm.", 0.4 s) clones badly from itself alone. Knowing the
 * speaker, `pickVoiceTtsReference` can add their longer takes, use the take
 * picked as their reference in the voice tab, or follow the project's
 * reference mode. It asks for a speaker's other takes as decodable files; a
 * Witcher 3 take lives inside a 4 GB container, so only each speaker's longest
 * few are offered — longest first, which is the order the picker draws from —
 * and unpacked to Ogg the first time they are asked for. Length is judged by
 * the audio block's size, which the container's index already holds.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import type { SpeakerRefCacheEntry } from '../../../voice/pickVoiceTtsReference';
import { voiceTranslationMapKey, type VoiceSourceRow } from '../../../voice/loadVoiceTranslations';
import type { TtsReferenceMode } from '../../../voice/voiceToolPaths';
import { readW3SpeechIndex } from '../w3speech';
import { W3_UNKNOWN_SPEAKER } from './clips';
import type { W3VoiceLine } from './lines';
import { materializeW3SourceTake, W3_VOICE_VARIANT, w3SourceTakeEntry } from './takes';

/** Takes per speaker offered as extra references; the picker uses a handful at most. */
const SIBLINGS_PER_SPEAKER = 12;

export type W3ReferenceContext = {
  mode: TtsReferenceMode;
  extractRoot: string;
  voiceSources: Map<string, VoiceSourceRow>;
  /** A speaker's longest takes other than `exceptId`, unpacked. Empty for an unknown speaker. */
  siblings: (speakerKey: string, exceptId: number) => VoiceFileEntry[];
  speakerRefCache: Map<string, SpeakerRefCacheEntry>;
};

export const buildW3ReferenceContext = (input: {
  mode: TtsReferenceMode;
  extractRoot: string;
  cacheDir: string;
  lines: readonly W3VoiceLine[];
}): W3ReferenceContext => {
  const sizes = new Map<string, Map<number, number>>();
  const sizeOf = (container: string, id: number): number => {
    let rows = sizes.get(container);
    if (!rows) {
      rows = new Map();
      const file = path.join(input.extractRoot, ...container.split('/'));
      if (fs.existsSync(file)) {
        const fd = fs.openSync(file, 'r');
        try {
          for (const row of readW3SpeechIndex(fd).rows) rows.set(row.id, row.audioSize);
        } finally {
          fs.closeSync(fd);
        }
      }
      sizes.set(container, rows);
    }
    return rows.get(id) ?? 0;
  };

  const voiceSources = new Map<string, VoiceSourceRow>();
  const bySpeaker = new Map<string, W3VoiceLine[]>();
  for (const line of input.lines) {
    if (line.source)
      voiceSources.set(voiceTranslationMapKey(String(line.id), W3_VOICE_VARIANT), {
        source: line.source,
      });
    if (line.speakerKey === W3_UNKNOWN_SPEAKER || !line.source) continue;
    const list = bySpeaker.get(line.speakerKey) ?? [];
    list.push(line);
    bySpeaker.set(line.speakerKey, list);
  }

  const longest = new Map<string, VoiceFileEntry[]>();
  const siblings = (speakerKey: string, exceptId: number): VoiceFileEntry[] => {
    let entries = longest.get(speakerKey);
    if (!entries) {
      entries = (bySpeaker.get(speakerKey) ?? [])
        .map((line) => ({ line, size: sizeOf(line.container, line.id) }))
        .sort((a, b) => b.size - a.size)
        .slice(0, SIBLINGS_PER_SPEAKER + 1)
        .map(({ line }) => w3SourceTakeEntry(line.relPath, input.cacheDir))
        .filter((entry): entry is VoiceFileEntry => entry !== null)
        .filter((entry) => materializeW3SourceTake(input.extractRoot, entry));
      longest.set(speakerKey, entries);
    }
    return entries
      .filter((entry) => entry.lineKey !== String(exceptId))
      .slice(0, SIBLINGS_PER_SPEAKER);
  };

  return {
    mode: input.mode,
    extractRoot: input.extractRoot,
    voiceSources,
    siblings,
    speakerRefCache: new Map(),
  };
};
