import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadInfoVoiceResponseNumbers,
  voiceVariantFromOrdinal,
  _infoVoiceResponseCacheSizeForTests,
  _resetInfoVoiceResponseCacheForTests,
} from '../infoResponseNumbers';

afterEach(() => {
  _resetInfoVoiceResponseCacheForTests();
});

describe('voiceVariantFromOrdinal', () => {
  it('maps NAM1 ordinal to TRDA response number', () => {
    expect(voiceVariantFromOrdinal(1, [2])).toBe(2);
    expect(voiceVariantFromOrdinal(1, [1, 3, 2])).toBe(1);
    expect(voiceVariantFromOrdinal(2, [1, 3, 2])).toBe(3);
    expect(voiceVariantFromOrdinal(3, [1, 3, 2])).toBe(2);
  });

  it('falls back to ordinal when map missing or short', () => {
    expect(voiceVariantFromOrdinal(2, undefined)).toBe(2);
    expect(voiceVariantFromOrdinal(3, [1, 2])).toBe(3);
  });
});

describe('loadInfoVoiceResponseNumbers cache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'info-resp-cache-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('evicts the oldest plugin once the LRU is full', () => {
    const first = path.join(tmpDir, 'first.esp');
    writeMinimalPlugin(first);
    loadInfoVoiceResponseNumbers(first);
    expect(_infoVoiceResponseCacheSizeForTests()).toBe(1);

    for (let i = 0; i < 8; i++) {
      const file = path.join(tmpDir, `plugin-${i}.esp`);
      writeMinimalPlugin(file);
      loadInfoVoiceResponseNumbers(file);
    }

    expect(_infoVoiceResponseCacheSizeForTests()).toBe(8);
    loadInfoVoiceResponseNumbers(first);
    expect(_infoVoiceResponseCacheSizeForTests()).toBe(8);
  });
});

const writeMinimalPlugin = (filePath: string): void => {
  const buf = Buffer.alloc(32);
  buf.write('TES4', 0, 4, 'ascii');
  buf.writeUInt32LE(4, 4);
  fs.writeFileSync(filePath, buf);
};
