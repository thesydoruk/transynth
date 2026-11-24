/**
 * Byte builders for synthetic plugins in tests: a TES4 header, records, GRUPs
 * and subrecords laid out exactly as a Creation Engine plugin stores them.
 */

/** One subrecord: 4-char signature, uint16 size, payload. */
export const sub = (sig: string, payload: Buffer = Buffer.alloc(0)): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

export const zstring = (sig: string, text: string): Buffer =>
  sub(sig, Buffer.from(`${text}\0`, 'utf8'));

export const u8 = (sig: string, value: number): Buffer => sub(sig, Buffer.from([value & 0xff]));

export const u16 = (sig: string, value: number): Buffer => {
  const data = Buffer.alloc(2);
  data.writeUInt16LE(value, 0);
  return sub(sig, data);
};

export const u32 = (sig: string, value: number): Buffer => {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(value >>> 0, 0);
  return sub(sig, data);
};

export const i32 = (sig: string, value: number): Buffer => {
  const data = Buffer.alloc(4);
  data.writeInt32LE(value, 0);
  return sub(sig, data);
};

export const f32 = (sig: string, value: number): Buffer => {
  const data = Buffer.alloc(4);
  data.writeFloatLE(value, 0);
  return sub(sig, data);
};

/** An array of uint32 values, e.g. a DIAL `TIFL` INFO list. */
export const u32Array = (sig: string, values: number[]): Buffer => {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => data.writeUInt32LE(value >>> 0, i * 4));
  return sub(sig, data);
};

/** A byte struct, e.g. ACBS, built from little-endian fields. */
export const struct = (sig: string, size: number, write: (data: Buffer) => void): Buffer => {
  const data = Buffer.alloc(size);
  write(data);
  return sub(sig, data);
};

/** A Starfield base-form component: `BFCB` type name, its fields, `BFCE`. */
export const component = (type: string, fields: Buffer[]): Buffer[] => [
  zstring('BFCB', type),
  ...fields,
  sub('BFCE'),
];

export const record = (sig: string, formId: number, subrecords: Buffer[], flags = 0): Buffer => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(flags >>> 0, 8);
  header.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([header, data]);
};

/** A GRUP; `label` is a record type for top-level groups or a parent FormID. */
export const grup = (label: string | number, groupType: number, children: Buffer[]): Buffer => {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(24);
  header.write('GRUP', 0, 4, 'ascii');
  header.writeUInt32LE(24 + body.length, 4);
  if (typeof label === 'string') header.write(label, 8, 4, 'ascii');
  else header.writeUInt32LE(label >>> 0, 8);
  header.writeInt32LE(groupType, 12);
  return Buffer.concat([header, body]);
};

/** A plugin: TES4 with `flags` and the given `MAST` names, then the records. */
export const plugin = (records: Buffer[], flags = 0, masters: string[] = []): Buffer => {
  const tes4 = record(
    'TES4',
    0,
    masters.flatMap((name) => [zstring('MAST', name), sub('DATA', Buffer.alloc(8))]),
    flags,
  );
  return Buffer.concat([tes4, ...records]);
};
