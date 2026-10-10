/**
 * The `.w3strings` string-table format (REDengine 3), read and written.
 *
 * Little-endian throughout:
 *
 * ```
 * "RTSW"  u32 version  u16 key1
 * VLQ n1, n1 × { u32 id^magic, u32 offset, u32 length }   sorted by stored id
 * VLQ n2, n2 × { u32 keyHash,  u32 id^magic }             sorted by keyHash
 * VLQ n3, n3 units of string data (each string + one zero unit)
 * u16 key2                                                 last two bytes
 * ```
 *
 * A unit is a UTF-16 code unit up to version 163 and a UTF-8 byte from 164,
 * the Remastered edition (2026). `offset` and `length` count units; `length`
 * leaves out the terminator. `key1 << 16 | key2` is the language key, which a
 * fixed table maps to the `magic` that ids are XOR-ed with and that seeds the
 * text obfuscation. Languages added late (and every Remastered `ua` table)
 * use key 0 — cleartext — so a table's language comes from its file name, not
 * from the key.
 *
 * The game binary-searches both index blocks, so their sort order matters: a
 * misordered table loads and then shows the player `##key` instead of text.
 *
 * Checked against tables written by rmemr's `w3strings.exe` encoder (the
 * fixtures in SpontanCombust/w3stringsx). Version 164 follows two independent
 * community tools that agree with each other, and is the part to confirm on
 * real game files first.
 */

export type W3StringsEntry = {
  id: number;
  /** Hash of the string's lowercased key name, or 0 for a string with no key. */
  keyHash: number;
  text: string;
};

export type W3StringsTable = {
  version: number;
  /** The language key stored in the file (`key1 << 16 | key2`). */
  langKey: number;
  /** In the order the strings sit in the data block — the order they were encoded in. */
  entries: W3StringsEntry[];
  /**
   * Key rows naming an id this table does not hold — a key for a string that
   * lives in another `content` folder. The game's own tables carry a few dozen
   * (69 in Remastered `content0/en`); they are kept so a rewrite loses none.
   */
  foreignKeys: W3ForeignKey[];
};

export type W3ForeignKey = { keyHash: number; id: number };

const MAGIC = 'RTSW';
/** First version whose string data is UTF-8 rather than UTF-16. */
export const W3STRINGS_UTF8_VERSION = 164;
/** What the pre-Remastered game and rmemr's encoder write. */
const W3STRINGS_UTF16_VERSION = 162;

/** File language code → [language key, magic]. Codes not listed are cleartext. */
const LANGUAGE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  pl: [0x83496237, 0x73946816],
  en: [0x43975139, 0x79321793],
  de: [0x75886138, 0x42791159],
  it: [0x45931894, 0x12375973],
  fr: [0x23863176, 0x75921975],
  cz: [0x24987354, 0x21793217],
  es: [0x18796651, 0x42387566],
  zh: [0x18632176, 0x16875467],
  ru: [0x63481486, 0x42386347],
  hu: [0x42378932, 0x67823218],
  jp: [0x54834893, 0x59825646],
};

/** Keys older tools wrote (1.0-era Russian, early Brazilian and Turkish). Read, never written. */
const LEGACY_KEY_MAGICS: ReadonlyArray<readonly [number, number]> = [
  [0x77932179, 0x54932186],
  [0x56328893, 0x43268768],
  [0x56432683, 0x21795135],
];

const MAGIC_BY_KEY = new Map<number, number>([
  [0, 0],
  ...Object.values(LANGUAGE_KEYS).map(([key, magic]) => [key, magic] as [number, number]),
  ...LEGACY_KEY_MAGICS.map(([key, magic]) => [key, magic] as [number, number]),
]);

/** The language key a table in `lang` is written with (0 for cleartext languages). */
const w3LanguageKey = (lang: string): number => LANGUAGE_KEYS[lang.toLowerCase()]?.[0] ?? 0;

/**
 * Hash of a string key name, as stored in the key block. The name is
 * lowercased first: `panel_Mods` is stored as the hash of `panel_mods`.
 */
export const w3KeyHash = (keyName: string): number => {
  let hash = 0;
  const lower = keyName.toLowerCase();
  for (let i = 0; i < lower.length; i++) hash = (Math.imul(hash, 31) + lower.charCodeAt(i)) >>> 0;
  return hash;
};

// ── Variable-length counts ────────────────────────────────────────────────

/**
 * The format's count encoding: the first byte carries 6 value bits, `0x40` for
 * "more follows" and `0x80` as a sign; each later byte carries 7 bits and
 * `0x80` for "more follows".
 */
export const readW3Vlq = (buf: Buffer, pos: number): { value: number; next: number } => {
  const first = buf.readUInt8(pos++);
  let value = first & 0x3f;
  if (first & 0x40) {
    let shift = 6;
    let byte: number;
    do {
      byte = buf.readUInt8(pos++);
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80 && shift < 27);
  }
  return { value: first & 0x80 && value !== 0 ? -value : value, next: pos };
};

/** Encode a non-negative count. Zero is written as `0x80`, as the game's own files do. */
export const writeW3Vlq = (value: number): Buffer => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid w3strings count: ${value}`);
  if (value === 0) return Buffer.from([0x80]);
  const bytes: number[] = [];
  let rest = value >>> 6;
  bytes.push((value & 0x3f) | (rest > 0 ? 0x40 : 0));
  while (rest > 0) {
    const group = rest & 0x7f;
    rest >>>= 7;
    bytes.push(group | (rest > 0 ? 0x80 : 0));
  }
  return Buffer.from(bytes);
};

// ── Text obfuscation (symmetric) ──────────────────────────────────────────

const xorUtf16 = (units: Uint16Array, magic: number): void => {
  let k = (magic >>> 8) & 0xffff;
  const len = units.length;
  for (let i = 0; i < len; i++) {
    units[i] = units[i]! ^ (Math.imul(len + 1, k) & 0xffff);
    k = ((k << 1) | (k >>> 15)) & 0xffff;
  }
};

const xorUtf8 = (bytes: Buffer, magic: number): void => {
  let k = (magic >>> 8) & 0xffff;
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    bytes[i] = bytes[i]! ^ (Math.imul(len + 1, k) & 0xff);
    k = ((k << 1) | (k >>> 15)) & 0xffff;
  }
};

const decodeText = (
  data: Buffer,
  unit: 1 | 2,
  offset: number,
  length: number,
  magic: number,
): string => {
  if (unit === 1) {
    const bytes = Buffer.from(data.subarray(offset, offset + length));
    xorUtf8(bytes, magic);
    return bytes.toString('utf8');
  }
  const units = new Uint16Array(length);
  for (let i = 0; i < length; i++) units[i] = data.readUInt16LE((offset + i) * 2);
  xorUtf16(units, magic);
  return Buffer.from(units.buffer, units.byteOffset, units.byteLength).toString('utf16le');
};

// ── Decode ────────────────────────────────────────────────────────────────

export const decodeW3Strings = (buf: Buffer): W3StringsTable => {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== MAGIC) {
    throw new Error('Not a .w3strings file (missing RTSW header)');
  }
  const version = buf.readUInt32LE(4);
  const key1 = buf.readUInt16LE(8);
  const key2 = buf.readUInt16LE(buf.length - 2);
  const langKey = ((key1 << 16) | key2) >>> 0;
  const magic = MAGIC_BY_KEY.get(langKey);
  if (magic === undefined) {
    throw new Error(`Unknown .w3strings language key 0x${langKey.toString(16).padStart(8, '0')}`);
  }

  let pos = 10;
  const n1 = readW3Vlq(buf, pos);
  pos = n1.next;
  const index: Array<{ id: number; offset: number; length: number }> = [];
  for (let i = 0; i < n1.value; i++, pos += 12) {
    index.push({
      id: (buf.readUInt32LE(pos) ^ magic) >>> 0,
      offset: buf.readUInt32LE(pos + 4),
      length: buf.readUInt32LE(pos + 8),
    });
  }

  const n2 = readW3Vlq(buf, pos);
  pos = n2.next;
  const indexedIds = new Set(index.map((row) => row.id));
  const keyHashById = new Map<number, number>();
  const foreignKeys: W3ForeignKey[] = [];
  for (let i = 0; i < n2.value; i++, pos += 8) {
    const keyHash = buf.readUInt32LE(pos);
    const id = (buf.readUInt32LE(pos + 4) ^ magic) >>> 0;
    if (indexedIds.has(id)) keyHashById.set(id, keyHash);
    else foreignKeys.push({ keyHash, id });
  }

  const n3 = readW3Vlq(buf, pos);
  pos = n3.next;
  // Some community tables declare 162/163 but carry UTF-8; the data block's
  // size against the end of the file says which unit it really is.
  const utf16Fits = pos + n3.value * 2 + 2 === buf.length;
  const utf8Fits = pos + n3.value + 2 === buf.length;
  const unit: 1 | 2 = version >= W3STRINGS_UTF8_VERSION || (!utf16Fits && utf8Fits) ? 1 : 2;
  if (pos + n3.value * unit + 2 > buf.length) {
    throw new Error('Truncated .w3strings file (string data runs past the end)');
  }
  const data = buf.subarray(pos, pos + n3.value * unit);

  const entries = index
    .sort((a, b) => a.offset - b.offset)
    .map(({ id, offset, length }) => ({
      id,
      keyHash: keyHashById.get(id) ?? 0,
      text: decodeText(data, unit, offset, length, magic),
    }));

  return { version, langKey, entries, foreignKeys };
};

// ── Encode ────────────────────────────────────────────────────────────────

export type EncodeW3StringsOptions = {
  /**
   * Format version. Use the source table's own: the Remastered game no longer
   * loads UTF-16 tables, and the older game cannot read UTF-8 ones.
   */
  version?: number;
  /** Key rows for ids held elsewhere, carried over from the decoded source. */
  foreignKeys?: readonly W3ForeignKey[];
};

/** Write a table for `lang`, the game's file code (`en`, `ua`, …). */
export const encodeW3Strings = (
  entries: readonly W3StringsEntry[],
  lang: string,
  options: EncodeW3StringsOptions = {},
): Buffer => {
  const version = options.version ?? W3STRINGS_UTF16_VERSION;
  const langKey = w3LanguageKey(lang);
  const magic = MAGIC_BY_KEY.get(langKey)!;
  const unit: 1 | 2 = version >= W3STRINGS_UTF8_VERSION ? 1 : 2;

  const chunks: Buffer[] = [];
  const index: Array<{ stored: number; offset: number; length: number }> = [];
  const keys: Array<{ keyHash: number; stored: number }> = [];
  let units = 0;
  for (const entry of entries) {
    const stored = (entry.id ^ magic) >>> 0;
    let encoded: Buffer;
    let length: number;
    if (unit === 1) {
      encoded = Buffer.from(entry.text, 'utf8');
      length = encoded.length;
      xorUtf8(encoded, magic);
      chunks.push(encoded, Buffer.alloc(1));
    } else {
      const raw = Buffer.from(entry.text, 'utf16le');
      const codeUnits = new Uint16Array(raw.length / 2);
      for (let i = 0; i < codeUnits.length; i++) codeUnits[i] = raw.readUInt16LE(i * 2);
      xorUtf16(codeUnits, magic);
      length = codeUnits.length;
      encoded = Buffer.from(codeUnits.buffer, codeUnits.byteOffset, codeUnits.byteLength);
      chunks.push(encoded, Buffer.alloc(2));
    }
    index.push({ stored, offset: units, length });
    if (entry.keyHash !== 0) keys.push({ keyHash: entry.keyHash >>> 0, stored });
    units += length + 1;
  }

  for (const { keyHash, id } of options.foreignKeys ?? []) {
    keys.push({ keyHash: keyHash >>> 0, stored: (id ^ magic) >>> 0 });
  }

  index.sort((a, b) => a.stored - b.stored);
  keys.sort((a, b) => a.keyHash - b.keyHash);

  const header = Buffer.alloc(10);
  header.write(MAGIC, 0, 'latin1');
  header.writeUInt32LE(version, 4);
  header.writeUInt16LE(langKey >>> 16, 8);

  const indexBlock = Buffer.alloc(index.length * 12);
  index.forEach(({ stored, offset, length }, i) => {
    indexBlock.writeUInt32LE(stored, i * 12);
    indexBlock.writeUInt32LE(offset, i * 12 + 4);
    indexBlock.writeUInt32LE(length, i * 12 + 8);
  });

  const keyBlock = Buffer.alloc(keys.length * 8);
  keys.forEach(({ keyHash, stored }, i) => {
    keyBlock.writeUInt32LE(keyHash, i * 8);
    keyBlock.writeUInt32LE(stored, i * 8 + 4);
  });

  const footer = Buffer.alloc(2);
  footer.writeUInt16LE(langKey & 0xffff, 0);

  return Buffer.concat([
    header,
    writeW3Vlq(index.length),
    indexBlock,
    writeW3Vlq(keys.length),
    keyBlock,
    writeW3Vlq(units),
    ...chunks,
    footer,
  ]);
};
