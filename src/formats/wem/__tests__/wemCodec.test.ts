import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../../voice/voiceToolPaths';
import {
  buildOpusWem,
  describeWem,
  parseOpusWem,
  wemCodecOfTake,
  wemTakeCodec,
  WEM_OPUS_FORMAT_TAG,
} from '../index';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-codec-'));
const tone = path.join(dir, 'tone.wav');
const TONE_SECONDS = 1.3;

/** A RIFF/WAVE shell carrying only a format tag. */
const shellWithTag = (formatTag: number): Buffer => {
  const fmt = Buffer.alloc(26);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(18, 4);
  fmt.writeUInt16LE(formatTag, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(44100, 12);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(fmt.length + 4, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, fmt]);
};

const wavSeconds = (file: string): number => {
  const wav = fs.readFileSync(file);
  const byteRate = wav.readUInt32LE(28);
  const data = wav.indexOf(Buffer.from('data', 'latin1'), 12);
  return wav.readUInt32LE(data + 4) / byteRate;
};

beforeAll(async () => {
  await execFileAsync(resolveFfmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=330:duration=${TONE_SECONDS}`,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-sample_fmt',
    's16',
    tone,
  ]);
}, 30_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('codec of a WEM take', () => {
  it('names what a file is from its fmt tag', () => {
    const opus = buildOpusWem({
      packets: [Buffer.alloc(8)],
      channels: 1,
      samples: 960,
      preSkip: 312,
    });
    expect(describeWem(opus)).toMatchObject({
      formatTag: WEM_OPUS_FORMAT_TAG,
      codec: 'opus',
      channels: 1,
      sampleRate: 48000,
      fmtSize: 36,
    });
    expect(describeWem(opus).chunks.map((chunk) => chunk.id)).toEqual([
      'fmt ',
      'hash',
      'seek',
      'data',
    ]);
    expect(describeWem(shellWithTag(0xffff)).codec).toBe('vorbis');
    expect(describeWem(shellWithTag(0xfffe)).codec).toBe('pcm');
    expect(describeWem(shellWithTag(0x1234)).codec).toBe('unknown');
    expect(() => describeWem(Buffer.from('FUZE and nothing else'))).toThrow(/RIFF/);
  });

  it('finds the implementation by the tag: Opus or Vorbis', () => {
    const opus = buildOpusWem({
      packets: [Buffer.alloc(8)],
      channels: 1,
      samples: 960,
      preSkip: 0,
    });
    expect(wemCodecOfTake(opus)).toBe(wemTakeCodec('opus'));
    expect(wemTakeCodec('opus').formatTag).toBe(0x3041);
    expect(wemCodecOfTake(shellWithTag(0xffff))).toBe(wemTakeCodec('vorbis'));
    expect(wemTakeCodec('vorbis').formatTag).toBe(0xffff);
  });

  it('refuses a take one reader is handed in the other codec, by name and tag', () => {
    // A Wwise Vorbis tag on something that is not the game's layout.
    const vorbis = wemTakeCodec('vorbis');
    expect(() => vorbis.durationSeconds(shellWithTag(0xffff))).toThrow(
      /Unsupported WEM codec: the take is Wwise Vorbis \(fmt tag 0xffff\) in a layout that is not read/,
    );
    // The Opus reader refuses a Vorbis take instead of misreading it.
    expect(() => parseOpusWem(shellWithTag(0xffff))).toThrow(
      /the take is Wwise Vorbis \(fmt tag 0xffff\); a WEM Opus take was expected/,
    );
  });

  it('refuses any other codec, naming the tag', () => {
    expect(() => wemCodecOfTake(shellWithTag(0xfffe))).toThrow(/PCM \(fmt tag 0xfffe\)/);
    expect(() => wemCodecOfTake(shellWithTag(0x3040))).toThrow(
      /Ogg Opus in a WEM \(fmt tag 0x3040\)/,
    );
    expect(() => wemCodecOfTake(shellWithTag(0x1234))).toThrow(
      /an unknown codec \(fmt tag 0x1234\).*no reader or writer/,
    );
  });

  it('can leave the hash chunk out', () => {
    const take = buildOpusWem({
      packets: [Buffer.alloc(8)],
      channels: 1,
      samples: 960,
      preSkip: 0,
      hash: null,
    });
    expect(describeWem(take).chunks.map((chunk) => chunk.id)).toEqual(['fmt ', 'seek', 'data']);
    expect(parseOpusWem(take).hasHashChunk).toBe(false);
    expect(parseOpusWem(take).packets).toHaveLength(1);
  });
});

describe('WEM Opus through ffmpeg', () => {
  const codec = wemTakeCodec('opus');

  it('encodes a WAV at its own rate into a take exactly as long', async () => {
    expect(codec.takeSampleRate(null)).toBe(48000);
    const take = await codec.encodeFromWav(tone, { sourceTake: null });
    expect(describeWem(take).codec).toBe('opus');
    expect(parseOpusWem(take).samples).toBe(Math.round(TONE_SECONDS * 48000));
    expect(codec.durationSeconds(take)).toBeCloseTo(wavSeconds(tone), 6);
  }, 60_000);

  it('decodes a take back to a WAV of the same length', async () => {
    const take = await codec.encodeFromWav(tone, { sourceTake: null });
    const out = path.join(dir, 'decoded.wav');
    await wemCodecOfTake(take).decodeToWav(take, out, { sampleRate: 22050 });
    const wav = fs.readFileSync(out);
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt16LE(22)).toBe(1);
    // A reference clip, not a take: the decoder's own lead-in may stay on it.
    expect(Math.abs(wavSeconds(out) - TONE_SECONDS)).toBeLessThan(0.05);
  }, 60_000);

  it('mirrors the container of the take it replaces', async () => {
    const plain = await codec.encodeFromWav(tone, { sourceTake: null });
    const original = parseOpusWem(plain);
    // A game's take with its own channel-layout word and no hash chunk.
    const fmt = Buffer.from(original.fmt);
    fmt.writeUInt32LE(0x0000_c0de, 0x14);
    const source = buildOpusWem({
      packets: original.packets,
      channels: 1,
      samples: original.samples,
      preSkip: original.preSkip,
      template: { fmt },
      hash: null,
    });

    const mirrored = parseOpusWem(await codec.encodeFromWav(tone, { sourceTake: source }));
    expect(mirrored.fmt.readUInt32LE(0x14)).toBe(0x0000_c0de);
    expect(mirrored.hasHashChunk).toBe(false);
    expect(mirrored.samples).toBe(original.samples);

    // A source in another codec is no template: the defaults apply.
    const fromForeign = parseOpusWem(
      await codec.encodeFromWav(tone, { sourceTake: shellWithTag(0xffff) }),
    );
    expect(fromForeign.hasHashChunk).toBe(true);
    expect(fromForeign.fmt.readUInt32LE(0x14)).toBe(original.fmt.readUInt32LE(0x14));
  }, 60_000);
});
