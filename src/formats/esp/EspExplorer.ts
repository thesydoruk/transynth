/**
 * ESP/ESM plugin explorer for the web-UI record browser.
 *
 * Provides read-only traversal and paginated access to records within an
 * ESP/ESM plugin buffer. Unlike {@link EspReader}, which focuses on
 * translatable string extraction, EspExplorer supports interactive
 * exploration: listing top-level GRUPs, paginating records with optional
 * signature/query filters, and decoding subrecord previews.
 *
 * All parsing is best-effort — unknown or corrupted records are silently
 * skipped rather than throwing.
 */
import { inflateSync } from 'zlib';
import type { EspGrupInfo, EspRecordsPage, EspRecordView, EspSubrecordView } from '../types';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;
const FLAG_COMPRESSED = 0x00040000;

/**
 * Best-effort decode of an arbitrary record payload slice as human-readable text.
 */
const tryDecodeText = (buf: Buffer, start: number, end: number): string | null => {
  if (end <= start) return null;
  const slice = buf.subarray(start, Math.min(end, start + 256));
  try {
    const str = slice.toString('utf8').replace(/\0/g, '').trim();
    if (/[a-zA-Z0-9\u00C0-\u024F!"'()\-.,?]/.test(str)) return str;
    return null;
  } catch {
    return null;
  }
};

/**
 * Explorer-only record traversal and pagination for ESP files.
 */
export class EspExplorer {
  private readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  /**
   * Catalog top-level GRUP signatures and nested record counts.
   */
  listGrups(): EspGrupInfo[] {
    const tes4DataSize = this.buf.readUInt32LE(4);
    let pos = RECORD_HEADER_SIZE + tes4DataSize;
    const result: EspGrupInfo[] = [];

    while (pos + GRUP_HEADER_SIZE <= this.buf.length) {
      const sig = this.buf.toString('ascii', pos, pos + 4);
      if (sig !== 'GRUP') break;

      const groupSize = this.buf.readUInt32LE(pos + 4);
      const label = this.buf.toString('ascii', pos + 8, pos + 12);
      const groupEnd = Math.min(pos + groupSize, this.buf.length);

      result.push({
        signature: label,
        recordCount: this.countRecordsInRange(pos + GRUP_HEADER_SIZE, groupEnd),
      });

      pos = groupEnd;
    }

    return result;
  }

  /**
   * Return a paginated slice of records matching signature/query filters.
   */
  getRecordsPage(sig: string, skip: number, take: number, q = ''): EspRecordsPage {
    const sigFilter = sig ? sig.toUpperCase().slice(0, 4) : null;
    const all = this.collectMatchingRecords(sigFilter, q);
    return {
      records: all.slice(skip, skip + take),
      total: all.length,
    };
  }

  /**
   * Recursively count all non-GRUP records in the buffer range [start, end).
   */
  private countRecordsInRange(start: number, end: number): number {
    let pos = start;
    let count = 0;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = this.buf.toString('ascii', pos, pos + 4);
      if (sig === 'GRUP') {
        const groupSize = this.buf.readUInt32LE(pos + 4);
        const groupEnd = Math.min(pos + groupSize, end);
        count += this.countRecordsInRange(pos + GRUP_HEADER_SIZE, groupEnd);
        pos = groupEnd;
      } else {
        count++;
        const dataSize = this.buf.readUInt32LE(pos + 4);
        pos += RECORD_HEADER_SIZE + dataSize;
      }
    }

    return count;
  }

  /**
   * Walk the entire plugin and collect matching records.
   */
  private collectMatchingRecords(sigFilter: string | null, q: string): EspRecordView[] {
    const tes4DataSize = this.buf.readUInt32LE(4);
    const out: EspRecordView[] = [];
    this.walkRecordRange(RECORD_HEADER_SIZE + tes4DataSize, this.buf.length, sigFilter, q, out);
    return out;
  }

  /**
   * Recursive record walker used by collectMatchingRecords().
   */
  private walkRecordRange(
    start: number,
    end: number,
    sigFilter: string | null,
    q: string,
    out: EspRecordView[],
  ): void {
    let pos = start;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = this.buf.toString('ascii', pos, pos + 4);

      if (sig === 'GRUP') {
        const groupSize = this.buf.readUInt32LE(pos + 4);
        const groupEnd = Math.min(pos + groupSize, end);
        this.walkRecordRange(pos + GRUP_HEADER_SIZE, groupEnd, sigFilter, q, out);
        pos = groupEnd;
      } else {
        const dataSize = this.buf.readUInt32LE(pos + 4);
        const flags = this.buf.readUInt32LE(pos + 8);
        const formIdRaw = this.buf.readUInt32LE(pos + 12);
        const formIdHex = formIdRaw.toString(16).toUpperCase().padStart(8, '0');

        if (!sigFilter || sig === sigFilter) {
          const view = this.buildRecordView(pos, sig, formIdHex, flags);
          if (!q || this.recordMatchesQuery(view, q.toLowerCase())) {
            out.push(view);
          }
        }

        pos += RECORD_HEADER_SIZE + dataSize;
      }
    }
  }

  /**
   * Parse a single record into an explorer view model.
   */
  private buildRecordView(
    recOffset: number,
    recSig: string,
    formIdHex: string,
    flags: number,
  ): EspRecordView {
    const dataSize = this.buf.readUInt32LE(recOffset + 4);
    const compressed = (flags & FLAG_COMPRESSED) !== 0;

    let recordData: Buffer;

    if (compressed) {
      const compDataStart = recOffset + RECORD_HEADER_SIZE;
      const compData = this.buf.subarray(
        compDataStart + 4,
        recOffset + RECORD_HEADER_SIZE + dataSize,
      );
      try {
        recordData = inflateSync(compData);
      } catch {
        return {
          formId: formIdHex,
          signature: recSig,
          flagsHex: flags.toString(16).toUpperCase().padStart(8, '0'),
          compressed: true,
          edid: '',
          subrecords: [],
        };
      }
    } else {
      recordData = this.buf.subarray(
        recOffset + RECORD_HEADER_SIZE,
        recOffset + RECORD_HEADER_SIZE + dataSize,
      );
    }

    let edid = '';
    const subrecords: EspSubrecordView[] = [];
    const maxSubrecords = 64;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= recordData.length && subrecords.length < maxSubrecords) {
      const subSig = recordData.toString('ascii', pos, pos + 4);
      const subSize = recordData.readUInt16LE(pos + 4);
      const dataStart = pos + SUBRECORD_HEADER_SIZE;
      const dataEnd = Math.min(dataStart + subSize, recordData.length);

      if (subSig === 'EDID') {
        edid = recordData.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
      }

      const previewEnd = Math.min(dataEnd, dataStart + 48);
      const previewBytes = recordData.subarray(dataStart, previewEnd);
      const hexPreview = previewBytes.toString('hex').replace(/../g, '$& ').trimEnd().toUpperCase();
      const textHint = tryDecodeText(recordData, dataStart, dataEnd);
      subrecords.push({ sig: subSig, size: subSize, hexPreview, textHint });

      pos = dataEnd;
    }

    return {
      formId: formIdHex,
      signature: recSig,
      flagsHex: flags.toString(16).toUpperCase().padStart(8, '0'),
      compressed,
      edid,
      subrecords,
    };
  }

  /**
   * Return true if any searchable field of the record contains the query.
   */
  private recordMatchesQuery(view: EspRecordView, lower: string): boolean {
    if (view.formId.toLowerCase().includes(lower)) return true;
    if (view.edid.toLowerCase().includes(lower)) return true;
    return view.subrecords.some(
      (s) =>
        s.sig.toLowerCase().includes(lower) || (s.textHint?.toLowerCase().includes(lower) ?? false),
    );
  }
}
