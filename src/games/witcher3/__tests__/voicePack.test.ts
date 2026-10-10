import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../../voice/voiceToolPaths';
import { buildOpusWem } from '../audio/opusWem';
import {
  buildW3SpeechAudio,
  parseW3SpeechAudio,
  readW3SpeechBlock,
  readW3SpeechIndex,
  writeW3Speech,
} from '../w3speech';
import { decodeLipsync, encodeLipsync } from '../w3speech/lipsync';
import { writeW3Vlq } from '../w3strings';
import { buildW3VoicePack } from '../voice/pack';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3pack-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const lip = encodeLipsync({
  fps: 30,
  duration: 0.5,
  frames: 16,
  dt: Math.fround(0.5 / 15),
  rootCompression: 2,
  root: Buffer.alloc(64),
  tracks: [
    {
      dt: Math.fround(0.5 / 15),
      values: Array.from({ length: 16 }, (_, i) => Math.fround(i / 20)),
    },
  ],
});

/** `extract/content/content0/enpc.w3speech` with three short lines. */
const writeSource = (extract: string): string => {
  const dir = path.join(extract, 'content', 'content0');
  fs.mkdirSync(dir, { recursive: true });
  const ids = [10, 20, 30];
  const shell = path.join(root, 'shell.w3speech');
  const head = Buffer.alloc(10);
  head.write('CPSW', 0, 'latin1');
  head.writeUInt32LE(164, 4);
  head.writeUInt16LE(0x4397, 8);
  const rows = Buffer.alloc(ids.length * 40 + 2);
  ids.forEach((id, i) => rows.writeUInt32LE((id ^ 0x79321793) >>> 0, i * 40));
  rows.writeUInt16LE(0x5139, ids.length * 40);
  fs.writeFileSync(shell, Buffer.concat([head, writeW3Vlq(ids.length), rows]));
  const fd = fs.openSync(shell, 'r');
  const out = path.join(dir, 'enpc.w3speech');
  try {
    const take = buildOpusWem({
      packets: [Buffer.from([0xf8, 0xff, 0xfe])],
      channels: 1,
      samples: 900,
      preSkip: 312,
    });
    writeW3Speech(fd, readW3SpeechIndex(fd), out, {
      overrides: new Map(ids.map((id) => [id, { audio: buildW3SpeechAudio(take, 0.02), lip }])),
    });
  } finally {
    fs.closeSync(fd);
  }
  return out;
};

describe('buildW3VoicePack', () => {
  it('swaps a synthesized line into a copy written under the voice slot', async () => {
    const extract = path.join(root, 'extract');
    const source = writeSource(extract);
    const localize = path.join(root, 'localize');
    const takeDir = path.join(localize, 'content', 'content0', 'enpc');
    fs.mkdirSync(takeDir, { recursive: true });
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=0.8',
      path.join(takeDir, '20.wav'),
    ]);

    const out = path.join(root, 'out');
    const files = await buildW3VoicePack({
      extractRoot: extract,
      localizeDir: localize,
      outDir: out,
      sourceLang: 'en',
    });
    expect(files).toEqual([
      { relPath: 'content/content0/brpc.w3speech', replaced: 1, lines: 3, rebuilt: 1 },
    ]);
    // The stale game blocks were rebuilt from the `.wav` and kept beside it.
    expect(fs.existsSync(path.join(takeDir, '20.audio'))).toBe(true);

    const src = fs.openSync(source, 'r');
    const pack = fs.openSync(path.join(out, 'content', 'content0', 'brpc.w3speech'), 'r');
    try {
      const a = readW3SpeechIndex(src);
      const b = readW3SpeechIndex(pack);
      expect(b.langKey).toBe(a.langKey);
      expect(b.rows.map((r) => r.id)).toEqual([10, 20, 30]);
      const audio = (fd: number, row: (typeof b.rows)[number]) =>
        readW3SpeechBlock(fd, row.audioOffset, row.audioSize);
      expect(audio(pack, b.rows[0]!)).toEqual(audio(src, a.rows[0]!));
      expect(parseW3SpeechAudio(audio(pack, b.rows[1]!)).duration).toBeCloseTo(0.8, 1);
      const replacedLip = decodeLipsync(
        readW3SpeechBlock(pack, b.rows[1]!.lipOffset, b.rows[1]!.lipSize),
      );
      expect(replacedLip.duration).toBeGreaterThan(0.8);
    } finally {
      fs.closeSync(src);
      fs.closeSync(pack);
    }
  });

  it('writes nothing for a container with no synthesized lines', async () => {
    const extract = path.join(root, 'extract');
    writeSource(extract);
    const files = await buildW3VoicePack({
      extractRoot: extract,
      localizeDir: path.join(root, 'empty'),
      outDir: path.join(root, 'out'),
      sourceLang: 'en',
    });
    expect(files).toEqual([]);
  });
});
