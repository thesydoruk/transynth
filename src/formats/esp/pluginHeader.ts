/**
 * Minimal TES4 header reader.
 *
 * {@link EspReader} buffers the whole plugin for random access, which costs
 * hundreds of megabytes on masters like Fallout4.esm. Master lookup only needs
 * the MAST subrecords of the leading TES4 record, so read just that.
 */
import fs from 'node:fs';

const RECORD_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;

/**
 * `MAST` names from the data of a TES4 record (the bytes after its 24-byte
 * header), in the order the plugin lists them — the index of each name is the
 * master-index byte its FormIDs carry.
 */
export const parseTes4MasterNames = (data: Buffer, length = data.length): string[] => {
  const masters: string[] = [];
  let pos = 0;
  while (pos + SUBRECORD_HEADER_SIZE <= length) {
    const sig = data.toString('ascii', pos, pos + 4);
    const size = data.readUInt16LE(pos + 4);
    const start = pos + SUBRECORD_HEADER_SIZE;
    if (sig === 'MAST') {
      masters.push(data.toString('utf8', start, Math.min(start + size, length)).replace(/\0/g, ''));
    }
    pos = start + size;
  }
  return masters;
};

/**
 * Master plugin names from the TES4 header, in plugin load order.
 *
 * @throws Error if the file does not start with a TES4 record.
 */
export const readPluginMasterNames = (pluginPath: string): string[] => {
  const fd = fs.openSync(pluginPath, 'r');
  try {
    const header = Buffer.alloc(RECORD_HEADER_SIZE);
    if (fs.readSync(fd, header, 0, RECORD_HEADER_SIZE, 0) < RECORD_HEADER_SIZE) {
      throw new Error(`ESP: ${pluginPath} is too small for a TES4 header`);
    }
    if (header.toString('ascii', 0, 4) !== 'TES4') {
      throw new Error(`ESP: expected TES4 in ${pluginPath}`);
    }

    const dataSize = header.readUInt32LE(4);
    const data = Buffer.alloc(dataSize);
    const read = fs.readSync(fd, data, 0, dataSize, RECORD_HEADER_SIZE);
    return parseTes4MasterNames(data, read);
  } finally {
    fs.closeSync(fd);
  }
};
