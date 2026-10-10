/**
 * The `.w3speech` voice container (REDengine 3), read and written.
 *
 * Measured on the Remastered (2026, version 164) `content0/enpc.w3speech`:
 *
 * ```
 * "CPSW"  u32 version  u16 key1  VLQ n
 * n × 40-byte row, sorted by stored id (the game binary-searches it):
 *     u32 id ^ magic   u32 0
 *     u64 audioOffset  u64 audioSize
 *     u64 lipOffset    u64 lipSize
 * u16 key2
 * per line, wherever its row points:
 *     audio block = u32 takeLength, take (RIFF), f32 duration (s), u32 1
 *     lip block   = the mouth animation (see `lipsync.ts`)
 * ```
 *
 * `key1 << 16 | key2` is the same language key `.w3strings` uses, and
 * `id ^ magic` is the string id of the line's text. The file holds base game
 * and both expansions — 64,718 lines, 4.2 GB for English — so it is read
 * through a file descriptor rather than into memory. Offsets are 64-bit for
 * that reason; blocks are usually adjacent but not always (a few dozen lines
 * in the Polish file are not), and nine English lines have no lip block at all.
 */
import fs from 'node:fs';
import { readW3Vlq, writeW3Vlq } from '../w3strings';

const MAGIC = 'CPSW';
const ROW_SIZE = 40;
/** Largest header we read up front: magic, version, key, a 5-byte count. */
const HEADER_PROBE = 16;

/** Same table as `.w3strings`; speech exists only for a few of those languages. */
const MAGIC_BY_KEY = new Map<number, number>([
  [0, 0],
  [0x83496237, 0x73946816],
  [0x43975139, 0x79321793],
  [0x75886138, 0x42791159],
  [0x45931894, 0x12375973],
  [0x23863176, 0x75921975],
  [0x24987354, 0x21793217],
  [0x18796651, 0x42387566],
  [0x18632176, 0x16875467],
  [0x63481486, 0x42386347],
  [0x42378932, 0x67823218],
  [0x54834893, 0x59825646],
  [0x77932179, 0x54932186],
  [0x56328893, 0x43268768],
  [0x56432683, 0x21795135],
]);

export type W3SpeechRow = {
  /** The line's string id (already un-XORed). */
  id: number;
  audioOffset: number;
  audioSize: number;
  lipOffset: number;
  lipSize: number;
};

export type W3SpeechIndex = {
  version: number;
  langKey: number;
  magic: number;
  /** In file order — ascending stored id. */
  rows: W3SpeechRow[];
};

const readAt = (fd: number, offset: number, length: number): Buffer => {
  const buf = Buffer.alloc(length);
  const read = fs.readSync(fd, buf, 0, length, offset);
  if (read !== length) throw new Error(`Short read at ${offset} (${read}/${length})`);
  return buf;
};

const readU64 = (buf: Buffer, pos: number): number => {
  const value = buf.readBigUInt64LE(pos);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('w3speech offset out of range');
  return Number(value);
};

export const readW3SpeechIndex = (fd: number): W3SpeechIndex => {
  const head = readAt(fd, 0, HEADER_PROBE);
  if (head.toString('latin1', 0, 4) !== MAGIC)
    throw new Error('Not a .w3speech file (missing CPSW)');
  const version = head.readUInt32LE(4);
  const key1 = head.readUInt16LE(8);
  const count = readW3Vlq(head, 10);
  const table = readAt(fd, count.next, count.value * ROW_SIZE + 2);
  const key2 = table.readUInt16LE(count.value * ROW_SIZE);
  const langKey = ((key1 << 16) | key2) >>> 0;
  const magic = MAGIC_BY_KEY.get(langKey);
  if (magic === undefined) {
    throw new Error(`Unknown .w3speech language key 0x${langKey.toString(16).padStart(8, '0')}`);
  }
  const rows: W3SpeechRow[] = [];
  for (let i = 0; i < count.value; i++) {
    const pos = i * ROW_SIZE;
    rows.push({
      id: (table.readUInt32LE(pos) ^ magic) >>> 0,
      audioOffset: readU64(table, pos + 8),
      audioSize: readU64(table, pos + 16),
      lipOffset: readU64(table, pos + 24),
      lipSize: readU64(table, pos + 32),
    });
  }
  return { version, langKey, magic, rows };
};

/** One line's audio block, split into its parts. */
export type W3SpeechAudio = { take: Buffer; duration: number; trailer: number };

export const parseW3SpeechAudio = (block: Buffer): W3SpeechAudio => {
  const takeLength = block.readUInt32LE(0);
  if (takeLength + 12 !== block.length) {
    throw new Error(`Audio block size mismatch (${takeLength} + 12 vs ${block.length})`);
  }
  return {
    take: block.subarray(4, 4 + takeLength),
    duration: block.readFloatLE(4 + takeLength),
    trailer: block.readUInt32LE(8 + takeLength),
  };
};

export const buildW3SpeechAudio = (take: Buffer, duration: number, trailer = 1): Buffer => {
  const block = Buffer.alloc(take.length + 12);
  block.writeUInt32LE(take.length, 0);
  take.copy(block, 4);
  block.writeFloatLE(duration, 4 + take.length);
  block.writeUInt32LE(trailer, 8 + take.length);
  return block;
};

export const readW3SpeechBlock = (fd: number, offset: number, size: number): Buffer =>
  size > 0 ? readAt(fd, offset, size) : Buffer.alloc(0);

/** What to write for one line: its blocks unchanged, or replacements. */
export type W3SpeechLineOverride = { audio?: Buffer; lip?: Buffer };

export type WriteW3SpeechOptions = {
  /** Replacements by string id; lines not listed are copied from the source. */
  overrides: ReadonlyMap<number, W3SpeechLineOverride>;
  /** Language key to write. Defaults to the source's — see the Brazilian-slot note in the plugin. */
  langKey?: number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Write a speech file from `source`, with some lines' blocks replaced.
 *
 * Rows keep the source's order (ascending stored id); every block is written
 * back to back after the table, audio then lip, so the result has no gaps.
 * A line whose lip block is empty keeps offset 0 / size 0, as the game's own do.
 */
export const writeW3Speech = (
  sourceFd: number,
  source: W3SpeechIndex,
  outPath: string,
  options: WriteW3SpeechOptions,
): void => {
  const langKey = options.langKey ?? source.langKey;
  const magic = MAGIC_BY_KEY.get(langKey);
  if (magic === undefined) throw new Error(`Unknown language key 0x${langKey.toString(16)}`);

  const blocks = source.rows.map((row) => {
    const override = options.overrides.get(row.id);
    return {
      row,
      audio: override?.audio ?? null,
      lip: override?.lip ?? null,
      audioSize: override?.audio?.length ?? row.audioSize,
      lipSize: override?.lip?.length ?? row.lipSize,
    };
  });

  const head = Buffer.alloc(10);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(source.version, 4);
  head.writeUInt16LE(langKey >>> 16, 8);
  const count = writeW3Vlq(blocks.length);
  const tableSize = blocks.length * ROW_SIZE;
  let cursor = head.length + count.length + tableSize + 2;

  const table = Buffer.alloc(tableSize + 2);
  blocks.forEach((block, i) => {
    const pos = i * ROW_SIZE;
    table.writeUInt32LE((block.row.id ^ magic) >>> 0, pos);
    table.writeBigUInt64LE(BigInt(cursor), pos + 8);
    table.writeBigUInt64LE(BigInt(block.audioSize), pos + 16);
    cursor += block.audioSize;
    table.writeBigUInt64LE(BigInt(block.lipSize > 0 ? cursor : 0), pos + 24);
    table.writeBigUInt64LE(BigInt(block.lipSize), pos + 32);
    cursor += block.lipSize;
  });
  table.writeUInt16LE(langKey & 0xffff, tableSize);

  const out = fs.openSync(outPath, 'w');
  try {
    let position = 0;
    const write = (buf: Buffer): void => {
      let written = 0;
      while (written < buf.length) {
        written += fs.writeSync(out, buf, written, buf.length - written, position + written);
      }
      position += buf.length;
    };
    write(Buffer.concat([head, count, table]));
    blocks.forEach((block, i) => {
      write(block.audio ?? readW3SpeechBlock(sourceFd, block.row.audioOffset, block.row.audioSize));
      if (block.lipSize > 0) {
        write(block.lip ?? readW3SpeechBlock(sourceFd, block.row.lipOffset, block.row.lipSize));
      }
      if (options.onProgress && (i % 2000 === 0 || i === blocks.length - 1)) {
        options.onProgress(i + 1, blocks.length);
      }
    });
  } finally {
    fs.closeSync(out);
  }
};
