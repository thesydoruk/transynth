/**
 * Minimal SWF container reader/writer — tag level only.
 *
 * Enough to open a Bethesda `Interface/fonts_*.swf`, rewrite a single tag (a font
 * definition) and write the library back with correct lengths and the original
 * compression. Tag bodies are kept as raw buffers; interpreting them is the job of
 * the format-specific modules. Scaleform's `.gfx` export of a library (Starfield ships
 * `fonts_en.gfx` next to `fonts_en.swf`) is the same container under another signature.
 */
import { deflateSync, inflateSync } from 'zlib';

export type SwfTag = { code: number; body: Buffer };

export type SwfFile = {
  /** Original container used `CWS` (zlib) rather than plain `FWS`. */
  compressed: boolean;
  /**
   * Scaleform's exported form (`GFX`, or `CFX` compressed): the same tag stream with
   * Scaleform's own tags (codes 1000 and up) next to the standard ones.
   */
  gfx?: boolean;
  version: number;
  /** Frame size RECT, frame rate and frame count, kept verbatim. */
  preamble: Buffer;
  tags: SwfTag[];
};

const TAG_END = 0;

/** Byte length of the frame size RECT that opens the SWF body. */
const frameRectSize = (body: Buffer): number => {
  const nbits = body[0] >> 3;
  return Math.ceil((5 + 4 * nbits) / 8);
};

export const parseSwf = (buf: Buffer): SwfFile => {
  const signature = buf.toString('ascii', 0, 3);
  if (!['FWS', 'CWS', 'GFX', 'CFX'].includes(signature)) {
    throw new Error(`Unsupported SWF signature "${signature}" (only FWS, CWS, GFX and CFX)`);
  }
  const compressed = signature[0] === 'C';
  const gfx = signature.endsWith('FX');
  const version = buf[3];
  const body = compressed ? inflateSync(buf.subarray(8)) : buf.subarray(8);

  const preambleEnd = frameRectSize(body) + 4; // RECT + frame rate + frame count
  const preamble = Buffer.from(body.subarray(0, preambleEnd));
  const tags: SwfTag[] = [];
  let pos = preambleEnd;

  while (pos + 2 <= body.length) {
    const header = body.readUInt16LE(pos);
    const code = header >> 6;
    let length = header & 0x3f;
    pos += 2;
    if (length === 0x3f) {
      if (pos + 4 > body.length) break;
      length = body.readUInt32LE(pos);
      pos += 4;
    }
    if (code === TAG_END) break;
    tags.push({ code, body: Buffer.from(body.subarray(pos, pos + length)) });
    pos += length;
  }

  return gfx
    ? { compressed, gfx, version, preamble, tags }
    : { compressed, version, preamble, tags };
};

/** Encode a tag record header, switching to the long form when needed. */
const writeTagHeader = (code: number, length: number): Buffer => {
  if (length < 0x3f) {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | length, 0);
    return header;
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 0x3f, 0);
  header.writeUInt32LE(length, 2);
  return header;
};

export const writeSwf = (swf: SwfFile): Buffer => {
  const chunks: Buffer[] = [swf.preamble];
  for (const tag of swf.tags) {
    chunks.push(writeTagHeader(tag.code, tag.body.length), tag.body);
  }
  chunks.push(writeTagHeader(TAG_END, 0));

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  const signature = swf.gfx ? (swf.compressed ? 'CFX' : 'GFX') : swf.compressed ? 'CWS' : 'FWS';
  header.write(signature, 0, 3, 'ascii');
  header.writeUInt8(swf.version, 3);
  header.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([header, swf.compressed ? deflateSync(body) : body]);
};
