/**
 * Synthetic ESP-ESM Translator (.eet) files, written to the layout documented
 * in `src/formats/eet/eetParser.ts`. Real EET samples are not in the repo, so
 * this is what lets the parser and the EET import be tested anywhere.
 */

export type EetFixtureRecord = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  /** `0x63` ('c') confirmed, `0xff` untranslated. */
  status?: number;
};

const u32 = (value: number): Buffer => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
};

const str = (text: string): Buffer => {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
};

/** The fixed tail after the six strings; the reader needs only the status byte. */
const tail = (record: EetFixtureRecord): Buffer =>
  Buffer.concat([
    str(record.target), // stripped target
    u32(0), // edit count
    Buffer.from([record.status ?? 0xff, 0]), // status, pad
    u32(0), // unk1
    u32(0), // unk2
    u32(0), // source hash
    str(record.source), // stripped source
    u32(0), // source hash 2
    u32(0xffffffff), // end marker
  ]);

const recordBytes = (record: EetFixtureRecord): Buffer => {
  const body = Buffer.concat([
    str(record.signature),
    str(record.formId),
    str(record.edid),
    str(record.field),
    str(record.source),
    str(record.target),
    tail(record),
  ]);
  return Buffer.concat([u32(body.length), body]);
};

/**
 * An EET file. Version 1 leaves the record count out of the header (the
 * importer counts records itself); version 2 declares it.
 */
export const buildEet = (
  records: EetFixtureRecord[],
  opts: { version?: 1 | 2; gameName?: string } = {},
): Buffer => {
  const version = opts.version ?? 2;
  const gameName = Buffer.from(opts.gameName ?? 'Fallout 4', 'utf8');
  const gameNameLen = Buffer.alloc(2);
  gameNameLen.writeUInt16LE(gameName.length, 0);
  const header = Buffer.concat([
    Buffer.from('EET_', 'ascii'),
    u32(version),
    u32(0),
    Buffer.from('GAME', 'ascii'),
    gameNameLen,
    gameName,
    Buffer.from('LINE', 'ascii'),
    version === 1 ? Buffer.from([0x3d, 0, 0, 0]) : u32(records.length),
  ]);
  return Buffer.concat([header, ...records.map(recordBytes)]);
};
