import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VoiceFileEntry } from '../../discoverVoiceFiles';
import { getOrDecodeEntryReferenceWav, getOrReuseSpeakerReferenceWav } from '../cache';
import { isUsableWavFile, wavDurationSec } from '../pcm';

const SAMPLE_RATE = 22_050;

const writeTestWav = (filePath: string, durationSec: number): void => {
  const count = Math.floor(SAMPLE_RATE * durationSec);
  const dataSize = count * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < count; i++) {
    buffer.writeInt16LE(
      Math.round(6000 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE)),
      44 + i * 2,
    );
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
};

describe('speaker reference cache', () => {
  let tmpDir: string;
  let entryDir: string;
  let workDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speaker-ref-cache-'));
    entryDir = path.join(tmpDir, 'entry-ref');
    workDir = path.join(tmpDir, 'work');
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const makeEntry = (lineKey: string, durationSec: number): VoiceFileEntry => {
    const fileName = `${lineKey}_1.wav`;
    const absolutePath = path.join(tmpDir, 'pkg', fileName);
    writeTestWav(absolutePath, durationSec);
    return {
      relPath: `Sound/Voice/Mod.esp/Speaker/${fileName}`,
      absolutePath,
      fileName,
      lineKey,
      variant: 1,
      ext: 'wav',
    };
  };

  it('decodes the same take from parallel lines without corrupting the cache', async () => {
    const entry = makeEntry('00000001', 2);

    const paths = await Promise.all(
      Array.from({ length: 4 }, () => getOrDecodeEntryReferenceWav(entry, entryDir, workDir)),
    );

    expect(new Set(paths).size).toBe(1);
    expect(isUsableWavFile(paths[0]!)).toBe(true);
    expect(wavDurationSec(paths[0]!)).toBeCloseTo(2, 1);
    expect(fs.readdirSync(entryDir).sort()).toEqual(['00000001_1.source', '00000001_1.wav']);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('leaves no cache files behind when a take fails to decode', async () => {
    const entry = makeEntry('00000002', 1);
    fs.writeFileSync(entry.absolutePath, 'not audio at all');

    await expect(getOrDecodeEntryReferenceWav(entry, entryDir, workDir)).rejects.toThrow();
    expect(fs.existsSync(entryDir) ? fs.readdirSync(entryDir) : []).toEqual([]);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('publishes the speaker WAV only once it is complete', async () => {
    const entry = makeEntry('00000003', 3);
    const speakerDir = path.join(tmpDir, 'speaker-ref');
    const decoded = await getOrDecodeEntryReferenceWav(entry, entryDir, workDir);

    const outPath = await getOrReuseSpeakerReferenceWav(
      'Speaker',
      speakerDir,
      'auto:x',
      async () => decoded,
    );

    expect(outPath).toBe(path.join(speakerDir, 'Speaker.wav'));
    expect(fs.readdirSync(speakerDir).sort()).toEqual(['Speaker.source', 'Speaker.wav']);
    expect(wavDurationSec(outPath)).toBeCloseTo(3, 1);
  });
});
