/**
 * Wwise Vorbis takes through ffmpeg: written from a WAV, read back, and held
 * against what libvorbis itself encoded. The audio is generated here — bursts
 * of tone with gaps, so the encoder switches between its two block sizes as it
 * does on speech.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../../voice/voiceToolPaths';
import { describeWem, wemCodecOfTake, wemTakeCodec } from '../index';
import { readOggPackets } from '../ogg';
import { wwiseCodebookLibrary } from '../vorbisCodebook';
import { fnv1Hash32 } from '../vorbisFields';
import { oggVorbisToWem, vorbisWemToOgg } from '../vorbisOgg';
import { packetBlockFlags, packetSampleCounts } from '../vorbisPackets';
import { rewriteVorbisSetup } from '../vorbisSetup';
import { decodeVorbisWemToWav, VORBIS_TAKE_QUALITY } from '../vorbisTranscode';
import { parseVorbisWem } from '../vorbisWem';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-vorbis-'));
const codec = wemTakeCodec('vorbis');
const SECONDS = 1.7;
/** `fmt ` body offset in a take: RIFF header, then the chunk header. */
const FMT = 20;
/** The key the game's own 32 kHz mono takes carry: FNV-1 of their setup packet. */
const GAME_32K_SETUP_KEY = 0xa6ff1d80;

const BURSTS = '0.3*sin(2*PI*180*t)*lt(mod(t,0.6),0.4)+0.2*sin(2*PI*2300*t)*lt(mod(t,0.33),0.2)';

const ffmpeg = (args: string[]): Promise<unknown> =>
  execFileAsync(resolveFfmpegPath(), ['-y', '-v', 'error', ...args]);

const writeBursts = async (
  name: string,
  sampleRate: number,
  seconds = SECONDS,
): Promise<string> => {
  const file = path.join(dir, name);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${BURSTS}':s=${sampleRate}:d=${seconds}`,
    '-ac',
    '1',
    '-sample_fmt',
    's16',
    file,
  ]);
  return file;
};

const readWav = (file: string): { pcm: Int16Array; sampleRate: number; channels: number } => {
  const wav = fs.readFileSync(file);
  const data = wav.indexOf(Buffer.from('data', 'latin1'), 12);
  const size = Math.min(wav.readUInt32LE(data + 4), wav.length - data - 8);
  const pcm = new Int16Array(size / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(data + 8 + i * 2);
  return { pcm, sampleRate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22) };
};

const correlation = (a: Int16Array, b: Int16Array): number => {
  let aa = 0;
  let bb = 0;
  let ab = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
    ab += a[i]! * b[i]!;
  }
  return ab / Math.sqrt(aa * bb);
};

const encodeOgg = async (wav: string, name: string, extra: string[] = []): Promise<Buffer> => {
  const ogg = path.join(dir, name);
  await ffmpeg([
    '-i',
    wav,
    '-c:a',
    'libvorbis',
    '-q:a',
    String(VORBIS_TAKE_QUALITY),
    ...extra,
    ogg,
  ]);
  return fs.readFileSync(ogg);
};

let wav44 = '';
let take44: Buffer = Buffer.alloc(0);

beforeAll(async () => {
  wav44 = await writeBursts('bursts44.wav', 44100);
  take44 = await codec.encodeFromWav(wav44, { sourceTake: null });
}, 60_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writing a Wwise Vorbis take', () => {
  it('states exactly the length of the WAV, in the game’s container', () => {
    const samples = readWav(wav44).pcm.length;
    expect(describeWem(take44)).toMatchObject({
      formatTag: 0xffff,
      codec: 'vorbis',
      channels: 1,
      sampleRate: 44100,
      fmtSize: 66,
    });
    expect(describeWem(take44).chunks.map((chunk) => chunk.id)).toEqual(['fmt ', 'data']);
    expect(take44.readUInt32LE(4)).toBe(take44.length - 8);
    expect(wemCodecOfTake(take44)).toBe(codec);

    const take = parseVorbisWem(take44);
    expect(take.samples).toBe(samples);
    expect(codec.durationSeconds(take44)).toBe(samples / 44100);
    expect(take.blockSizeBits).toEqual([8, 11]);
  });

  it('fills every fmt field the way the game’s takes do', () => {
    const take = parseVorbisWem(take44);
    const fmt = take44.subarray(FMT, FMT + 66);
    const dataSize = take44.readUInt32LE(FMT + 66 + 4);
    const seekSize = fmt.readUInt32LE(0x28);
    const setupSize = 2 + take.setup.length;

    expect(fmt.readUInt16LE(0x0c)).toBe(0); // block align
    expect(fmt.readUInt16LE(0x0e)).toBe(0); // bits per sample
    expect(fmt.readUInt16LE(0x10)).toBe(0x30);
    expect(fmt.readUInt16LE(0x12)).toBe(0);
    expect(fmt.readUInt32LE(0x14)).toBe(0x4101);
    expect(fmt.readUInt32LE(0x1c)).toBe(setupSize);
    expect(fmt.readUInt32LE(0x20)).toBe(dataSize - seekSize);
    expect(fmt.readUInt16LE(0x24)).toBe(0);
    expect(fmt.readUInt32LE(0x2c)).toBe(seekSize + setupSize);
    expect(fmt.readUInt16LE(0x30)).toBe(Math.max(...take.packets.map((p) => p.length)));
    expect(fmt.readUInt32LE(8)).toBe(
      Math.floor((dataSize - seekSize) / (take.samples / take.sampleRate)),
    );
    // The setup has the structure of the game's mono takes, hence their decoder memory.
    expect(take.setup).toHaveLength(174);
    expect([fmt.readUInt32LE(0x34), fmt.readUInt32LE(0x38)]).toEqual([15492, 15892]);
    expect(fmt.readUInt32LE(0x3c)).toBe(fnv1Hash32(take.setup));

    // What the packets decode to past the stated length, and never a whole packet of it.
    const { modes } = rewriteVorbisSetup(take.setup, 'toStandard', {
      channels: 1,
      library: wwiseCodebookLibrary(),
    });
    const counts = packetSampleCounts(packetBlockFlags(take.packets, modes, false), [8, 11]);
    const extra = counts.reduce((sum, count) => sum + count, 0) - take.samples;
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra).toBeLessThan(counts.at(-1)!);
    expect(fmt.readUInt16LE(0x26)).toBe(extra);
    expect(fmt.readUInt16LE(0x32)).toBe(extra);
  });

  it('writes a seek entry about every 16,384 samples, each at a packet', () => {
    const take = parseVorbisWem(take44);
    const data = take44.subarray(FMT + 66 + 8);
    const seekSize = take44.readUInt32LE(FMT + 0x28);
    const { modes } = rewriteVorbisSetup(take.setup, 'toStandard', {
      channels: 1,
      library: wwiseCodebookLibrary(),
    });
    const counts = packetSampleCounts(packetBlockFlags(take.packets, modes, false), [8, 11]);
    // Offset of each audio packet from the setup packet → samples decoded once it is.
    const decodedAt = new Map<number, number>();
    let offset = 2 + take.setup.length;
    let decoded = 0;
    take.packets.forEach((packet, i) => {
      decoded += counts[i]!;
      decodedAt.set(offset, decoded);
      offset += 2 + packet.length;
    });

    expect(seekSize / 4).toBe(4); // 74,970 samples
    let sample = 0;
    let position = 0;
    for (let at = 0; at < seekSize; at += 4) {
      expect(data.readUInt16LE(at)).toBeGreaterThanOrEqual(16384);
      expect(data.readUInt16LE(at)).toBeLessThan(16384 + 1024);
      sample += data.readUInt16LE(at);
      position += data.readUInt16LE(at + 2);
      expect(decodedAt.get(position)).toBe(sample);
    }
  });

  it('keeps the sample rate of the take it replaces, when the game has takes at it', async () => {
    expect(codec.takeSampleRate(null)).toBe(44100);
    expect(codec.takeSampleRate(take44)).toBe(44100);
    expect(codec.takeSampleRate(Buffer.from('not a take'))).toBe(44100);

    const wav32 = await writeBursts('bursts32.wav', 32000, 0.6);
    const take32 = await codec.encodeFromWav(wav32, { sourceTake: null });
    expect(codec.takeSampleRate(take32)).toBe(32000);
    expect(parseVorbisWem(take32).samples).toBe(readWav(wav32).pcm.length);
    // At 32 kHz libvorbis and the game's encoder agree to the byte: same setup, same key.
    expect(take32.readUInt32LE(FMT + 0x3c)).toBe(GAME_32K_SETUP_KEY);
    expect(take44.readUInt32LE(FMT + 0x3c)).not.toBe(GAME_32K_SETUP_KEY);

    const wav48 = await writeBursts('bursts48.wav', 48000, 0.6);
    const take48 = await codec.encodeFromWav(wav48, { sourceTake: take32 });
    expect(codec.takeSampleRate(take48)).toBe(48000);
    expect(parseVorbisWem(take48).samples).toBe(readWav(wav48).pcm.length);
    expect([take48.readUInt32LE(FMT + 0x34), take48.readUInt32LE(FMT + 0x38)]).toEqual([
      15492, 15892,
    ]);
  }, 60_000);

  it('refuses a stream the game’s decoder was not built for', async () => {
    // Another quality level: other codebooks, a decoder memory nobody measured.
    const fine = await encodeOgg(wav44, 'q5.ogg', ['-q:a', '5']);
    expect(() => oggVorbisToWem(fine)).toThrow(/not one the game's own takes use/);

    const stereo = await encodeOgg(wav44, 'stereo.ogg', ['-ac', '2']);
    expect(() => oggVorbisToWem(stereo)).toThrow(/Only mono takes are written/);

    // A rate libvorbis has another setup for.
    const low = await writeBursts('bursts22.wav', 22050, 0.5);
    await expect(codec.encodeFromWav(low, { sourceTake: null })).rejects.toThrow(
      /22050 Hz\) is not one the game's own takes use/,
    );

    // ffmpeg's own Vorbis encoder brings codebooks the Wwise table does not have.
    const native = path.join(dir, 'native.ogg');
    await ffmpeg(['-i', wav44, '-ac', '2', '-c:a', 'vorbis', '-strict', 'experimental', native]);
    const setup = readOggPackets(fs.readFileSync(native)).packets[2]!;
    expect(() =>
      rewriteVorbisSetup(setup, 'toWwise', { channels: 2, library: wwiseCodebookLibrary() }),
    ).toThrow(/codebook 0 of \d+ is not in the Wwise codebook table/);
  }, 60_000);
});

describe('reading a Wwise Vorbis take', () => {
  it('rebuilds the stream libvorbis encoded', async () => {
    const encoded = readOggPackets(await encodeOgg(wav44, 'direct.ogg'));
    const rebuilt = readOggPackets(vorbisWemToOgg(parseVorbisWem(take44)));

    // The setup header comes back bit for bit from 174 bytes and the table.
    expect(rebuilt.packets[2]!.equals(encoded.packets[2]!)).toBe(true);
    expect(rebuilt.packets[2]!.length).toBeGreaterThan(3000);
    // So does every audio packet, give or take the zero byte the dropped bits leave —
    // but for one flag: the last packet's "next block is long", which libvorbis sets
    // and a Wwise decoder, seeing no next packet, reads as unset. It shapes the half
    // of the last block that is never played.
    const NEXT_BLOCK_LONG = 0b1000;
    const audio = encoded.packets.slice(3);
    expect(rebuilt.packets.slice(3)).toHaveLength(audio.length);
    rebuilt.packets.slice(3).forEach((packet, i) => {
      const original = Buffer.from(audio[i]!);
      if (i === audio.length - 1) original[0]! &= ~NEXT_BLOCK_LONG;
      expect(packet.subarray(0, original.length).equals(original)).toBe(true);
      expect(packet.subarray(original.length).every((byte) => byte === 0)).toBe(true);
    });
    expect(rebuilt.finalGranule).toBe(encoded.finalGranule);
    expect(Number(rebuilt.finalGranule)).toBe(parseVorbisWem(take44).samples);

    // The same decoder gives the same samples from both streams.
    const pcmOf = async (name: string, ogg: Buffer): Promise<Int16Array> => {
      fs.writeFileSync(path.join(dir, `${name}.ogg`), ogg);
      await ffmpeg(['-i', path.join(dir, `${name}.ogg`), path.join(dir, `${name}.wav`)]);
      return readWav(path.join(dir, `${name}.wav`)).pcm;
    };
    const direct = await pcmOf('pcm-direct', fs.readFileSync(path.join(dir, 'direct.ogg')));
    const viaTake = await pcmOf('pcm-take', vorbisWemToOgg(parseVorbisWem(take44)));
    expect(Buffer.from(viaTake.buffer).equals(Buffer.from(direct.buffer))).toBe(true);
  }, 60_000);

  it('decodes to the samples that went in, no more and no fewer', async () => {
    const original = readWav(wav44);
    const out = path.join(dir, 'decoded.wav');
    await decodeVorbisWemToWav(take44, out);
    const decoded = readWav(out);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toBe(1);
    expect(decoded.pcm.length).toBe(original.pcm.length);
    expect(correlation(original.pcm, decoded.pcm)).toBeGreaterThan(0.97);
  }, 60_000);

  it('decodes a take shorter than one block', async () => {
    const short = await writeBursts('short.wav', 44100, 0.004);
    const samples = readWav(short).pcm.length;
    expect(samples).toBeLessThan(256);
    const take = await codec.encodeFromWav(short, { sourceTake: null });
    expect(parseVorbisWem(take).samples).toBe(samples);
    const out = path.join(dir, 'short-decoded.wav');
    await decodeVorbisWemToWav(take, out);
    expect(readWav(out).pcm.length).toBe(samples);
  }, 60_000);

  it('gives the voice pipeline a mono reference clip at the rate it asks for', async () => {
    const out = path.join(dir, 'reference.wav');
    await wemCodecOfTake(take44).decodeToWav(take44, out, { sampleRate: 22050 });
    const decoded = readWav(out);
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.channels).toBe(1);
    expect(Math.abs(decoded.pcm.length / 22050 - SECONDS)).toBeLessThan(0.001);
  }, 60_000);

  it('refuses a take whose packets fall short of its stated length', () => {
    const longer = Buffer.from(take44);
    longer.writeUInt32LE(parseVorbisWem(take44).samples + 5000, FMT + 0x18);
    expect(() => vorbisWemToOgg(parseVorbisWem(longer))).toThrow(
      /states \d+ samples but its packets decode to \d+/,
    );
  });
});
