/**
 * Where a Witcher 3 take is, and where its localized replacement goes.
 *
 * A source take is a row of a `.w3speech` container, so it has no file of its
 * own; the editor plays it from an Ogg Opus copy unpacked on first use. A
 * localized take is three files under the localize directory, in a folder
 * named after the container it replaces rows of:
 *
 * ```
 * content/content0/enpc/1185686.wav    the synthesized line (what the editor plays)
 * content/content0/enpc/1185686.audio  its `.w3speech` audio block
 * content/content0/enpc/1185686.lip    its mouth animation
 * ```
 *
 * The `.wav` is the take; the other two are derived from it. Synthesis writes
 * all three, but a take accepted from the editor's regenerate flow arrives as a
 * `.wav` alone, so the voice export rebuilds the blocks of any `.wav` newer
 * than them before it rebuilds a container from the source one plus these.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import { PATHS } from '../../../paths';
import { ensureDir } from '../../../utils/file';
import { opusWemToOgg, parseOpusWem } from '../audio/opusWem';
import { parseW3SpeechAudio, readW3SpeechBlock, readW3SpeechIndex } from '../w3speech';
import { parseW3ClipRelPath } from './clips';

/** Every W3 take is the only take of its line. */
export const W3_VOICE_VARIANT = 1;

/** Ogg copies of a mod's source takes, unpacked for playback and as TTS references. */
export const w3SourceCacheDir = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'w3-source');

/** `content/content0/enpc.w3speech` → `content/content0/enpc`. */
export const w3LocalizedTakeDir = (container: string): string =>
  container.replace(/\.w3speech$/i, '');

export const w3LocalizedTakePaths = (
  container: string,
  id: number,
): { wav: string; audio: string; lip: string } => {
  const base = `${w3LocalizedTakeDir(container)}/${id}`;
  return { wav: `${base}.wav`, audio: `${base}.audio`, lip: `${base}.lip` };
};

/** `1185686.wav` → `1185686:1`; anything else is not a localized take. */
export const w3VoiceKeyFromFileName = (fileName: string): string | null => {
  const m = /^(\d+)\.wav$/i.exec(path.basename(fileName));
  return m ? `${m[1]}:${W3_VOICE_VARIANT}` : null;
};

/**
 * The editor's handle on a source take: `relPath` is the clip's own
 * (`…/enpc.w3speech#1185686`), `absolutePath` an Ogg copy that may not exist yet
 * — {@link materializeW3SourceTake} writes it.
 */
export const w3SourceTakeEntry = (clipRelPath: string, cacheDir: string): VoiceFileEntry | null => {
  const parsed = parseW3ClipRelPath(clipRelPath);
  if (!parsed) return null;
  const fileName = `${parsed.id}.ogg`;
  return {
    relPath: clipRelPath,
    absolutePath: path.join(cacheDir, w3LocalizedTakeDir(parsed.container), fileName),
    fileName,
    lineKey: String(parsed.id),
    variant: W3_VOICE_VARIANT,
    ext: 'ogg',
  };
};

/** Read one take's audio and lip blocks straight out of its container. */
export const readW3SourceTake = (
  extractRoot: string,
  clipRelPath: string,
): { audio: Buffer; lip: Buffer } | null => {
  const parsed = parseW3ClipRelPath(clipRelPath);
  if (!parsed) return null;
  const containerPath = path.join(extractRoot, ...parsed.container.split('/'));
  if (!fs.existsSync(containerPath)) return null;
  const fd = fs.openSync(containerPath, 'r');
  try {
    const row = readW3SpeechIndex(fd).rows.find((r) => r.id === parsed.id);
    if (!row) return null;
    return {
      audio: readW3SpeechBlock(fd, row.audioOffset, row.audioSize),
      lip: readW3SpeechBlock(fd, row.lipOffset, row.lipSize),
    };
  } finally {
    fs.closeSync(fd);
  }
};

/** Unpack a source take to its entry's Ogg path, if it is not there yet. */
export const materializeW3SourceTake = (extractRoot: string, entry: VoiceFileEntry): boolean => {
  if (fs.existsSync(entry.absolutePath)) return true;
  const take = readW3SourceTake(extractRoot, entry.relPath);
  if (!take) return false;
  ensureDir(path.dirname(entry.absolutePath));
  fs.writeFileSync(
    entry.absolutePath,
    opusWemToOgg(parseOpusWem(parseW3SpeechAudio(take.audio).take)),
  );
  return true;
};
