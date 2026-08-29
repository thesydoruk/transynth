/**
 * pexReader.ts
 *
 * Parser for compiled Papyrus script files (.pex) used in Bethesda games
 * (Skyrim, Skyrim SE, Fallout 4, etc.).
 *
 * PEX format reference:
 *   https://en.uesp.net/wiki/Skyrim_Mod:Compiled_Script_File_Format
 *
 * Binary layout (Skyrim-era tooling uses big-endian; Fallout 4 / modern CK emit
 * little-endian magic, wstring lengths, and string-table counts):
 *
 *   Header (fixed portion — 16 bytes):
 *     magic           : uint32   = 0xFA57C0DE
 *     majorVersion    : uint8    (3 for Fallout 4 / Skyrim SE)
 *     minorVersion    : uint8
 *     gameId          : uint16   (1 = Skyrim, 3 = Fallout 4)
 *     compilationTime : uint64   (epoch seconds — not used here)
 *
 *   Header (variable portion — three wstrings):
 *     sourceFileName  : wstring  (name of the .psc source, e.g. "TriggerScript.psc")
 *     username        : wstring  (author's username at compile time)
 *     machinename     : wstring  (hostname at compile time)
 *
 *   String table (comes immediately after the three header wstrings):
 *     count   : uint16
 *     strings : wstring[count]
 *
 *   … followed by debugInfo, userFlags, and objects — not parsed here.
 *
 * wstring encoding:
 *   uint16 length prefix (BE or LE, matching the file endianness) + UTF-8 body.
 *   No null terminator.
 *
 * Key insight for string extraction:
 *   The string table is a flat list of ALL strings referenced anywhere in the
 *   script — class names, function names, type names, AND inline string
 *   literals.  Identifiers and type names never contain whitespace or
 *   sentence-level punctuation, so those characters act as a reliable proxy
 *   for user-visible text that might need localisation.
 */

import type { PexEndian } from './pexBinary';
import { readUInt16, readWString as readWStringRaw } from './pexBinary';
import {
  analyzePexStringUsages,
  buildPexUserStringDetails,
  readPexStringTable,
  type PexStringUsage,
  type PexUserStringDetail,
} from './usage';

/** Magic number at offset 0 of every valid PEX file. */
const PEX_MAGIC = 0xfa57c0de;

export type { PexEndian } from './pexBinary';
export type { PexStringUsage, PexUserStringDetail } from './usage';

import path from 'node:path';

type PexEndianLocal = PexEndian;

const detectPexEndian = (buf: Buffer): PexEndianLocal => {
  if (buf.length < 4) {
    throw new Error(`PEX: file too small (${buf.length} bytes)`);
  }
  if (buf.readUInt32LE(0) === PEX_MAGIC) return 'le';
  if (buf.readUInt32BE(0) === PEX_MAGIC) return 'be';
  const be = buf.readUInt32BE(0);
  throw new Error(
    `PEX: invalid magic 0x${be.toString(16).toUpperCase().padStart(8, '0')} (expected 0xFA57C0DE)`,
  );
};

const readUInt16At = (buf: Buffer, offset: number, endian: PexEndianLocal): number =>
  readUInt16(buf, offset, endian);

const writeUInt16 = (buf: Buffer, value: number, offset: number, endian: PexEndianLocal): void => {
  if (endian === 'le') buf.writeUInt16LE(value, offset);
  else buf.writeUInt16BE(value, offset);
};

/** Metadata extracted from the PEX header. */
export interface PexInfo {
  /** Source .psc file name recorded in the PEX header (e.g. "CraftingScript.psc"). */
  sourceFile: string;
  /** Game ID encoded in the header (1 = Skyrim, 3 = Fallout 4). */
  gameId: number;
  /** Compiler version as a "major.minor" string. */
  version: string;
}

/** Result returned by {@link parsePexBuffer}. */
export interface PexResult {
  /** Metadata from the PEX header. */
  info: PexInfo;
  /**
   * User-visible strings filtered from the string table.
   * Identifiers, type names, and empty strings are excluded via
   * {@link isLikelyUserText}.
   */
  strings: string[];
  /** User-visible literals with bytecode usage sites (when analysis succeeds). */
  userStrings: PexUserStringDetail[];
}

// ── Internal parser helpers ─────────────────────────────────────────────────

/**
 * Read a PEX wstring (uint16 length prefix + UTF-8 body) at the given offset.
 * Defaults to big-endian for legacy Skyrim-style fixtures.
 */
export const readWString = (
  buf: Buffer,
  offset: number,
  endian: PexEndianLocal = 'be',
): { value: string; nextOffset: number } => {
  if (offset + 2 > buf.length) {
    throw new Error(`PEX: out of bounds reading wstring length at offset ${offset}`);
  }
  const { value, nextOffset } = readWStringRaw(buf, offset, endian);
  if (nextOffset > buf.length) {
    throw new Error(`PEX: out of bounds reading wstring data at offset ${offset}`);
  }
  return { value, nextOffset };
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Heuristic: is this PEX string table entry likely user-visible text?
 *
 * The PEX string table contains a mix of identifiers (class names, function
 * names, type names) and string literals that could be user-visible text.
 * Since identifiers never contain whitespace or sentence punctuation, those
 * characters are used as a reliable proxy for translatable text.
 *
 * Rules applied (any one sufficient):
 *   1. Contains at least one whitespace character (nearly all natural language
 *      phrases have spaces; identifiers never do).
 *   2. Contains `!` or `?` — sentence-ending characters that identifiers never use.
 *   3. Contains `,` and is at least 6 characters — comma within a phrase.
 *
 * @param s - A string from the PEX string table
 * @returns  `true` if the string looks like user-visible text worth translating
 */
export const isLikelyUserText = (s: string): boolean => {
  // Reject empty strings and very short tokens (e.g. "a", "I" would be noise)
  if (!s || s.length < 3) return false;

  // Whitespace → almost certainly natural language (identifiers are single-word)
  if (/\s/.test(s)) return true;

  // Sentence-ending punctuation → must be user text
  if (/[!?]/.test(s)) return true;

  // Comma within a long-enough string → likely a phrase or list
  if (/,/.test(s) && s.length > 5) return true;

  return false;
};

/**
 * Parse a compiled Papyrus script buffer (.pex) and extract user-visible strings.
 *
 * Only the header and string table are parsed; the rest of the binary
 * (debug info, objects, bytecode) is skipped — we do not need full
 * decompilation to extract string literals.
 *
 * @param buf - Raw .pex file contents as a Node.js Buffer
 * @returns   PexResult with header metadata and filtered translatable strings
 * @throws    Error if the buffer does not start with the PEX magic number,
 *            or is too small to be a valid PEX file
 */
export const parsePexBuffer = (buf: Buffer): PexResult => {
  if (buf.length < 16) {
    throw new Error(`PEX: file too small (${buf.length} bytes)`);
  }

  const endian = detectPexEndian(buf);

  // ── Fixed-size header fields ─────────────────────────────────────────────
  const majorVersion = buf.readUInt8(4);
  const minorVersion = buf.readUInt8(5);
  const gameId = readUInt16At(buf, 6, endian);
  // compilationTime occupies bytes 8–15 — skip it
  let offset = 16;

  // ── Variable-length header wstrings ──────────────────────────────────────
  const { value: sourceFile, nextOffset: o1 } = readWString(buf, offset, endian);
  offset = o1;

  const { nextOffset: o2 } = readWString(buf, offset, endian);
  offset = o2;

  const { nextOffset: o3 } = readWString(buf, offset, endian);
  offset = o3;

  // ── String table ─────────────────────────────────────────────────────────
  if (offset + 2 > buf.length) {
    throw new Error('PEX: out of bounds reading string table count');
  }

  const { stringTable, nextOffset } = readPexStringTable(buf, offset, endian);
  offset = nextOffset;

  let userStrings: PexUserStringDetail[] = [];
  try {
    const usagesByTableIndex = analyzePexStringUsages(buf, offset, endian, gameId, stringTable);
    userStrings = buildPexUserStringDetails(stringTable, usagesByTableIndex);
  } catch {
    userStrings = buildPexUserStringDetails(stringTable, new Map());
  }

  const strings = userStrings.map((entry) => entry.text);

  return {
    info: {
      sourceFile,
      gameId,
      version: `${majorVersion}.${minorVersion}`,
    },
    strings,
    userStrings,
  };
};

/** Serialize a PEX wstring. Defaults to big-endian for legacy fixtures. */
export const writeWString = (value: string, endian: PexEndianLocal = 'be'): Buffer => {
  const body = Buffer.from(value, 'utf8');
  const buf = Buffer.alloc(2 + body.length);
  writeUInt16(buf, body.length, 0, endian);
  body.copy(buf, 2);
  return buf;
};

/**
 * Script name from a PEX header `sourceFile` or any script key/path.
 * Creation Kit sometimes stores an absolute dev path (e.g. `E:\BuildAgent\...\FooScript`).
 */
export const pexScriptKeyFromSourceFile = (sourceFile: string): string => {
  const trimmed = sourceFile.trim();
  if (!trimmed) return '';
  const base = path.basename(trimmed.replace(/\\/g, '/'));
  return base.replace(/\.psc$/i, '').replace(/\.pex$/i, '');
};

/** Normalize any script key (record suffix, header path, archive file name). */
export const normalizePexScriptKey = (scriptKey: string): string => {
  const fromSource = pexScriptKeyFromSourceFile(scriptKey);
  if (fromSource) return fromSource;
  const base = path.basename(scriptKey.replace(/\\/g, '/'));
  return base.replace(/\.(pex|psc)$/i, '');
};

/**
 * Resolve the script key used during import (`PEX\\{scriptKey}` record paths).
 *
 * @param info - Header metadata from {@link parsePexBuffer}.
 */
export const pexScriptKeyFromInfo = (info: PexInfo): string =>
  pexScriptKeyFromSourceFile(info.sourceFile);

/** Human-readable script context stored on `strings.context` for PEX rows. */
export const formatPexStringContext = (
  sourceFile: string,
  detail: Pick<PexUserStringDetail, 'literalIndex' | 'usages'>,
): string => {
  const stem = pexScriptKeyFromSourceFile(sourceFile);
  const file = stem ? `${stem}.psc` : 'unknown.psc';

  const usages = detail.usages;
  if (usages.length === 0) {
    return `${file} · #${detail.literalIndex}`;
  }

  const primary = usages[0]!;
  const fnLabel =
    primary.kind === 'variable-default'
      ? `var ${primary.functionName}`
      : primary.kind === 'getter'
        ? `property ${primary.functionName} (get)`
        : primary.kind === 'setter'
          ? `property ${primary.functionName} (set)`
          : `${primary.functionName}()`;

  let line = `${file} · ${fnLabel}`;
  if (primary.usageHint) line += ` · ${primary.usageHint}`;
  else if (primary.opcode !== 'default') line += ` · ${primary.opcode}`;
  if (primary.lineNumber != null && primary.lineNumber > 0) {
    line += ` · line ${primary.lineNumber}`;
  }

  const extraFunctions = [
    ...new Set(
      usages
        .slice(1)
        .map((usage) => usage.functionName)
        .filter((name) => name && name !== primary.functionName),
    ),
  ];
  if (extraFunctions.length > 0) {
    line += ` · also ${extraFunctions.join(', ')}`;
  }

  return line;
};

/**
 * Replace string-table entries in a compiled Papyrus script with translated text.
 *
 * Only entries present in `overlay` are rewritten; identifiers and unmapped
 * literals are preserved verbatim. Bytecode after the string table is copied
 * unchanged, so string indices remain valid.
 *
 * @param input - Original `.pex` file contents.
 * @param overlay - `source text → export text` replacements for this script.
 * @returns Patched `.pex` buffer (identical to input when overlay is empty).
 */
export const patchPexBuffer = (input: Buffer, overlay: Map<string, string>): Buffer => {
  if (overlay.size === 0) return input;

  if (input.length < 16) {
    throw new Error(`PEX: file too small (${input.length} bytes)`);
  }

  const endian = detectPexEndian(input);

  let offset = 16;
  const { nextOffset: o1 } = readWString(input, offset, endian);
  offset = o1;
  const { nextOffset: o2 } = readWString(input, offset, endian);
  offset = o2;
  const { nextOffset: o3 } = readWString(input, offset, endian);
  offset = o3;

  const countOffset = offset;
  if (offset + 2 > input.length) {
    throw new Error('PEX: out of bounds reading string table count');
  }

  const count = readUInt16At(input, offset, endian);
  offset += 2;

  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value, nextOffset } = readWString(input, offset, endian);
    offset = nextOffset;
    strings.push(overlay.has(value) ? overlay.get(value)! : value);
  }

  const prefix = input.subarray(0, countOffset);
  const tail = input.subarray(offset);

  const countBuf = Buffer.alloc(2);
  writeUInt16(countBuf, strings.length, 0, endian);
  const tableParts: Buffer[] = [countBuf];
  for (const value of strings) {
    tableParts.push(writeWString(value, endian));
  }

  return Buffer.concat([prefix, ...tableParts, tail]);
};
