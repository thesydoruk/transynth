import lz4 from 'lz4js';
import { deflateSync, constants as zlibConstants } from 'zlib';

const FILE_FLAG_COMPRESS_TOGGLE = 0x40000000;
const FILE_SIZE_MASK = 0x3fffffff;
const LZ4_HASH_SIZE = 1 << 16;

type Lz4Module = {
  compressBlock: (
    src: Buffer,
    dst: Buffer,
    sIndex: number,
    sLength: number,
    hashTable: Uint32Array,
  ) => number;
  compressBound: (size: number) => number;
};

const lz4Codec = lz4 as unknown as Lz4Module;

const compressLz4Block = (data: Buffer): Buffer | null => {
  const hashTable = new Uint32Array(LZ4_HASH_SIZE);
  const bound = lz4Codec.compressBound(data.length);
  const out = Buffer.alloc(bound);
  const size = lz4Codec.compressBlock(data, out, 0, data.length, hashTable);
  if (size <= 0 || size >= data.length) return null;
  return out.subarray(0, size);
};

export type BsaOnDiskPayload = {
  data: Buffer;
  /** Value for the BSA file record `size` field (includes compression toggle bit). */
  sizeField: number;
};

/**
 * Pack one BSA file payload using Creation Kit rules (per-file compression toggle).
 *
 * Layout when compressed:
 *   [uint32 uncompressedSize][zlib or LZ4 block data]
 */
export const packBsaFilePayload = (
  raw: Buffer,
  compress: boolean,
  version: number,
): BsaOnDiskPayload => {
  if (!compress) {
    return { data: raw, sizeField: raw.length };
  }

  let compressed: Buffer | null = null;
  if (version === 105) {
    compressed = compressLz4Block(raw);
  } else {
    const zlib = deflateSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION });
    compressed = zlib.length < raw.length ? zlib : null;
  }

  if (!compressed) {
    return { data: raw, sizeField: raw.length };
  }

  const header = Buffer.alloc(4);
  header.writeUInt32LE(raw.length);
  const onDisk = Buffer.concat([header, compressed]);
  return {
    data: onDisk,
    sizeField: (onDisk.length & FILE_SIZE_MASK) | FILE_FLAG_COMPRESS_TOGGLE,
  };
};
