/**
 * Shared record payload access for ESP extractors.
 */
import { inflateSync } from 'zlib';

export const RECORD_HEADER_SIZE = 24;
export const GRUP_HEADER_SIZE = 24;
export const SUBRECORD_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;

/**
 * Return the subrecord payload of one record, inflating it when needed.
 *
 * Compressed records store the uncompressed size in the first four bytes of
 * the payload, before the zlib stream.
 *
 * @param buf - Whole plugin buffer.
 * @param recOffset - Byte offset of the 24-byte record header.
 * @returns The payload, or null when a compressed record fails to inflate.
 */
export const readRecordData = (buf: Buffer, recOffset: number): Buffer | null => {
  const dataSize = buf.readUInt32LE(recOffset + 4);
  const flags = buf.readUInt32LE(recOffset + 8);
  const dataStart = recOffset + RECORD_HEADER_SIZE;
  const dataEnd = dataStart + dataSize;

  if (!(flags & FLAG_COMPRESSED)) return buf.subarray(dataStart, dataEnd);

  try {
    return inflateSync(buf.subarray(dataStart + 4, dataEnd));
  } catch {
    return null;
  }
};

/** Signatures that open and close one embedded base-form component. */
export type ComponentBrackets = { begin: string; end: string } | null;

/**
 * Visit the subrecords of one record payload in file order.
 *
 * `XXXX` is honoured: it carries the true size of the next subrecord when that
 * exceeds the uint16 size field. With `components` set, everything from a
 * component's opening subrecord through its closing one is skipped, so a field
 * nested in a component never passes for the record's own field of the same
 * signature.
 *
 * @param visit - Called with the signature and the payload's start and end offsets.
 */
export const forEachSubrecord = (
  data: Buffer,
  visit: (sig: string, start: number, end: number) => void,
  components: ComponentBrackets = null,
): void => {
  let pos = 0;
  let oversizeNext = 0;
  let inComponent = false;
  while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
    const sig = data.toString('ascii', pos, pos + 4);
    const size = oversizeNext > 0 ? oversizeNext : data.readUInt16LE(pos + 4);
    oversizeNext = 0;
    const start = pos + SUBRECORD_HEADER_SIZE;
    const end = start + size;
    if (end > data.length) break;

    if (sig === 'XXXX' && size === 4) {
      oversizeNext = data.readUInt32LE(start);
    } else if (components && sig === components.begin) {
      inComponent = true;
    } else if (components && sig === components.end) {
      inComponent = false;
    } else if (!inComponent) {
      visit(sig, start, end);
    }
    pos = end;
  }
};

/** Read a non-zero FormID from a 4-byte subrecord as 8-char uppercase hex. */
export const readFormIdAt = (data: Buffer, offset: number): string | null => {
  const raw = data.readUInt32LE(offset);
  return raw === 0 ? null : raw.toString(16).toUpperCase().padStart(8, '0');
};

/** Format a raw uint32 FormID as 8-char uppercase hex. */
export const formatFormId = (raw: number): string =>
  raw.toString(16).toUpperCase().padStart(8, '0');
