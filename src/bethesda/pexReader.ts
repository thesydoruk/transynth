/**
 * pexReader.ts
 *
 * Parser for compiled Papyrus script files (.pex) used in Bethesda games
 * (Skyrim, Skyrim SE, Fallout 4, etc.).
 *
 * PEX format reference:
 *   https://en.uesp.net/wiki/Skyrim_Mod:Compiled_Script_File_Format
 *
 * Binary layout (all integers are big-endian throughout the PEX format):
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
 *   uint16 (BE) as the byte-length prefix, then that many UTF-8 bytes.
 *   No null terminator.
 *
 * Key insight for string extraction:
 *   The string table is a flat list of ALL strings referenced anywhere in the
 *   script — class names, function names, type names, AND inline string
 *   literals.  Identifiers and type names never contain whitespace or
 *   sentence-level punctuation, so those characters act as a reliable proxy
 *   for user-visible text that might need localisation.
 */

/** Magic number at offset 0 of every valid PEX file — big-endian. */
const PEX_MAGIC = 0xfa57c0de;

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
}

// ── Internal parser helpers ─────────────────────────────────────────────────

/**
 * Read a PEX wstring (uint16 BE length prefix + UTF-8 body) at the given offset.
 * Returns the decoded string and the offset immediately after it.
 *
 * @param buf    - Buffer containing PEX data
 * @param offset - Byte offset of the uint16 length field
 * @throws Error if the buffer is too short
 */
const readWString = (buf: Buffer, offset: number): { value: string; nextOffset: number } => {
  if (offset + 2 > buf.length) {
    throw new Error(`PEX: out of bounds reading wstring length at offset ${offset}`);
  }

  const len = buf.readUInt16BE(offset);
  offset += 2;

  if (offset + len > buf.length) {
    throw new Error(`PEX: out of bounds reading wstring data at offset ${offset} (len=${len})`);
  }

  const value = buf.toString('utf8', offset, offset + len);
  return { value, nextOffset: offset + len };
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
  // ── Validate minimum size and magic ──────────────────────────────────────
  if (buf.length < 16) {
    throw new Error(`PEX: file too small (${buf.length} bytes)`);
  }

  const magic = buf.readUInt32BE(0);
  if (magic !== PEX_MAGIC) {
    throw new Error(`PEX: invalid magic 0x${magic.toString(16).toUpperCase().padStart(8, '0')} (expected 0xFA57C0DE)`);
  }

  // ── Fixed-size header fields ─────────────────────────────────────────────
  const majorVersion = buf.readUInt8(4);
  const minorVersion = buf.readUInt8(5);
  const gameId = buf.readUInt16BE(6);
  // compilationTime occupies bytes 8–15 (uint64 BE) — skip it
  let offset = 16;

  // ── Variable-length header wstrings ──────────────────────────────────────
  // Read sourceFileName — we keep this for identification
  const { value: sourceFile, nextOffset: o1 } = readWString(buf, offset);
  offset = o1;

  // Skip username and machinename — not relevant for string extraction
  const { nextOffset: o2 } = readWString(buf, offset);
  offset = o2;

  const { nextOffset: o3 } = readWString(buf, offset);
  offset = o3;

  // ── String table ─────────────────────────────────────────────────────────
  if (offset + 2 > buf.length) {
    throw new Error('PEX: out of bounds reading string table count');
  }

  const count = buf.readUInt16BE(offset);
  offset += 2;

  const strings: string[] = [];

  for (let i = 0; i < count; i++) {
    const { value, nextOffset } = readWString(buf, offset);
    offset = nextOffset;

    // Apply heuristic — skip identifiers, type names, and empty strings
    if (isLikelyUserText(value)) {
      strings.push(value);
    }
  }

  return {
    info: {
      sourceFile,
      gameId,
      version: `${majorVersion}.${minorVersion}`,
    },
    strings,
  };
};
