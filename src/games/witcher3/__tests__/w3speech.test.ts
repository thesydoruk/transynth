import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { demuxOggOpus, muxOggOpus } from '../audio/ogg';
import { buildOpusWem, opusWemDuration, opusWemToOgg, parseOpusWem } from '../audio/opusWem';
import {
  buildW3SpeechAudio,
  parseW3SpeechAudio,
  readW3SpeechBlock,
  readW3SpeechIndex,
  writeW3Speech,
} from '../w3speech';
import { decodeLipsync, encodeLipsync, retimeLipsync, type Lipsync } from '../w3speech/lipsync';
import { writeW3Vlq } from '../w3strings';

const packets = [Buffer.from([0xf8, 0xff, 0xfe]), Buffer.alloc(300, 7), Buffer.from([0xf8, 1])];

describe('Ogg Opus bridge', () => {
  it('round-trips packets, including ones longer than a lacing segment', () => {
    const ogg = muxOggOpus(packets, { channels: 1, preSkip: 312, frameSize: 960 });
    const stream = demuxOggOpus(ogg);
    expect(stream.packets).toEqual(packets);
    expect(stream.preSkip).toBe(312);
    expect(stream.finalGranule).toBe(BigInt(packets.length * 960));
  });
});

describe('Opus takes', () => {
  it('builds a take that parses back to the same stream', () => {
    const take = buildOpusWem({ packets, channels: 1, samples: 2000, preSkip: 312 });
    const wem = parseOpusWem(take);
    expect(wem.packets).toEqual(packets);
    expect(wem).toMatchObject({ channels: 1, sampleRate: 48000, samples: 2000, preSkip: 312 });
    expect(opusWemDuration(wem)).toBeCloseTo(2000 / 48000);
    expect(demuxOggOpus(opusWemToOgg(wem)).packets).toEqual(packets);
  });

  it('lays chunks out back to back with no padding after an odd-sized data chunk', () => {
    const take = buildOpusWem({ packets, channels: 1, samples: 2000, preSkip: 312 });
    const data = Buffer.concat(packets);
    expect(data.length % 2).toBe(1);
    expect(take.length).toBe(
      12 + (8 + 36) + (8 + 16) + (8 + packets.length * 2) + (8 + data.length),
    );
    expect(take.readUInt32LE(4)).toBe(take.length - 8);
  });

  it('rebuilds a take byte-exact from its own parts', () => {
    const original = buildOpusWem({
      packets,
      channels: 1,
      samples: 2000,
      preSkip: 312,
      hash: Buffer.alloc(16, 9),
    });
    const wem = parseOpusWem(original);
    const rebuilt = buildOpusWem({ ...wem, template: wem, hash: wem.hash });
    expect(rebuilt).toEqual(original);
  });
});

const ROOT = Buffer.alloc(64, 0);

/** A model of the measured shape: `held` still poses, then `moving` ones of `frames` frames. */
const lipModel = (held: number, moving: number, frames: number, duration: number): Lipsync => {
  // Stored as f32, so the model is too.
  const dt = Math.fround(duration / (frames - 1));
  return {
    fps: Math.fround(1 / dt),
    duration,
    frames,
    dt,
    rootCompression: 2,
    root: ROOT,
    tracks: [
      ...Array.from({ length: held }, () => ({ dt, values: [0] })),
      ...Array.from({ length: moving }, (_, t) => ({
        dt,
        values: Array.from({ length: frames }, (_, i) => Math.fround(Math.sin(t + i / 7) / 3)),
      })),
    ],
  };
};

describe('lip blocks', () => {
  it('decodes what it encodes', () => {
    const model = lipModel(140, 8, 31, 1);
    expect(decodeLipsync(encodeLipsync(model))).toEqual(model);
  });

  it('opens the pool with the game preamble and points held zeros at it', () => {
    const block = encodeLipsync(lipModel(1, 1, 4, 0.1));
    expect(
      block.indexOf(Buffer.from('000000000000008000800080ffff803f803f803f', 'hex')),
    ).toBeGreaterThan(0);
    // 8 header + VLQ + 64 root + VLQ, then the first track record: f16 at pool offset 0.
    const first = 8 + 1 + 64 + 1;
    expect(block.readInt8(first + 4)).toBe(2);
    expect(block.readUInt32LE(first + 8)).toBe(0);
  });

  it('stores identically moving poses once', () => {
    const model = lipModel(0, 1, 10, 0.3);
    const twice = { ...model, tracks: [model.tracks[0]!, model.tracks[0]!] };
    expect(encodeLipsync(twice).length).toBe(encodeLipsync(model).length + 16);
  });

  it('keeps a value in the shortest exact form', () => {
    const half = Math.fround(0.5); // f32 3f000000: low half zero → 2 bytes
    const model = { ...lipModel(0, 0, 2, 0.1), tracks: [{ dt: 0.1, values: [half, half] }] };
    const block = encodeLipsync(model);
    const record = 8 + 1 + 64 + 1;
    expect(block.readInt8(record + 4)).toBe(2);
    expect(decodeLipsync(block).tracks[0]!.values).toEqual([0.5, 0.5]);
  });

  it('stretches every time field and keeps the size', () => {
    const block = encodeLipsync(lipModel(4, 4, 11, 1));
    const stretched = retimeLipsync(block, 1.5);
    expect(stretched.length).toBe(block.length);
    const lipsync = decodeLipsync(stretched);
    expect(lipsync.duration).toBeCloseTo(1.5);
    expect(lipsync.fps).toBeCloseTo(10 / 1.5);
    expect(lipsync.dt).toBeCloseTo(0.15);
    for (const track of lipsync.tracks) expect(track.dt).toBeCloseTo(0.15);
    expect(lipsync.tracks.map((t) => t.values)).toEqual(
      decodeLipsync(block).tracks.map((t) => t.values),
    );
  });

  it('rejects a block whose layout overruns its size', () => {
    expect(() => decodeLipsync(encodeLipsync(lipModel(4, 4, 11, 1)).subarray(0, 100))).toThrow();
  });
});

describe('w3speech container', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3speech-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const take = (n: number): Buffer =>
    buildOpusWem({ packets: [Buffer.alloc(n, n)], channels: 1, samples: 960, preSkip: 312 });

  /** Build a source file with the writer itself, from an empty-shell index. */
  const writeSource = (file: string, ids: number[]): void => {
    const shell = path.join(dir, 'shell.w3speech');
    const head = Buffer.alloc(10);
    head.write('CPSW', 0, 'latin1');
    head.writeUInt32LE(164, 4);
    head.writeUInt16LE(0x4397, 8);
    const rows = Buffer.alloc(ids.length * 40 + 2);
    rows.writeUInt16LE(0x5139, ids.length * 40);
    ids.forEach((id, i) => rows.writeUInt32LE((id ^ 0x79321793) >>> 0, i * 40));
    fs.writeFileSync(shell, Buffer.concat([head, writeW3Vlq(ids.length), rows]));
    const fd = fs.openSync(shell, 'r');
    try {
      const overrides = new Map(
        ids.map((id, i) => [
          id,
          {
            audio: buildW3SpeechAudio(take(i + 1), 0.02),
            lip: i === 1 ? Buffer.alloc(0) : encodeLipsync(lipModel(2, 2, 3, 0.1)),
          },
        ]),
      );
      writeW3Speech(fd, readW3SpeechIndex(fd), file, { overrides });
    } finally {
      fs.closeSync(fd);
    }
  };

  it('writes and reads back every line, keeping an empty lip block empty', () => {
    const file = path.join(dir, 'enpc.w3speech');
    const ids = [1185686, 1185684, 433733];
    writeSource(file, ids);
    const fd = fs.openSync(file, 'r');
    try {
      const index = readW3SpeechIndex(fd);
      expect(index).toMatchObject({ version: 164, langKey: 0x43975139 });
      expect(index.rows.map((r) => r.id)).toEqual(ids);
      expect(index.rows[1]).toMatchObject({ lipOffset: 0, lipSize: 0 });
      const audio = parseW3SpeechAudio(
        readW3SpeechBlock(fd, index.rows[2]!.audioOffset, index.rows[2]!.audioSize),
      );
      expect(audio).toMatchObject({ trailer: 1, take: take(3) });
      expect(audio.duration).toBeCloseTo(0.02);
      const last = index.rows[2]!;
      expect(last.lipOffset + last.lipSize).toBe(fs.statSync(file).size);
    } finally {
      fs.closeSync(fd);
    }
  });

  it('replaces only the overridden line and copies the rest exactly', () => {
    const source = path.join(dir, 'enpc.w3speech');
    const copy = path.join(dir, 'brpc.w3speech');
    writeSource(source, [10, 20, 30]);
    const fd = fs.openSync(source, 'r');
    try {
      const index = readW3SpeechIndex(fd);
      const replacement = buildW3SpeechAudio(take(50), 0.5);
      writeW3Speech(fd, index, copy, { overrides: new Map([[20, { audio: replacement }]]) });
      const out = fs.openSync(copy, 'r');
      try {
        const written = readW3SpeechIndex(out);
        const block = (f: number, row: (typeof written.rows)[number]) =>
          readW3SpeechBlock(f, row.audioOffset, row.audioSize);
        expect(block(out, written.rows[1]!)).toEqual(replacement);
        expect(block(out, written.rows[0]!)).toEqual(block(fd, index.rows[0]!));
        expect(block(out, written.rows[2]!)).toEqual(block(fd, index.rows[2]!));
        const lip = (f: number, row: (typeof written.rows)[number]) =>
          readW3SpeechBlock(f, row.lipOffset, row.lipSize);
        expect(lip(out, written.rows[2]!)).toEqual(lip(fd, index.rows[2]!));
      } finally {
        fs.closeSync(out);
      }
    } finally {
      fs.closeSync(fd);
    }
  });
});
