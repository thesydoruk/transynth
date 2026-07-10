import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import {
  computeHesitationPenalty,
  scoreReferencePcm,
  scoreReferenceWav,
  voiceSpeakerKey,
} from '../speakerReferencePool';

const SAMPLE_RATE = 22_050;

const writeTestWav = (filePath: string, samples: Int16Array): void => {
  const dataSize = samples.length * 2;
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
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i]!, 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
};

const makeSpeechLike = (durationSec: number): Int16Array => {
  const count = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const amp = 6000 + 2000 * Math.sin(t * 3.7);
    samples[i] = Math.round(amp * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(t * 5)) * t));
  }
  return samples;
};

const makeSustainedVowel = (durationSec: number): Int16Array => {
  const count = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = Math.round(7000 * Math.sin((2 * Math.PI * 210 * i) / SAMPLE_RATE));
  }
  return samples;
};

describe('voiceSpeakerKey', () => {
  const voiceRoot = 'Data/Sound/Voice/Mod.esp';

  it('extracts speaker folder from voice rel path', () => {
    const entry = {
      relPath: 'Data/Sound/Voice/Mod.esp/AlexanderBrown/00002CBA_4.fuz',
    } as VoiceFileEntry;
    expect(voiceSpeakerKey(entry, voiceRoot)).toBe('AlexanderBrown');
  });

  it('returns empty when file is directly under voice root', () => {
    const entry = {
      relPath: 'Data/Sound/Voice/Mod.esp/00002CBA_4.fuz',
    } as VoiceFileEntry;
    expect(voiceSpeakerKey(entry, voiceRoot)).toBe('');
  });
});

describe('scoreReferencePcm', () => {
  it('prefers natural speech over sustained vowel hesitations', () => {
    const speech = makeSpeechLike(5);
    const vowel = makeSustainedVowel(5);
    expect(scoreReferencePcm(speech, SAMPLE_RATE)).toBeGreaterThan(
      scoreReferencePcm(vowel, SAMPLE_RATE),
    );
  });

  it('rejects mostly silent clips', () => {
    const silent = new Int16Array(SAMPLE_RATE * 4);
    expect(scoreReferencePcm(silent, SAMPLE_RATE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('rejects very short clips', () => {
    const shortClip = makeSpeechLike(0.4);
    expect(scoreReferencePcm(shortClip, SAMPLE_RATE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('prefers medium-length speech over very short active clips', () => {
    const medium = makeSpeechLike(5);
    const short = makeSpeechLike(1.2);
    expect(scoreReferencePcm(medium, SAMPLE_RATE)).toBeGreaterThan(
      scoreReferencePcm(short, SAMPLE_RATE),
    );
  });
});

describe('computeHesitationPenalty', () => {
  it('penalizes long low-ZCR active runs', () => {
    const frames = [
      ...Array.from({ length: 20 }, () => ({ rms: 9000, zcr: 0.01 })),
      ...Array.from({ length: 5 }, () => ({ rms: 9000, zcr: 0.2 })),
    ];
    const mixed = [
      ...Array.from({ length: 5 }, () => ({ rms: 9000, zcr: 0.2 })),
      ...Array.from({ length: 5 }, () => ({ rms: 9000, zcr: 0.2 })),
    ];
    expect(computeHesitationPenalty(frames)).toBeGreaterThan(computeHesitationPenalty(mixed));
  });
});

describe('scoreReferenceWav integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speaker-ref-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scores WAV files on disk', () => {
    const wavPath = path.join(tmpDir, 'speech.wav');
    writeTestWav(wavPath, makeSpeechLike(5));
    expect(scoreReferenceWav(wavPath)).toBeGreaterThan(0);
  });
});
