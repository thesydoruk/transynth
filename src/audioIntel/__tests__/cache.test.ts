import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  readAudioIntelCacheAt,
  transcribeWavCachedAt,
  writeAudioIntelCacheAt,
} from '../cacheStore';
import type { AudioIntelTranscript } from '../types';

const transcript: AudioIntelTranscript = {
  text: 'Okay.',
  confidence: 0.8,
  duration: 0.9,
  language: 'en',
  segments: [{ start: 0, end: 0.9, text: 'Okay.', confidence: 0.8 }],
};

describe('audio-intel cache store', () => {
  const originalFetch = globalThis.fetch;
  let tmp = '';

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('round-trips a transcript keyed by path+mtime+size', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-intel-cache-'));
    const cacheDir = path.join(tmp, 'cache');
    const wav = path.join(tmp, 'line.wav');
    fs.writeFileSync(wav, 'RIFF');
    expect(readAudioIntelCacheAt(cacheDir, wav)).toBeNull();
    writeAudioIntelCacheAt(cacheDir, wav, transcript);
    expect(readAudioIntelCacheAt(cacheDir, wav)).toEqual(transcript);
  });

  it('hits the API once and serves the second call from disk', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-intel-cached-'));
    const cacheDir = path.join(tmp, 'cache');
    const wavPath = path.join(tmp, 'line.wav');
    fs.writeFileSync(wavPath, 'RIFF');
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ text: 'Okay.', segments: [] }),
      } as Response;
    }) as typeof fetch;

    const first = await transcribeWavCachedAt(cacheDir, wavPath);
    const second = await transcribeWavCachedAt(cacheDir, wavPath);
    expect(first.text).toBe('Okay.');
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });
});
