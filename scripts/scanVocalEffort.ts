#!/usr/bin/env tsx
/**
 * Rank original voice clips by vocal effort, to calibrate shout tagging by ear.
 *
 * Reads a folder of 16-bit WAV clips laid out as `<speaker>/<clip>.wav` (the
 * Bethesda voice-type layout, decoded), builds a baseline per speaker and
 * prints one TSV row per clip, most strained first. Listen to the top, the
 * bottom and the rows around the thresholds in `vocalEffort/decide.ts`.
 *
 * `--calm=<file>` names the clips a baseline may be built from, one
 * `<speaker>/<clip>` per line (no extension). Without it every clip counts,
 * which hides the shouts of a voice type that mostly shouts.
 *
 * Only the acoustic gate is scored here: the text and the actor note, which
 * `shouting` also needs, come from the plugin and are not wired in yet. So the
 * tag column shows `loud` at most. Nothing is written anywhere.
 *
 * Usage:
 *   npm run voice:scan-effort -- <dir>
 *   npm run voice:scan-effort -- <dir> --calm=calm.txt --speaker=NPCFPiper --limit=200
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
  console.error(
    'Usage: npm run voice:scan-effort -- <dir> [--calm=FILE] [--speaker=NAME] [--limit=N]',
  );
  process.exit(1);
}
const onlySpeaker = arg('speaker');
const limit = Number(arg('limit') ?? 0) || undefined;
const calmFile = arg('calm');
const calmKeys = calmFile
  ? new Set(
      fs
        .readFileSync(calmFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/\\/g, '/').toLowerCase())
        .filter(Boolean),
    )
  : null;

type Clip = { speaker: string; file: string; features: EffortFeatures; calm: boolean };

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
    const key = `${speaker}/${path.basename(entry.name, path.extname(entry.name))}`.toLowerCase();
    const calm = calmKeys ? calmKeys.has(key) : true;
    if (features) clips.push({ speaker, file: path.relative(root, file), features, calm });
    else unreadable += 1;
  } catch {
    unreadable += 1;
  }
}

const speakers = new Set(clips.map((clip) => clip.speaker));
const calmBySpeaker = new Map<string, EffortFeatures[]>();
for (const clip of clips) {
  if (!clip.calm) continue;
  const list = calmBySpeaker.get(clip.speaker) ?? [];
  list.push(clip.features);
  calmBySpeaker.set(clip.speaker, list);
}
// Speakers with a handful of calm clips borrow the baseline of everyone scanned.
const pooled = buildSpeakerBaseline([...calmBySpeaker.values()].flat());
const baselines = new Map(
  [...calmBySpeaker]
    .filter(([, own]) => own.length >= MIN_BASELINE_CLIPS)
    .map(([speaker, own]) => [speaker, buildSpeakerBaseline(own)]),
);

const rows = clips.flatMap((clip) => {
  const own = baselines.get(clip.speaker);
  const baseline = own ?? pooled;
  if (!baseline) return [];
  const acoustic = effortZScores(clip.features, baseline);
  const { strength, tag } = decideVocalEffort({ acoustic });
  return [{ clip, acoustic, strength: strength ?? 0, tag, pooled: !own }];
});
rows.sort((a, b) => b.strength - a.strength);

const fixed = (value: number): string => value.toFixed(2);
console.log(
  ['strength', 'tag', 'zF0', 'zBright', 'voiced', 'baseline', 'speaker', 'file'].join('\t'),
);
for (const row of rows.slice(0, limit)) {
  console.log(
    [
      fixed(row.strength),
      row.tag ?? '-',
      fixed(row.acoustic.f0Median),
      fixed(row.acoustic.brightness),
      fixed(row.clip.features.voicedRatio),
      row.pooled ? 'pooled' : 'speaker',
      row.clip.speaker,
      row.clip.file,
    ].join('\t'),
  );
}
console.error(
  `${rows.length} clips from ${speakers.size} speakers; ${unreadable} skipped (no speech or not 16-bit WAV)`,
);
