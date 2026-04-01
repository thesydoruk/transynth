/**
 * EET binary format reader for ESP-ESM Translator save files (.eet).
 *
 * Format (reverse-engineered):
 *   Header:  "EET_" (4) + version:u32 + unk:u32 + "GAME" (4) + gameNameLen:u16 + gameName + "LINE" (4)
 *     v1 only: extra "=" byte after "LINE"
 *     v2 only: recordCount:u32 after "LINE"
 *   Records: sequential, each prefixed by totalSize:u32 (size after this field)
 *     sig:str  formId:str  edid:str  field:str  source:str  target:str
 *     tail: tgtStrippedLen:u32 [tgtStripped]  editCount:u32  status:u8  pad:u8
 *           unk1:i32  unk2:u32  srcHash:u32  srcStrippedLen:u32  srcStripped  srcHash2:u32
 *           [varSrcSecSize:u32 [srcTemplateLen:u32 srcTemplate varCount:u32 [varLen:u32 var]*]
 *            tgtTemplateSecSize:u32 [tgtTemplateLen:u32 tgtTemplate varCount:u32 [varLen:u32 var]*]]
 *           endMarker:u32 (0xFFFFFFFF)
 *
 * str = len:u32 + utf8 bytes (no null terminator in length)
 */

import { log } from '../../logger';

/**
 * Header information parsed from an EET file.
 *
 * EET (ESP‑ESM Translator) files come in multiple versions; some store the
 * record count in the header while older versions do not.
 */
export interface EetHeader {
  version: number;
  gameName: string;
  /** Record count from header (v2) or -1 when not stored (v1). */
  declaredCount: number;
  /** Byte offset where records begin. */
  recordsOffset: number;
}

/**
 * A single translation row extracted from an EET file.
 *
 * This is a lossy representation: the on-disk structure contains additional
 * bookkeeping data (template blocks, hashes, etc.). The importer only needs
 * the identifiers, source/target strings, and status marker.
 */
export interface EetRecord {
  /** Byte offset in file where this record starts. */
  offset: number;
  /** Record signature: WEAP, OMOD, MISC, GMST, KYWD, etc. */
  signature: string;
  /** FormID as hex string, e.g. "01000FAA". */
  formId: string;
  /** Editor ID. */
  edid: string;
  /** Subrecord field type: FULL, DESC, DATA, CNAM, etc. */
  field: string;
  /** Source (English) text. */
  source: string;
  /** Translated text (may be empty). */
  target: string;
  /** Status character: 'c'=confirmed, 0xFF=untranslated. */
  status: number;
}

/**
 * Read a little-endian 32‑bit unsigned integer from the buffer.
 *
 * @param buf - Source buffer.
 * @param o - Byte offset at which the value starts.
 * @returns Parsed unsigned integer.
 */
const readU32 = (buf: Buffer, o: number): number => {
  return buf.readUInt32LE(o);
}

/**
 * Read a little-endian 16‑bit unsigned integer from the buffer.
 *
 * @param buf - Source buffer.
 * @param o - Byte offset at which the value starts.
 * @returns Parsed unsigned integer.
 */
const readU16 = (buf: Buffer, o: number): number => {
  return buf.readUInt16LE(o);
}

/**
 * Read an EET string at the given offset.
 *
 * EET strings are stored as `uint32 length` followed by that many UTF‑8 bytes.
 * The trailing offset returned by this helper always points to the first byte
 * *after* the string payload.
 *
 * @param buf - Source buffer.
 * @param o - Offset of the length prefix.
 * @returns Tuple of decoded string and next offset.
 */
const readStr = (buf: Buffer, o: number): [string, number] => {
  const len = readU32(buf, o);
  o += 4;
  const s = buf.toString('utf8', o, o + len);
  return [s, o + len];
}

/**
 * Parse the EET file header.
 *
 * @param buf - Full EET file contents.
 * @returns Parsed header fields including the byte offset where records start.
 * @throws Error if the buffer does not match the expected header tags.
 */
export const parseEetHeader = (buf: Buffer): EetHeader => {
  let o = 0;

  const magic = buf.toString('ascii', o, o + 4);
  if (magic !== 'EET_') throw new Error(`Invalid EET magic: ${magic}`);
  o += 4;

  const version = readU32(buf, o);
  o += 4;

  // Skip unknown u32
  o += 4;

  // GAME tag
  const gameTag = buf.toString('ascii', o, o + 4);
  if (gameTag !== 'GAME') throw new Error(`Expected GAME tag at offset ${o}, got ${gameTag}`);
  o += 4;

  const gameNameLen = readU16(buf, o);
  o += 2;
  const gameName = gameNameLen > 0 ? buf.toString('utf8', o, o + gameNameLen) : '';
  o += gameNameLen;

  // LINE marker (4 bytes)
  const lineTag = buf.toString('ascii', o, o + 4);
  if (lineTag !== 'LINE') throw new Error(`Expected LINE tag at offset ${o}, got ${lineTag}`);
  o += 4;

  let declaredCount = -1;

  if (version === 1) {
    // v1: extra '=' byte + 3 zero padding bytes before records
    o += 4;
  } else {
    // v2+: record count follows LINE tag
    declaredCount = readU32(buf, o);
    o += 4;
  }

  return { version, gameName, declaredCount, recordsOffset: o };
}

/**
 * Iterate over records in an EET file.
 *
 * The record structure is size-prefixed, so the iterator can reliably jump to
 * the next record even when it does not parse the full tail section.
 *
 * @param buf - Full EET file contents.
 * @param startOffset - Byte offset of the first record (from {@link parseEetHeader}).
 * @yields Parsed record descriptors for each row in the file.
 */
// eslint-disable-next-line func-style
export function* iterEetRecords(buf: Buffer, startOffset: number): Generator<EetRecord> {
  let o = startOffset;

  while (o < buf.length - 4) {
    const recordStart = o;
    const totalSize = readU32(buf, o);
    o += 4;

    if (totalSize === 0 || o + totalSize > buf.length) break;

    const recordEnd = o + totalSize;

    let sig: string;
    [sig, o] = readStr(buf, o);

    let formId: string;
    [formId, o] = readStr(buf, o);

    let edid: string;
    [edid, o] = readStr(buf, o);

    let field: string;
    [field, o] = readStr(buf, o);

    let source: string;
    [source, o] = readStr(buf, o);

    let target: string;
    [target, o] = readStr(buf, o);

    // Parse tail — we need the status byte
    // Tail starts with: tgtStrippedLen:u32 [tgtStripped] editCount:u32 status:u8
    const tgtStrippedLen = readU32(buf, o);
    o += 4 + tgtStrippedLen; // skip tgtStripped content
    o += 4; // skip editCount
    const status = buf[o];

    // Jump to next record regardless of tail parsing
    o = recordEnd;

    yield {
      offset: recordStart,
      signature: sig,
      formId,
      edid,
      field,
      source,
      target,
      status,
    };
  }
}

/**
 * Parse a full EET file into header + a materialised record list.
 *
 * Prefer {@link iterEetRecords} for streaming import of large files; this
 * convenience wrapper is primarily used by tooling that needs random access.
 *
 * @param buf - Full EET file contents.
 * @returns Object containing parsed header metadata and a list of all records.
 */
export const parseEetFile = (buf: Buffer): { header: EetHeader; records: EetRecord[] } => {
  log.debug(`EET: parsing buffer (${buf.length} bytes)`);
  const header = parseEetHeader(buf);
  log.info(`EET: v${header.version}, game="${header.gameName}", declaredCount=${header.declaredCount}`);
  const records = [...iterEetRecords(buf, header.recordsOffset)];
  log.info(`EET: parsed ${records.length} records`);
  return { header, records };
}
