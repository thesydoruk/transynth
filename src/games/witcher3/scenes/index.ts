/**
 * Who says each Witcher 3 line, and to whom, from the game's own scene files.
 *
 * A dialogue is a `.w2scene` (CR2W) whose `CStorySceneLine` objects each carry
 * the line's string id (`dialogLine`), the speaker's voice tag (`voicetag`,
 * e.g. `GERALT`) and usually who is addressed (`speakingTo`). A voice tag's sex
 * is in `gameplay/globals/scene_voice_tags.csv` (one per DLC as well):
 * `Voicetag;Sex;Pitch;Template;Id`, sex `M`, `F` or `W`.
 *
 * Measured on the Remastered install: 6,380 scenes in 9 bundles, read in ~18 s;
 * every one of the 64,718 voiced lines has a speaker, 48,340 lines name an
 * addressee, and 1,691 of the 1,701 voice tags used have a sex.
 *
 * Scenes are read from `.bundle` archives anywhere under a root (a mod's
 * `content/*.bundle`) and from loose files, which is how a folder import of
 * the game stages them (see `import/folder.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SpeakerGender } from '../../../dialog/gender';
import { readBundleEntry, readBundleIndex } from '../bundles';
import { readCr2w } from '../cr2w';

export type W3SceneLine = { speaker: string; addressee: string | null };

export type W3SceneSpeakers = {
  /** String id → who says it. */
  lines: Map<number, W3SceneLine>;
  /** Voice tag → gender, from the voice-tag tables. */
  genders: Map<string, SpeakerGender>;
  scenes: number;
};

export const isW3SceneFile = (entryPath: string): boolean =>
  entryPath.toLowerCase().endsWith('.w2scene');
export const isW3VoiceTagTable = (entryPath: string): boolean =>
  entryPath.toLowerCase().endsWith('scene_voice_tags.csv');

/**
 * `M` and `F` are what they say. `W` marks women too — every tag carrying it
 * is one (`MATHILDA`, `FOREST NYMPH`, `TOUSSAINT BONVIVANT WOMAN 01`).
 */
const SEX_GENDER: Readonly<Record<string, SpeakerGender>> = { M: 'male', F: 'female', W: 'female' };

const normalizeW3VoiceTag = (tag: string): string => tag.trim().toUpperCase();

export const parseW3VoiceTagTable = (csv: string, into: Map<string, SpeakerGender>): void => {
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [tag, sex] = line.split(';');
    if (!tag?.trim()) continue;
    into.set(normalizeW3VoiceTag(tag), SEX_GENDER[(sex ?? '').trim().toUpperCase()] ?? 'unknown');
  }
};

/** Every spoken line of one scene file. */
const readW3SceneLines = (scene: Buffer, into: Map<number, W3SceneLine>): void => {
  const file = readCr2w(scene, (className) => className === 'CStorySceneLine');
  for (const chunk of file.chunks) {
    if (chunk.className !== 'CStorySceneLine') continue;
    const id = chunk.properties.get('dialogLine')?.value;
    const tag = chunk.properties.get('voicetag')?.value;
    if (typeof id !== 'number' || id === 0 || typeof tag !== 'string' || !tag) continue;
    const to = chunk.properties.get('speakingTo')?.value;
    into.set(id, {
      speaker: normalizeW3VoiceTag(tag),
      addressee: typeof to === 'string' && to ? normalizeW3VoiceTag(to) : null,
    });
  }
};

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

const walk = (dir: string, visit: (file: string) => void): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(full, visit);
    } else if (entry.isFile()) visit(full);
  }
};

/** Speakers of every scene under `root`, in bundles or loose. Later files win a clash. */
export const collectW3SceneSpeakers = (root: string): W3SceneSpeakers => {
  const result: W3SceneSpeakers = { lines: new Map(), genders: new Map(), scenes: 0 };
  const take = (name: string, data: Buffer): void => {
    if (isW3VoiceTagTable(name)) parseW3VoiceTagTable(data.toString('utf8'), result.genders);
    else if (isW3SceneFile(name)) {
      result.scenes++;
      readW3SceneLines(data, result.lines);
    }
  };
  const files: string[] = [];
  walk(root, (file) => files.push(file));
  files.sort();
  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.bundle')) {
      const index = readBundleIndex(file);
      const wanted = index.entries.filter(
        (e) => isW3SceneFile(e.path) || isW3VoiceTagTable(e.path),
      );
      if (wanted.length === 0) continue;
      const fd = fs.openSync(file, 'r');
      try {
        for (const entry of wanted) take(entry.path, readBundleEntry(fd, entry));
      } finally {
        fs.closeSync(fd);
      }
    } else if (isW3SceneFile(lower) || isW3VoiceTagTable(lower)) {
      take(lower, fs.readFileSync(file));
    }
  }
  return result;
};
