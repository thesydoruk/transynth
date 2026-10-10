/**
 * A line's mouth animation: the lip block of a `.w3speech` row.
 *
 * Since the next-gen update it is a bare serialized
 * `CAnimationBufferBitwiseCompressed` rather than the CR2W file the 2015 game
 * used. Measured on the Remastered `enpc.w3speech` (every one of its 64,709
 * lip blocks):
 *
 * ```
 * f32 fps                 = (frames - 1) / duration, ~26–30
 * f32 duration            the take's length plus ~0.06 s
 * VLQ 2                   (the root bone's compression scheme; always 2)
 * 4 × track record        the root bone: constant position/orientation/scale
 * VLQ 148, 148 × record   one float track per mimic pose of the face
 * VLQ n, n bytes          the value pool
 * u32 frames, f32 dt      the animation's frame count and interval
 *
 * record (16 bytes): f32 dt, i8 compression, u8 0, u16 frames,
 *                    u32 dataAddr, u32 dataAddrFallback (= dataAddr)
 * ```
 *
 * A record's `frames` values sit at `dataAddr` in the pool, each 4 bytes (f32,
 * compression 0), 3 bytes (the top three of an f32, compression 1) or 2 bytes
 * (the top two, compression 2). The pool always opens with the same 20 bytes —
 * three f16 zeros, the root's packed identity orientation, three f16 ones —
 * and a pose held still for the whole line is one frame, usually pointing at
 * the zero (offset 0) or the one (offset 14). Each track is stored in the
 * shortest of the three forms that keeps its values exact (almost always f32
 * for a moving pose), and tracks need not all have the full frame count.
 *
 * The game's encoder never writes the same bytes twice: each track's values
 * are looked for in the pool written so far — two poses that move identically
 * share one run, and a held value that happens to occur inside an earlier run
 * points into it — and appended only when absent.
 *
 * {@link encodeLipsync} reproduces 64,708 of the game's 64,709 blocks byte for
 * byte from {@link decodeLipsync}'s output — the one exception stores a track
 * whole that fits a shorter form, and decodes to the same values — which is
 * what makes it safe to write new ones.
 */
import { readW3Vlq, writeW3Vlq } from '../w3strings';

const RECORD_SIZE = 16;
const ROOT_RECORDS = 4;
/** The 20 bytes every game lip pool starts with; see the module comment. */
const POOL_PREAMBLE = Buffer.from('000000000000008000800080ffff803f803f803f', 'hex');
const VALUE_BYTES = [4, 3, 2] as const;

export type LipsyncTrack = {
  /** Frame interval of this track, seconds. */
  dt: number;
  /** One value for a pose held still, else one per frame. */
  values: number[];
};

export type Lipsync = {
  fps: number;
  duration: number;
  frames: number;
  dt: number;
  /** The root bone's compression VLQ and its four records, kept verbatim. */
  rootCompression: number;
  root: Buffer;
  /** In the face's track order (148 for every game face). */
  tracks: LipsyncTrack[];
};

type TrackRecord = { dt: number; compression: number; frames: number; addr: number };

const readRecord = (block: Buffer, pos: number): TrackRecord => ({
  dt: block.readFloatLE(pos),
  compression: block.readInt8(pos + 4),
  frames: block.readUInt16LE(pos + 6),
  addr: block.readUInt32LE(pos + 8),
});

const readValue = (pool: Buffer, pos: number, compression: number): number => {
  if (compression === 0) return pool.readFloatLE(pos);
  const bytes = Buffer.alloc(4);
  if (compression === 1) pool.copy(bytes, 1, pos, pos + 3);
  else if (compression === 2) pool.copy(bytes, 2, pos, pos + 2);
  else throw new Error(`Unknown lip track compression ${compression}`);
  return bytes.readFloatLE(0);
};

export const decodeLipsync = (block: Buffer): Lipsync => {
  let pos = 8;
  const root = readW3Vlq(block, pos);
  pos = root.next;
  const rootStart = pos;
  pos += ROOT_RECORDS * RECORD_SIZE;
  const rootRecords = block.subarray(rootStart, pos);
  const count = readW3Vlq(block, pos);
  pos = count.next;
  const records: TrackRecord[] = [];
  for (let i = 0; i < count.value; i++, pos += RECORD_SIZE) records.push(readRecord(block, pos));
  const poolSize = readW3Vlq(block, pos);
  const pool = block.subarray(poolSize.next, poolSize.next + poolSize.value);
  pos = poolSize.next + poolSize.value;
  if (pos + 8 !== block.length) {
    throw new Error(`Lip block layout does not end at its size (${pos + 8} vs ${block.length})`);
  }
  const width = (record: TrackRecord): number => {
    const bytes = VALUE_BYTES[record.compression as 0 | 1 | 2];
    if (bytes === undefined) throw new Error(`Unknown lip track compression ${record.compression}`);
    return bytes;
  };
  return {
    fps: block.readFloatLE(0),
    duration: block.readFloatLE(4),
    frames: block.readUInt32LE(pos),
    dt: block.readFloatLE(pos + 4),
    rootCompression: root.value,
    root: Buffer.from(rootRecords),
    tracks: records.map((record) => ({
      dt: record.dt,
      values: Array.from({ length: record.frames }, (_, i) =>
        readValue(pool, record.addr + i * width(record), record.compression),
      ),
    })),
  };
};

const writeRecord = (record: TrackRecord): Buffer => {
  const out = Buffer.alloc(RECORD_SIZE);
  out.writeFloatLE(record.dt, 0);
  out.writeInt8(record.compression, 4);
  out.writeUInt16LE(record.frames, 6);
  out.writeUInt32LE(record.addr, 8);
  out.writeUInt32LE(record.addr, 12);
  return out;
};

/**
 * A track takes the shortest form that keeps every one of its values exact —
 * 2 bytes each when all their f32 low halves are zero, 3 when all their low
 * bytes are — as the game's encoder does.
 */
const encodeValues = (values: readonly number[]): { compression: number; bytes: Buffer } => {
  const f32 = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => f32.writeFloatLE(value, i * 4));
  const lowBytesZero = (count: number): boolean =>
    values.every((_, i) => f32.subarray(i * 4, i * 4 + count).every((byte) => byte === 0));
  const keepTop = (count: number): Buffer => {
    const out = Buffer.alloc(values.length * count);
    values.forEach((_, i) => f32.copy(out, i * count, i * 4 + 4 - count, i * 4 + 4));
    return out;
  };
  if (lowBytesZero(2)) return { compression: 2, bytes: keepTop(2) };
  if (lowBytesZero(1)) return { compression: 1, bytes: keepTop(3) };
  return { compression: 0, bytes: f32 };
};

export const encodeLipsync = (lipsync: Lipsync): Buffer => {
  const capacity =
    POOL_PREAMBLE.length + lipsync.tracks.reduce((sum, track) => sum + track.values.length * 4, 0);
  const pool = Buffer.alloc(capacity);
  POOL_PREAMBLE.copy(pool);
  let poolSize = POOL_PREAMBLE.length;
  const records = lipsync.tracks.map((track): TrackRecord => {
    if (track.values.length === 0) throw new Error('A lip track needs at least one value');
    const { compression, bytes } = encodeValues(track.values);
    let addr = pool.subarray(0, poolSize).indexOf(bytes);
    if (addr < 0) {
      addr = poolSize;
      bytes.copy(pool, poolSize);
      poolSize += bytes.length;
    }
    return { dt: track.dt, compression, frames: track.values.length, addr };
  });

  const head = Buffer.alloc(8);
  head.writeFloatLE(lipsync.fps, 0);
  head.writeFloatLE(lipsync.duration, 4);
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(lipsync.frames, 0);
  tail.writeFloatLE(lipsync.dt, 4);
  return Buffer.concat([
    head,
    writeW3Vlq(lipsync.rootCompression),
    lipsync.root,
    writeW3Vlq(records.length),
    ...records.map(writeRecord),
    writeW3Vlq(poolSize),
    pool.subarray(0, poolSize),
    tail,
  ]);
};

/**
 * The same animation stretched (or squeezed) to last `duration` seconds.
 * The mouth keeps its shapes and their order; only the timing changes, so the
 * block keeps its exact size.
 */
export const retimeLipsync = (block: Buffer, duration: number): Buffer => {
  const lipsync = decodeLipsync(block);
  if (!(lipsync.duration > 0) || !(duration > 0)) return Buffer.from(block);
  const factor = duration / lipsync.duration;
  const root = Buffer.from(lipsync.root);
  for (let i = 0; i < ROOT_RECORDS; i++) {
    root.writeFloatLE(root.readFloatLE(i * RECORD_SIZE) * factor, i * RECORD_SIZE);
  }
  return encodeLipsync({
    ...lipsync,
    fps: lipsync.fps / factor,
    duration,
    dt: lipsync.dt * factor,
    root,
    tracks: lipsync.tracks.map((track) => ({ ...track, dt: track.dt * factor })),
  });
};
