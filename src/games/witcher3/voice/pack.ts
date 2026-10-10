/**
 * Build the speech file a player installs: the source container with every
 * synthesized line swapped in, written under a voice-language slot the game
 * already knows.
 *
 * The game has no Ukrainian voice slot and no config that adds one, so the
 * pack takes an existing language's file name — Brazilian Portuguese (`br`)
 * by default, which few players have installed and which the Ukrainian AI
 * voice mod already proved on the Remastered edition. The container keeps the
 * source's language key: the game reads a file's key from its header, so an
 * English-keyed table under the Brazilian name loads as-is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../../logger';
import { ensureDir } from '../../../utils/file';
import type { MimicModel } from '../mimic/model';
import { listW3SpeechFiles } from '../packLayout';
import {
  readW3SpeechBlock,
  readW3SpeechIndex,
  writeW3Speech,
  type W3SpeechLineOverride,
} from '../w3speech';
import { buildW3Take } from './buildTake';
import { w3LocalizedTakeDir } from './takes';

export const W3_DEFAULT_VOICE_SLOT = 'br';

export type BuildW3VoicePackInput = {
  /** The mod's extracted upload, holding the source containers. */
  extractRoot: string;
  /** `_localize_{key}/{lang}/` with the synthesized takes. */
  localizeDir: string;
  outDir: string;
  /** Speech language of the source containers (`en` reads `enpc.w3speech`). */
  sourceLang: string;
  /** Speech file name to write as (`br` writes `brpc.w3speech`). */
  slot?: string;
  model?: MimicModel | null;
  /** Where `model` was loaded from, so it can run on worker threads. */
  modelPath?: string | null;
  onProgress?: (message: string) => void;
};

export type W3VoicePackFile = { relPath: string; replaced: number; lines: number; rebuilt: number };

const isOlder = (file: string, than: string): boolean =>
  !fs.existsSync(file) || fs.statSync(file).mtimeMs < fs.statSync(than).mtimeMs;

/** Synthesized takes for one container, with their game blocks rebuilt where stale. */
const collectOverrides = async (
  takeDir: string,
  fd: number,
  rows: Map<number, { audioOffset: number; audioSize: number; lipOffset: number; lipSize: number }>,
  model: MimicModel | null | undefined,
  modelPath: string | null | undefined,
): Promise<{ overrides: Map<number, W3SpeechLineOverride>; rebuilt: number }> => {
  const overrides = new Map<number, W3SpeechLineOverride>();
  let rebuilt = 0;
  if (!fs.existsSync(takeDir)) return { overrides, rebuilt };
  for (const name of fs.readdirSync(takeDir)) {
    const m = /^(\d+)\.wav$/i.exec(name);
    if (!m) continue;
    const id = Number(m[1]);
    const row = rows.get(id);
    if (!row) continue;
    const wav = path.join(takeDir, name);
    const audioPath = path.join(takeDir, `${id}.audio`);
    const lipPath = path.join(takeDir, `${id}.lip`);
    if (isOlder(audioPath, wav) || isOlder(lipPath, wav)) {
      const built = await buildW3Take({
        audioPath: wav,
        originalAudio: readW3SpeechBlock(fd, row.audioOffset, row.audioSize),
        originalLip: readW3SpeechBlock(fd, row.lipOffset, row.lipSize),
        model: model ?? null,
        modelPath: modelPath ?? null,
      });
      fs.writeFileSync(audioPath, built.audio);
      fs.writeFileSync(lipPath, built.lip);
      rebuilt++;
    }
    overrides.set(id, { audio: fs.readFileSync(audioPath), lip: fs.readFileSync(lipPath) });
  }
  return { overrides, rebuilt };
};

export const buildW3VoicePack = async (
  input: BuildW3VoicePackInput,
): Promise<W3VoicePackFile[]> => {
  const slot = (input.slot ?? W3_DEFAULT_VOICE_SLOT).toLowerCase();
  const containers = listW3SpeechFiles(input.extractRoot).filter(
    (file) => file.lang === input.sourceLang,
  );
  const written: W3VoicePackFile[] = [];
  for (const container of containers) {
    const containerRel = `${container.contentDir ? `${container.contentDir}/` : ''}${path.basename(container.absPath)}`;
    const fd = fs.openSync(container.absPath, 'r');
    try {
      const index = readW3SpeechIndex(fd);
      const rows = new Map(index.rows.map((row) => [row.id, row]));
      const takeDir = path.join(input.localizeDir, ...w3LocalizedTakeDir(containerRel).split('/'));
      const { overrides, rebuilt } = await collectOverrides(
        takeDir,
        fd,
        rows,
        input.model,
        input.modelPath,
      );
      if (overrides.size === 0) continue;
      const relPath = `${container.contentDir ? `${container.contentDir}/` : ''}${slot}pc.w3speech`;
      const outPath = path.join(input.outDir, ...relPath.split('/'));
      ensureDir(path.dirname(outPath));
      input.onProgress?.(`${relPath}: ${overrides.size} of ${index.rows.length} lines replaced`);
      writeW3Speech(fd, index, outPath, { overrides });
      written.push({ relPath, replaced: overrides.size, lines: index.rows.length, rebuilt });
      log.info(
        `Witcher 3 voice pack: ${relPath} — ${overrides.size}/${index.rows.length} lines (${rebuilt} rebuilt)`,
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  return written;
};
