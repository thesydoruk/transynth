#!/usr/bin/env tsx
/**
 * Rank original voice clips by vocal effort, to calibrate shout tagging by ear.
 *
 * Reads a folder of 16-bit WAV clips laid out as `<speaker>/<clip>.wav` (the
 * Bethesda voice-type layout, decoded), builds a baseline per speaker and
 * prints one TSV row per clip, most strained first. Listen to the top, the
 * bottom and the rows around the thresholds in `vocalEffort/decide.ts`.
 *
 * Only the acoustic hint is scored here; text, actor notes and combat topics
 * need the plugin and are not wired in yet. Nothing is written anywhere.
 *
 * Usage:
 *   npm run voice:scan-effort -- <dir>
 *   npm run voice:scan-effort -- <dir> --speaker=NPCFPiper --limit=200
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPcmFromWav } from '../src/voice/speakerReference/pcm';
import {
  MIN_BASELINE_CLIPS,
  buildSpeakerBaseline,
  decideVocalEffort,
  effortZScores,
  extractEffortFeatures,
  type EffortFeatures,
} from '../src/voice/vocalEffort';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};

const root = process.argv.slice(2).find((value) => !value.startsWith('--'));
if (!root || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('Usage: npm run voice:scan-effort -- <dir> [--speaker=NAME] [--limit=N]');
  process.exit(1);
}
const onlySpeaker = arg('speaker');
const limit = Number(arg('limit') ?? 0) || undefined;

type Clip = { speaker: string; file: string; features: EffortFeatures };

const clips: Clip[] = [];
let unreadable = 0;
for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.wav')) continue;
  const file = path.join(entry.parentPath, entry.name);
  const speaker = path.basename(entry.parentPath);
  if (onlySpeaker && speaker !== onlySpeaker) continue;
  try {
    const { samples, sampleRate } = readPcmFromWav(file);
    const features = extractEffortFeatures(samples, sampleRate);
    if (features) clips.push({ speaker, file: path.relative(root, file), features });
    else unreadable += 1;
  } catch {
    unreadable += 1;
  }
}

const bySpeaker = new Map<string, Clip[]>();
for (const clip of clips) {
  const list = bySpeaker.get(clip.speaker) ?? [];
  list.push(clip);
  bySpeaker.set(clip.speaker, list);
}
// Speakers with a handful of clips borrow the baseline of everyone scanned.
const pooled = buildSpeakerBaseline(clips.map((clip) => clip.features));

const rows = clips.flatMap((clip) => {
  const own = bySpeaker.get(clip.speaker) ?? [];
  const baseline =
    own.length >= MIN_BASELINE_CLIPS
      ? buildSpeakerBaseline(own.map((item) => item.features))
      : pooled;
  if (!baseline) return [];
  const acoustic = effortZScores(clip.features, baseline);
  const { score, tag } = decideVocalEffort({ acoustic });
  return [{ clip, acoustic, score, tag, pooled: own.length < MIN_BASELINE_CLIPS }];
});
// The acoustic part is clamped, so ties are broken by how far out the clip really is.
const strain = (z: { f0Median: number; brightness: number }): number => z.f0Median + z.brightness;
rows.sort((a, b) => b.score - a.score || strain(b.acoustic) - strain(a.acoustic));

const fixed = (value: number): string => value.toFixed(2);
console.log(
  ['score', 'tag', 'zF0', 'zF0p90', 'zBright', 'voiced', 'baseline', 'speaker', 'file'].join('\t'),
);
for (const row of rows.slice(0, limit)) {
  console.log(
    [
      fixed(row.score),
      row.tag ?? '-',
      fixed(row.acoustic.f0Median),
      fixed(row.acoustic.f0P90),
      fixed(row.acoustic.brightness),
      fixed(row.clip.features.voicedRatio),
      row.pooled ? 'pooled' : 'speaker',
      row.clip.speaker,
      row.clip.file,
    ].join('\t'),
  );
}
console.error(
  `${rows.length} clips from ${bySpeaker.size} speakers; ${unreadable} skipped (no speech or not 16-bit WAV)`,
);
