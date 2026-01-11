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
import { log } from '../logger.js';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;
const FLAG_LOCALIZED = 0x00000080;

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

  constructor(filePath: string) {
    log.debug(`ESP: opening ${filePath}`);
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
      } else if (isTranslatableSubrecord(recSig, subSig)) {
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
}
