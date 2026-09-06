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

export type FuzLipPeek = {
  lipBytes: number;
  /** First uint32 of the embedded `.lip`, or null if the lip is shorter than 4 bytes. */
  lipVersion: number | null;
};

/**
 * Embedded `.lip` size + FaceFX version from the first 16 bytes of a FUZE file.
 * Used to rank corpus quality without loading the XWM.
 */
export const readFuzLipPeek = (filePath: string): FuzLipPeek => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_SIZE + 4);
    const read = fs.readSync(fd, header, 0, HEADER_SIZE + 4, 0);
    if (read < HEADER_SIZE) {
      throw new Error(`FUZ header truncated: ${filePath}`);
    }
    if (!header.subarray(0, 4).equals(FUZE_MAGIC)) {
      throw new Error('Invalid FUZ magic (expected FUZE)');
    }
    const lipBytes = header.readUInt32LE(8);
    return {
      lipBytes,
      lipVersion:
        lipBytes >= 4 && read >= HEADER_SIZE + 4 ? header.readUInt32LE(HEADER_SIZE) : null,
    };
  } finally {
    fs.closeSync(fd);
  }
};

export const readFuzLipSize = (filePath: string): number => readFuzLipPeek(filePath).lipBytes;
