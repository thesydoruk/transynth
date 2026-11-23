/**
 * `DefineFontAlignZones` (tag 73): per-glyph hinting zones of a `DefineFont3`.
 *
 * The table holds one zone record per glyph, in font order, so a glyph added to the
 * font needs a record at the same index or every later glyph is hinted with its
 * neighbour's zones. Scaleform's `.gfx` export drops the tag altogether.
 *
 * Body: FontID, a CSM hint byte, then per glyph `NumZoneData` (UI8), that many
 * `{ alignment, range }` FLOAT16 pairs, and a byte of X/Y mask flags.
 */

export const TAG_DEFINE_FONT_ALIGN_ZONES = 73;

export type AlignZones = {
  fontId: number;
  /** CSM table hint and reserved bits, verbatim. */
  hint: number;
  /** One raw zone record per glyph. */
  records: Buffer[];
};

/**
 * Decode an align-zones tag body.
 *
 * @returns The table, or `null` when it is truncated.
 */
export const parseAlignZones = (body: Buffer): AlignZones | null => {
  if (body.length < 3) return null;
  const records: Buffer[] = [];
  let pos = 3;
  while (pos < body.length) {
    const size = 1 + body[pos]! * 4 + 1;
    if (pos + size > body.length) return null;
    records.push(Buffer.from(body.subarray(pos, pos + size)));
    pos += size;
  }
  return { fontId: body.readUInt16LE(0), hint: body[2]!, records };
};

export const writeAlignZones = (zones: AlignZones): Buffer => {
  const head = Buffer.alloc(3);
  head.writeUInt16LE(zones.fontId, 0);
  head.writeUInt8(zones.hint, 2);
  return Buffer.concat([head, ...zones.records]);
};

/** A record with no zones in either direction: the glyph is drawn unhinted. */
export const EMPTY_ZONE_RECORD = Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x00]);
