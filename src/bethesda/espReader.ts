/**
 * espReader.ts
 *
 * Native reader for Bethesda ESP / ESM / ESL plugin files.
 *
 * Record binary layout (24 bytes header):
 *   sig        : char[4]   — record type (e.g. "TES4", "ARMO", "INFO")
 *   dataSize   : uint32    — size of record data after this header
 *   flags      : uint32    — 0x00040000 = compressed; 0x00000080 = localized
 *   formId     : uint32
 *   vcStamp    : uint16
 *   vcRevision : uint16
 *   version    : uint16
 *   unknown    : uint16
 *
 * GRUP record layout (24 bytes header):
 *   sig        : char[4]   = "GRUP"
 *   groupSize  : uint32    — total size INCLUDING this header
 *   label      : char[4]   — for top-level groups: the record type
 *   groupType  : int32
 *   stamp      : uint16
 *   unknown    : uint16
 *   version    : uint16
 *   unknown2   : uint16
 *
 * Subrecord layout (6 bytes header):
 *   sig   : char[4]
 *   size  : uint16
 *
 * For localized plugins (TES4.flags & 0x80): translatable subrecords contain
 * a uint32 LString ID (4 bytes). Resolve with .STRINGS/.DLSTRINGS/.ILSTRINGS.
 * For non-localized: translatable subrecords contain null-terminated UTF-8 text.
 */

import fs from 'fs';
import { inflateSync } from 'zlib';
import { isTranslatableSubrecord } from './knownStrings.js';
import type { GameType } from '../types.js';
import { log } from '../logger.js';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;
const FLAG_LOCALIZED = 0x00000080;

// ──────────────────────────────────────────────────────────────────────────
// Explorer API types — used by the ESP raw record explorer page
// ──────────────────────────────────────────────────────────────────────────

/**
 * Summary of one top-level GRUP in an ESP plugin.
 * Returned by EspReader.listGrups().
 */
export interface EspGrupInfo {
  /** 4-char record type that identifies this group, e.g. "ARMO" or "INFO". */
  signature: string;
  /** Total number of non-GRUP records nested anywhere inside this group. */
  recordCount: number;
}

/**
 * A single subrecord rendered for display in the explorer.
 * Raw bytes are capped so that the response does not become too large.
 */
export interface EspSubrecordView {
  /** 4-char subrecord type, e.g. "FULL" or "EDID". */
  sig: string;
  /** Original uncompressed byte count. */
  size: number;
  /** Up to 48 bytes encoded as uppercase space-separated hex pairs. */
  hexPreview: string;
  /** Best-effort UTF-8 decode of the data; null when the data is binary. */
  textHint: string | null;
}

/**
 * A single ESP record rendered for display in the explorer.
 * Subrecords are included (capped at 64).
 */
export interface EspRecordView {
  /** FormID as 8-char uppercase hex string, e.g. "0001A2B3". */
  formId: string;
  /** 4-char record type, e.g. "ARMO". */
  signature: string;
  /** Raw flags field encoded as 8-char uppercase hex. */
  flagsHex: string;
  /** True if this record was stored in compressed (zlib) form. */
  compressed: boolean;
  /** Editor ID from EDID subrecord, or empty string if absent. */
  edid: string;
  /** All subrecords (up to 64) with preview data. */
  subrecords: EspSubrecordView[];
}

/**
 * Paginated result returned by EspReader.getRecordsPage().
 */
export interface EspRecordsPage {
  /** Records for the requested page. */
  records: EspRecordView[];
  /** Total matching record count (across all pages). */
  total: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Module-level helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Try to decode a buffer slice as UTF-8 text.
 * Returns the decoded string only when it contains at least one printable
 * non-whitespace character; returns null for binary-looking data.
 *
 * @param buf   - Source buffer.
 * @param start - Inclusive start offset.
 * @param end   - Exclusive end offset.
 */
function tryDecodeText(buf: Buffer, start: number, end: number): string | null {
  if (end <= start) return null;
  // Limit to first 256 bytes to keep response sizes sane
  const slice = buf.subarray(start, Math.min(end, start + 256));
  try {
    const str = slice.toString('utf8').replace(/\0/g, '').trim();
    // Require at least one letter, digit, or common punctuation character
    if (/[a-zA-Z0-9\u00C0-\u024F!"'()\-.,?]/.test(str)) return str;
    return null;
  } catch {
    return null;
  }
}

export interface EspStringRow {
  /** FormID as hex string (8 uppercase chars), e.g. "0001A2B3" */
  formId: string;
  /** 4-char record type, e.g. "ARMO" */
  signature: string;
  /** Editor ID (EDID subrecord), empty if not present */
  edid: string;
  /** Subrecord path, e.g. "FULL" or "INFO\NAM1" */
  path: string;
  /** For localized: uint32 lstring ID; for non-localized: the actual text */
  text: string;
  /** true if this plugin is localized (text is an lstring ID, not real text) */
  isLstringId: boolean;
}

export interface EspPluginInfo {
  isLocalized: boolean;
  masterFiles: string[];
  author: string;
  description: string;
}

export class EspReader {
  private buf: Buffer;
  public info!: EspPluginInfo;
  /** Target game — determines which subrecords are extracted. */
  private readonly game: GameType;

  /**
   * @param filePath - Absolute path to the .esp/.esm/.esl plugin file.
   * @param game     - Set to `'sse'` for Skyrim SE plugins; defaults to `'fo4'`.
   */
  constructor(filePath: string, game: GameType = 'fo4') {
    log.debug(`ESP: opening ${filePath} (game=${game})`);
    this.game = game;
    this.buf = fs.readFileSync(filePath);
    this.parseHeader();
    log.info(`ESP: ${filePath} — localized=${this.info.isLocalized}, masters=[${this.info.masterFiles.join(', ')}]`);
  }

  private parseHeader(): void {
    const buf = this.buf;
    if (buf.length < RECORD_HEADER_SIZE) throw new Error('ESP: file too small');

    const sig = buf.toString('ascii', 0, 4);
    if (sig !== 'TES4') throw new Error(`ESP: expected TES4, got "${sig}"`);

    const dataSize = buf.readUInt32LE(4);
    const flags = buf.readUInt32LE(8);
    const isLocalized = (flags & FLAG_LOCALIZED) !== 0;

    const masterFiles: string[] = [];
    let author = '';
    let description = '';

    let pos = RECORD_HEADER_SIZE;
    const end = RECORD_HEADER_SIZE + dataSize;
    while (pos + SUBRECORD_HEADER_SIZE <= end) {
      const subSig = buf.toString('ascii', pos, pos + 4);
      const subSize = buf.readUInt16LE(pos + 4);
      const dataStart = pos + SUBRECORD_HEADER_SIZE;

      if (subSig === 'MAST') {
        masterFiles.push(buf.toString('utf8', dataStart, dataStart + subSize).replace(/\0/g, ''));
      } else if (subSig === 'CNAM') {
        author = buf.toString('utf8', dataStart, dataStart + subSize).replace(/\0/g, '');
      } else if (subSig === 'SNAM') {
        description = buf.toString('utf8', dataStart, dataStart + subSize).replace(/\0/g, '');
      }

      pos = dataStart + subSize;
    }

    this.info = { isLocalized, masterFiles, author, description };
  }

  /**
   * Walk all records in the plugin and extract translatable string rows.
   * For localized plugins, `text` = string decimal ID; resolve with STRINGS files.
   * For non-localized plugins, `text` = actual string.
   */
  extractStrings(): EspStringRow[] {
    const rows: EspStringRow[] = [];
    const buf = this.buf;

    // Skip TES4 record
    const tes4DataSize = buf.readUInt32LE(4);
    const pos = RECORD_HEADER_SIZE + tes4DataSize;

    this.walkRange(pos, buf.length, rows, '');
    log.debug(`ESP: extracted ${rows.length} translatable strings`);
    return rows;
  }

  private walkRange(start: number, end: number, rows: EspStringRow[], _groupLabel: string): void {
    const buf = this.buf;
    let pos = start;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', pos, pos + 4);

      if (sig === 'GRUP') {
        const groupSize = buf.readUInt32LE(pos + 4);
        const groupEnd = pos + groupSize;
        // Recurse into group contents
        this.walkRange(pos + GRUP_HEADER_SIZE, Math.min(groupEnd, end), rows, sig);
        pos = groupEnd;
      } else {
        const dataSize = buf.readUInt32LE(pos + 4);
        const flags = buf.readUInt32LE(pos + 8);
        const formIdRaw = buf.readUInt32LE(pos + 12);
        const formIdHex = formIdRaw.toString(16).toUpperCase().padStart(8, '0');
        const recordEnd = pos + RECORD_HEADER_SIZE + dataSize;

        this.parseRecord(pos, formIdHex, sig, flags, rows);
        pos = recordEnd;
      }
    }
  }

  private parseRecord(
    recOffset: number,
    formIdHex: string,
    recSig: string,
    flags: number,
    rows: EspStringRow[],
  ): void {
    const buf = this.buf;
    const dataSize = buf.readUInt32LE(recOffset + 4);
    const recEnd = recOffset + RECORD_HEADER_SIZE + dataSize;

    let recordData: Buffer;

    if (flags & FLAG_COMPRESSED) {
      const compDataStart = recOffset + RECORD_HEADER_SIZE;
      // First 4 bytes = uncompressed size
      const uncompressedSize = buf.readUInt32LE(compDataStart);
      const compData = buf.subarray(compDataStart + 4, recOffset + RECORD_HEADER_SIZE + dataSize);
      try {
        recordData = inflateSync(compData);
        if (recordData.length !== uncompressedSize) {
          // Tolerate minor size mismatches from padding
        }
      } catch (err) {
        log.warn(`ESP: failed to decompress record ${formIdHex} (${recSig}): ${err}`);
        return; // skip corrupt compressed record
      }
    } else {
      recordData = buf.subarray(recOffset + RECORD_HEADER_SIZE, recEnd);
    }

    let edid = '';
    const subRows: Array<{ path: string; text: string }> = [];

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= recordData.length) {
      const subSig = recordData.toString('ascii', pos, pos + 4);
      const subSize = recordData.readUInt16LE(pos + 4);
      const dataStart = pos + SUBRECORD_HEADER_SIZE;
      const dataEnd = dataStart + subSize;

      if (subSig === 'EDID') {
        edid = recordData.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
      } else if (isTranslatableSubrecord(recSig, subSig, this.game)) {
        if (this.info.isLocalized && subSize === 4) {
          // LString ID
          const lstrId = recordData.readUInt32LE(dataStart);
          if (lstrId !== 0) {
            subRows.push({ path: subSig, text: String(lstrId) });
          }
        } else if (!this.info.isLocalized && subSize > 0) {
          // Direct text
          const text = recordData
            .toString('utf8', dataStart, dataEnd)
            .replace(/\0/g, '');
          if (text) {
            subRows.push({ path: subSig, text });
          }
        }
      }

      pos = dataEnd;
    }

    for (const { path, text } of subRows) {
      rows.push({
        formId: formIdHex,
        signature: recSig,
        edid,
        path,
        text,
        isLstringId: this.info.isLocalized,
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Explorer API — used by the ESP raw record explorer page
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Catalog all top-level GRUP types in this plugin and count the records
   * nested inside each one.  Only walks the immediate top-level GRUPs; the
   * record count is the *total* recursive count for each group.
   *
   * @returns Array of GRUP descriptors ordered as they appear in the file.
   */
  listGrups(): EspGrupInfo[] {
    const buf = this.buf;
    const tes4DataSize = buf.readUInt32LE(4);
    let pos = RECORD_HEADER_SIZE + tes4DataSize;
    const result: EspGrupInfo[] = [];

    while (pos + GRUP_HEADER_SIZE <= buf.length) {
      const sig = buf.toString('ascii', pos, pos + 4);
      // The first-level layout after TES4 should only be GRUPs; stop on anything else
      if (sig !== 'GRUP') break;

      const groupSize = buf.readUInt32LE(pos + 4);
      // Offset +8: 4-byte group label (record type for top-level type groups)
      const label = buf.toString('ascii', pos + 8, pos + 12);
      const groupEnd = Math.min(pos + groupSize, buf.length);

      result.push({
        signature: label,
        recordCount: this.countRecordsInRange(pos + GRUP_HEADER_SIZE, groupEnd),
      });

      pos = groupEnd;
    }

    return result;
  }

  /**
   * Return a paginated slice of records matching the given signature filter
   * and optional full-text query.
   *
   * @param sig      - 4-char record type to filter by. Empty string = all records.
   * @param skip     - Number of matching records to skip (0-based, for paging).
   * @param take     - Maximum records to include in the result.
   * @param q        - Optional search string matched against FormID, EDID, and
   *                   subrecord text hints (case-insensitive).
   * @returns Paginated result with the matching records and total match count.
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
   *
   * @param start - Inclusive byte offset to start scanning.
   * @param end   - Exclusive byte offset to stop scanning.
   * @returns Total record count.
   */
  private countRecordsInRange(start: number, end: number): number {
    const buf = this.buf;
    let pos = start;
    let count = 0;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', pos, pos + 4);
      if (sig === 'GRUP') {
        const groupSize = buf.readUInt32LE(pos + 4);
        const groupEnd = Math.min(pos + groupSize, end);
        count += this.countRecordsInRange(pos + GRUP_HEADER_SIZE, groupEnd);
        pos = groupEnd;
      } else {
        count++;
        const dataSize = buf.readUInt32LE(pos + 4);
        pos += RECORD_HEADER_SIZE + dataSize;
      }
    }

    return count;
  }

  /**
   * Walk the entire plugin (after TES4), collect all records that match
   * the optional signature filter and search query.
   *
   * @param sigFilter - Uppercase 4-char record type to match, or null for all.
   * @param q         - Search query string, or empty string to skip filtering.
   * @returns Flat array of matching EspRecordView entries.
   */
  private collectMatchingRecords(sigFilter: string | null, q: string): EspRecordView[] {
    const buf = this.buf;
    const tes4DataSize = buf.readUInt32LE(4);
    const out: EspRecordView[] = [];
    this.walkRecordRange(RECORD_HEADER_SIZE + tes4DataSize, buf.length, sigFilter, q, out);
    return out;
  }

  /**
   * Recursive record walker — fills `out` with parsed EspRecordView entries.
   *
   * @param start     - Inclusive byte offset to begin scanning.
   * @param end       - Exclusive byte offset to stop scanning.
   * @param sigFilter - Uppercase 4-char type filter, or null for all.
   * @param q         - Lowercase search query, or empty string for no filter.
   * @param out       - Accumulator array.
   */
  private walkRecordRange(
    start: number,
    end: number,
    sigFilter: string | null,
    q: string,
    out: EspRecordView[],
  ): void {
    const buf = this.buf;
    let pos = start;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', pos, pos + 4);

      if (sig === 'GRUP') {
        const groupSize = buf.readUInt32LE(pos + 4);
        const groupEnd = Math.min(pos + groupSize, end);
        this.walkRecordRange(pos + GRUP_HEADER_SIZE, groupEnd, sigFilter, q, out);
        pos = groupEnd;
      } else {
        const dataSize = buf.readUInt32LE(pos + 4);
        const flags = buf.readUInt32LE(pos + 8);
        const formIdRaw = buf.readUInt32LE(pos + 12);
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
   * Parse a single record into an EspRecordView.
   * Decompresses the record data when the compressed flag is set and extracts
   * all subrecords (up to 64) with hex previews and text hints.
   *
   * @param recOffset - Byte offset of the 24-byte record header in this.buf.
   * @param recSig    - 4-char record type.
   * @param formIdHex - FormID already formatted as 8-char uppercase hex.
   * @param flags     - Raw 32-bit record flags.
   * @returns Fully populated EspRecordView.
   */
  private buildRecordView(
    recOffset: number,
    recSig: string,
    formIdHex: string,
    flags: number,
  ): EspRecordView {
    const buf = this.buf;
    const dataSize = buf.readUInt32LE(recOffset + 4);
    const compressed = (flags & FLAG_COMPRESSED) !== 0;

    let recordData: Buffer;

    if (compressed) {
      const compDataStart = recOffset + RECORD_HEADER_SIZE;
      // First 4 bytes of compressed data = uncompressed size (uint32 LE)
      const compData = buf.subarray(compDataStart + 4, recOffset + RECORD_HEADER_SIZE + dataSize);
      try {
        recordData = inflateSync(compData);
      } catch {
        // Return a minimal view when decompression fails — still useful for formId/flags
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
      recordData = buf.subarray(recOffset + RECORD_HEADER_SIZE, recOffset + RECORD_HEADER_SIZE + dataSize);
    }

    let edid = '';
    const subrecords: EspSubrecordView[] = [];
    // Cap subrecords to prevent oversized API responses for complex records
    const MAX_SUBRECORDS = 64;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= recordData.length && subrecords.length < MAX_SUBRECORDS) {
      const subSig = recordData.toString('ascii', pos, pos + 4);
      const subSize = recordData.readUInt16LE(pos + 4);
      const dataStart = pos + SUBRECORD_HEADER_SIZE;
      const dataEnd = Math.min(dataStart + subSize, recordData.length);

      if (subSig === 'EDID') {
        edid = recordData.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
      }

      // Build hex preview from the first 48 bytes of the subrecord payload
      const previewEnd = Math.min(dataEnd, dataStart + 48);
      const previewBytes = recordData.subarray(dataStart, previewEnd);
      // Format as uppercase space-separated hex pairs
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
   * The query must already be lowercased by the caller.
   *
   * @param view  - Parsed record view.
   * @param lower - Lowercased search query.
   */
  private recordMatchesQuery(view: EspRecordView, lower: string): boolean {
    if (view.formId.toLowerCase().includes(lower)) return true;
    if (view.edid.toLowerCase().includes(lower)) return true;
    return view.subrecords.some(
      (s) => s.sig.toLowerCase().includes(lower) || (s.textHint?.toLowerCase().includes(lower) ?? false),
    );
  }
}
