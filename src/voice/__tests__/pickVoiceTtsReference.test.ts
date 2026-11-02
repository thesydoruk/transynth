import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import type { SpeakerRefCacheEntry } from '../pickVoiceTtsReference';
import type { ResolvedSpeakerReference } from '../speakerReference/resolve';

// The game registry (test setup) already evaluated the voice modules; start
// from an empty registry so the mocks below are what the module under test links to.
jest.resetModules();

const resolveMock = jest.fn<() => Promise<ResolvedSpeakerReference | null>>();

// Loaded before the mock is registered: a factory cannot import while linking.
const eligibility = await import('../speakerReference/eligibility');

jest.unstable_mockModule('../speakerReference', () => ({
  ...eligibility,
  resolveSpeakerReferenceForSpeaker: () => resolveMock(),
}));

jest.unstable_mockModule('../decideVoiceReferenceSource', () => ({
  decideVoiceReferenceSource: () => ({ kind: 'speaker', reason: 'mode' }),
  isLineReferenceSuitable: () => true,
  isLineReferenceTooLong: () => false,
}));

const { pickVoiceTtsReference } = await import('../pickVoiceTtsReference');

const entry: VoiceFileEntry = {
  relPath: 'Sound/Voice/Mod.esp/Speaker/00000001_1.wav',
  absolutePath: '/pkg/00000001_1.wav',
  fileName: '00000001_1',
  lineKey: '00000001',
  variant: 1,
  ext: 'wav',
};

const resolved: ResolvedSpeakerReference = {
  wavPath: '/cache/Speaker.wav',
  pick: { lineKey: '00000002', variant: 1 },
  source: 'auto',
};

// The line clip is read from disk even when the speaker reference replaces it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-voice-ref-'));
const lineEnglishWav = path.join(tmpDir, 'line.wav');
const SAMPLE_RATE = 22_050;
const writeSilentWav = (filePath: string, seconds: number): void => {
  const dataSize = SAMPLE_RATE * seconds * 2;
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
  fs.writeFileSync(filePath, buffer);
};
writeSilentWav(lineEnglishWav, 1);
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const pick = (speakerRefCache: Map<string, SpeakerRefCacheEntry>) =>
  pickVoiceTtsReference({
    db: {} as Tx,
    modId: 1,
    packageDir: '/pkg',
    pluginRelPath: 'Mod.esp',
    speakerKey: 'Speaker',
    entry,
    lineEnglishWav,
    lineSource: 'Hello there.',
    referenceMode: 'speaker',
    voiceSources: new Map(),
    getSiblingEntries: () => [],
    speakerRefCache,
  });

beforeEach(() => {
  resolveMock.mockReset();
});

describe('pickVoiceTtsReference speaker resolution', () => {
  it('runs one resolution for parallel lines of the same speaker', async () => {
    let finish: (value: ResolvedSpeakerReference) => void = () => {};
    resolveMock.mockReturnValue(
      new Promise<ResolvedSpeakerReference | null>((resolve) => {
        finish = resolve;
      }),
    );
    const cache = new Map<string, SpeakerRefCacheEntry>();

    const first = pick(cache);
    const second = pick(cache);
    finish(resolved);
    const [a, b] = await Promise.all([first, second]);

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(a.strategy).toBe('speaker');
    expect(a.clips[0]?.wavPath).toBe(resolved.wavPath);
    expect(b.clips[0]?.wavPath).toBe(resolved.wavPath);
    expect(cache.get('Speaker')?.resolved).toBe(resolved);
  });

  it('does not rescan a speaker that has no usable take', async () => {
    resolveMock.mockResolvedValue(null);
    const cache = new Map<string, SpeakerRefCacheEntry>();

    const first = await pick(cache);
    const second = await pick(cache);

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(first.strategy).toBe('line');
    expect(second.strategy).toBe('line');
  });

  it('retries after a rejected resolution', async () => {
    resolveMock.mockRejectedValueOnce(new Error('disk gone')).mockResolvedValue(resolved);
    const cache = new Map<string, SpeakerRefCacheEntry>();

    await expect(pick(cache)).rejects.toThrow('disk gone');
    const second = await pick(cache);

    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(second.strategy).toBe('speaker');
  });

  it('scans separately for different jobs', async () => {
    resolveMock.mockResolvedValue(resolved);

    await pick(new Map());
    await pick(new Map());

    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});
