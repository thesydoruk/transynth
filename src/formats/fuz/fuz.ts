import fs from 'node:fs';

const FUZE_MAGIC = Buffer.from('FUZE', 'ascii');
const HEADER_SIZE = 12;

export type FuzParts = {
  lip: Buffer;
  xwm: Buffer;
};

/** Read a Bethesda FUZE container (`lip` + `xwm`). */
export const readFuz = (data: Buffer): FuzParts => {
  if (data.length < HEADER_SIZE) {
    throw new Error('FUZ file is too small');
  }
  if (!data.subarray(0, 4).equals(FUZE_MAGIC)) {
    throw new Error('Invalid FUZ magic (expected FUZE)');
  }

  const lipSize = data.readUInt32LE(8);
  const lipEnd = HEADER_SIZE + lipSize;
  if (lipEnd > data.length) {
    throw new Error(`Invalid FUZ lip size: ${lipSize}`);
  }

  return {
    lip: data.subarray(HEADER_SIZE, lipEnd),
    xwm: data.subarray(lipEnd),
  };
};

/** Pack freshly generated `lip` and `xwm` into a FUZE file (never reuse old lip data). */
export const writeFuz = (lip: Buffer, xwm: Buffer): Buffer => {
  const header = Buffer.alloc(HEADER_SIZE);
  FUZE_MAGIC.copy(header, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(lip.length, 8);
  return Buffer.concat([header, lip, xwm]);
};

export const readFuzFile = (filePath: string): FuzParts => readFuz(fs.readFileSync(filePath));

export const extractXwmFromFuzFile = (filePath: string): Buffer => readFuzFile(filePath).xwm;
