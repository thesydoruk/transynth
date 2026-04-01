/**
 * EspReader.ts
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
import { isTranslatableSubrecord } from '../knownStrings.js';
import type { GameType } from '../../types.js';
import { log } from '../../logger.js';
import { EspExplorer } from './EspExplorer.js';
import { EspSceneExtractor } from './EspSceneExtractor.js';
import type {
  EspGrupInfo,
  EspPluginInfo,
  EspRecordsPage,
  EspStringRow,
  SceneRecord,
} from './types/index.js';

export type {
  EspGrupInfo,
  EspPluginInfo,
  EspRecordsPage,
  EspRecordView,
  EspStringRow,
  EspSubrecordView,
  SceneAction,
  SceneRecord,
} from './types/index.js';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;
const FLAG_LOCALIZED = 0x00000080;

/**
 * Native reader for Bethesda ESP/ESM/ESL plugin files.
 *
 * The reader supports two primary use cases:
 * - **Import/extraction**: scan the plugin structure and extract translatable
 *   fields as {@link EspStringRow} values.
 * - **Explorer API**: provide a raw record browser for debugging and QA.
 *
 * The constructor reads the entire plugin into memory for random access. This
 * is acceptable for typical mod plugin sizes and greatly simplifies record
 * traversal and decompression.
 */
export class EspReader {
  private buf: Buffer;
  private readonly explorer: EspExplorer;
  private readonly sceneExtractor: EspSceneExtractor;
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
    this.explorer = new EspExplorer(this.buf);
    this.sceneExtractor = new EspSceneExtractor(this.buf);
    this.parseHeader();
    log.info(`ESP: ${filePath} — localized=${this.info.isLocalized}, masters=[${this.info.masterFiles.join(', ')}]`);
  }

  /**
   * Parse the TES4 header record and populate {@link EspReader.info}.
   *
   * This extracts:
   * - the localized flag (external string tables vs inline text),
   * - master file list (MAST subrecords),
   * - author and description strings (CNAM/SNAM).
   *
   * @throws Error if the plugin does not start with a TES4 record.
   */
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
   *
   * - For localized plugins, `text` contains a decimal LString ID that must be
   *   resolved through `.STRINGS` / `.DLSTRINGS` / `.ILSTRINGS` tables.
   * - For non-localized plugins, `text` contains the actual inline UTF‑8 string.
   *
   * @returns Flat list of extracted string rows.
   */
  extractStrings(): EspStringRow[] {
    const rows: EspStringRow[] = [];
    const buf = this.buf;

    // Skip TES4 record
    const tes4DataSize = buf.readUInt32LE(4);
    const pos = RECORD_HEADER_SIZE + tes4DataSize;

    this.walkRange(pos, buf.length, rows, undefined);
    log.debug(`ESP: extracted ${rows.length} translatable strings`);
    return rows;
  }

  /**
   * Extract all SCEN records that contain dialog actions.
   *
   * Walks the entire plugin file, collecting scene records where at least one
   * action references a DIAL topic (via the DATA subrecord inside an action
   * block).  Actions are ordered by their start phase, so the resulting array
   * reflects the in-game dialog sequence.
   *
   * @returns Array of {@link SceneRecord} values (only scenes with dialog).
   */
  extractScenes(): SceneRecord[] {
    return this.sceneExtractor.extractScenes();
  }

  /**
   * Recursively walk a byte range that contains records and nested GRUP blocks.
   *
   * ESP plugins are arranged as a TES4 header record followed by a tree of GRUP
   * containers. Each GRUP contains more GRUPs and/or regular records.
   *
   * @param start - Inclusive byte offset to begin scanning.
   * @param end - Exclusive byte offset to stop scanning.
   * @param rows - Accumulator for extracted translatable string rows.
   * @param currentDialogTopicFormId - Parent DIAL FormID when traversing a
   * topic-children group (GRUP type 7).
   */
  private walkRange(
    start: number,
    end: number,
    rows: EspStringRow[],
    currentDialogTopicFormId?: string,
  ): void {
    const buf = this.buf;
    let pos = start;

    while (pos + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', pos, pos + 4);

      if (sig === 'GRUP') {
        const groupSize = buf.readUInt32LE(pos + 4);
        const groupEnd = pos + groupSize;
        const groupLabelRaw = buf.readUInt32LE(pos + 8);
        const groupType = buf.readInt32LE(pos + 12);
        const nextDialogTopicFormId = groupType === 7
          ? groupLabelRaw.toString(16).toUpperCase().padStart(8, '0')
          : currentDialogTopicFormId;
        // Recurse into group contents
        this.walkRange(pos + GRUP_HEADER_SIZE, Math.min(groupEnd, end), rows, nextDialogTopicFormId);
        pos = groupEnd;
      } else {
        const dataSize = buf.readUInt32LE(pos + 4);
        const flags = buf.readUInt32LE(pos + 8);
        const formIdRaw = buf.readUInt32LE(pos + 12);
        const formIdHex = formIdRaw.toString(16).toUpperCase().padStart(8, '0');
        const recordEnd = pos + RECORD_HEADER_SIZE + dataSize;

        this.parseRecord(pos, formIdHex, sig, flags, rows, currentDialogTopicFormId);
        pos = recordEnd;
      }
    }
  }

  /**
   * Parse one record and extract any translatable subrecord fields.
   *
   * Records may be stored compressed; when the compressed flag is set, the
   * record payload is zlib-inflated before scanning its subrecords.
   *
   * For localized plugins we only treat 4-byte translatable subrecords as
   * LString IDs (uint32). For non-localized plugins we decode the subrecord
   * payload as UTF‑8 and strip NUL bytes.
   *
   * @param recOffset - Byte offset of the 24-byte record header within the plugin buffer.
   * @param formIdHex - Record FormID formatted as 8-char uppercase hex.
   * @param recSig - 4-char record signature (type), e.g. `"ARMO"`.
   * @param flags - Raw record flags from the record header.
   * @param rows - Accumulator for extracted translatable string rows.
   * @param dialogTopicFormId - Parent DIAL FormID for INFO records (if known).
   */
  private parseRecord(
    recOffset: number,
    formIdHex: string,
    recSig: string,
    flags: number,
    rows: EspStringRow[],
    dialogTopicFormId?: string,
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
    let speakerFormId: string | undefined;
    let previousInfoFormId: string | undefined;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= recordData.length) {
      const subSig = recordData.toString('ascii', pos, pos + 4);
      const subSize = recordData.readUInt16LE(pos + 4);
      const dataStart = pos + SUBRECORD_HEADER_SIZE;
      const dataEnd = dataStart + subSize;

      if (subSig === 'EDID') {
        edid = recordData.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
      } else if (recSig === 'INFO' && subSig === 'ANAM' && subSize === 4) {
        // Actor speaker FormID for dialog INFO records (little-endian uint32)
        const rawId = recordData.readUInt32LE(dataStart);
        if (rawId !== 0) {
          speakerFormId = rawId.toString(16).toUpperCase().padStart(8, '0');
        }
      } else if (recSig === 'INFO' && subSig === 'PNAM' && subSize === 4) {
        const rawPrevId = recordData.readUInt32LE(dataStart);
        if (rawPrevId !== 0) {
          previousInfoFormId = rawPrevId.toString(16).toUpperCase().padStart(8, '0');
        }
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
        speakerFormId,
        dialogTopicFormId,
        previousInfoFormId,
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
    return this.explorer.listGrups();
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
    return this.explorer.getRecordsPage(sig, skip, take, q);
  }
}
