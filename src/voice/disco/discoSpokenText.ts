/**
 * Which chunks of a Disco Elysium line are actually voiced in its clip.
 *
 * Final Cut lockit lines mix narration with character speech:
 *
 *   She gathers herself for a moment, then says, "Okay."
 *
 * For human characters the original clip contains ONLY the quoted speech —
 * `Acele-ICE  ACELE-690.wav` for the line above is 0.87 s, just "Okay."
 * Narrator-read actors (skills, objects — e.g. "A Folded Library Card")
 * voice the whole line including embedded quotes (13.76 s for a 175-char
 * card description). The text alone cannot tell the two apart, so the
 * decision compares the clip duration against speech-length estimates of
 * the full line vs the quoted part.
 *
 * Fully-quoted and quote-free lines are returned unchanged so that existing
 * synthesis stamps (payload version hashes) stay valid for them.
 */
import fs from 'node:fs';

/** ASCII, typographic and guillemet quote pairs used by lockits and translations. */
const QUOTE_SEGMENT_RES = [/"([^"]+)"/g, /\u201C([^\u201C\u201D]+)\u201D/g, /«([^«»]+)»/g];

/** Rough speech tempo for length estimates; only relative comparison matters. */
const CHARS_PER_SECOND = 13.5;
/** Fixed clip padding (breath, lead-in/out silence). */
const CLIP_PADDING_SEC = 0.35;

const estimateSpokenSeconds = (text: string): number =>
  CLIP_PADDING_SEC + text.length / CHARS_PER_SECOND;

/** Quoted speech segments joined in order of appearance, or null when none. */
export const extractDiscoQuotedSpeech = (text: string): string | null => {
  const segments: Array<{ index: number; content: string }> = [];
  for (const re of QUOTE_SEGMENT_RES) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const content = match[1]!.trim();
      if (content) segments.push({ index: match.index ?? 0, content });
    }
  }
  if (segments.length === 0) return null;
  segments.sort((a, b) => a.index - b.index);
  return segments.map((s) => s.content).join(' ');
};

/** True when the line has narration (letters/digits) outside its quoted segments. */
export const hasDiscoNarrationOutsideQuotes = (text: string): boolean => {
  if (!extractDiscoQuotedSpeech(text)) return false;
  let rest = text;
  for (const re of QUOTE_SEGMENT_RES) {
    re.lastIndex = 0;
    rest = rest.replace(re, ' ');
  }
  return /[\p{L}\p{N}]/u.test(rest);
};

const durationCache = new Map<string, number>();

/**
 * WAV duration from the RIFF header only (no sample data load) — the batch
 * probes thousands of clips. Returns 0 when the file cannot be parsed.
 */
export const readWavDurationSecLight = (wavPath: string): number => {
  const cached = durationCache.get(wavPath);
  if (cached !== undefined) return cached;

  let duration = 0;
  let fd: number | null = null;
  try {
    fd = fs.openSync(wavPath, 'r');
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) === 12 && head.toString('ascii', 0, 4) === 'RIFF') {
      const chunk = Buffer.alloc(8);
      let pos = 12;
      let byteRate = 0;
      for (let i = 0; i < 32; i++) {
        if (fs.readSync(fd, chunk, 0, 8, pos) !== 8) break;
        const id = chunk.toString('ascii', 0, 4);
        const size = chunk.readUInt32LE(4);
        if (id === 'fmt ') {
          const fmt = Buffer.alloc(16);
          if (fs.readSync(fd, fmt, 0, 16, pos + 8) === 16) {
            byteRate = fmt.readUInt32LE(8);
          }
        } else if (id === 'data') {
          if (byteRate > 0) duration = size / byteRate;
          break;
        }
        pos += 8 + size + (size % 2);
      }
    }
  } catch {
    duration = 0;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  durationCache.set(wavPath, duration);
  return duration;
};

/** @internal test helper */
export const _setWavDurationCacheForTests = (wavPath: string, seconds: number): void => {
  durationCache.set(wavPath, seconds);
};

/**
 * The spoken part of one line given its clip duration.
 *
 * Mixed narration+quote lines resolve to whichever variant (full text vs
 * quoted speech) better matches the clip length; unknown duration keeps the
 * full text (previous behaviour).
 *
 * @example decideDiscoSpokenText('She says, "Okay."', 0.9) → 'Okay.'
 * @example decideDiscoSpokenText('The card reads: "Expires July."', 3.5)
 *          → full text (narrator clip)
 */
export const decideDiscoSpokenText = (text: string, clipSeconds: number): string => {
  if (!hasDiscoNarrationOutsideQuotes(text)) return text;
  const quoted = extractDiscoQuotedSpeech(text);
  if (!quoted || clipSeconds <= 0) return text;
  const fullDelta = Math.abs(clipSeconds - estimateSpokenSeconds(text.trim()));
  const quotedDelta = Math.abs(clipSeconds - estimateSpokenSeconds(quoted));
  return quotedDelta < fullDelta ? quoted : text;
};

export type DiscoSpokenRowText = {
  source: string;
  translation: string;
};

/**
 * Spoken source + translation for one voiced line, decided by the original
 * clip of that line.
 *
 * When the clip carries only the quoted speech, the translation is reduced
 * to its own quoted segments; a translation without recognizable quotes is
 * kept whole (better to voice extra words than drop the line).
 */
export const resolveDiscoSpokenRowText = (
  row: { source: string; translation: string },
  clipWavPath: string,
): DiscoSpokenRowText => {
  if (!hasDiscoNarrationOutsideQuotes(row.source)) {
    return { source: row.source, translation: row.translation };
  }
  const spokenSource = decideDiscoSpokenText(row.source, readWavDurationSecLight(clipWavPath));
  if (spokenSource === row.source) {
    return { source: row.source, translation: row.translation };
  }
  return {
    source: spokenSource,
    translation: extractDiscoQuotedSpeech(row.translation) ?? row.translation,
  };
};
