/**
 * Minimal TES4 header reader.
 *
 * {@link EspReader} buffers the whole plugin for random access, which costs
 * hundreds of megabytes on masters like Fallout4.esm. Master lookup only needs
 * the MAST subrecords of the leading TES4 record, so read just that.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EspRecordLayout, PluginKind } from './recordLayout';

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

/** The TES4 record header flags and the `MAST` names of one plugin file. */
export const readPluginHeader = (pluginPath: string): { flags: number; masters: string[] } => {
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
    return { flags: header.readUInt32LE(8), masters: parseTes4MasterNames(data, read) };
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * Master plugin names from the TES4 header, in plugin load order.
 *
 * @throws Error if the file does not start with a TES4 record.
 */
export const readPluginMasterNames = (pluginPath: string): string[] =>
  readPluginHeader(pluginPath).masters;

/**
 * Size class of a plugin from its TES4 flags; the small flag wins, as in the
 * engine. Where the title has small plugins, an `.esl` file name makes one too.
 */
export const pluginKindFromFlags = (
  flags: number,
  plugin: EspRecordLayout['plugin'],
  fileName = '',
): PluginKind => {
  if (plugin.smallFlag !== 0) {
    if ((flags & plugin.smallFlag) !== 0 || /\.esl$/i.test(fileName)) return 'small';
  }
  if (plugin.mediumFlag !== 0 && (flags & plugin.mediumFlag) !== 0) return 'medium';
  return 'full';
};

/**
 * Kind of each master of a plugin, read from the master's own header beside
 * it. A master that is not there (or not readable) is null — except an `.esl`
 * file, which the title's layout makes small by name alone. A title without
 * small or medium plugins never reads a header: every master is `full`.
 */
export const readMasterKinds = (
  pluginPath: string,
  masters: readonly string[],
  plugin: EspRecordLayout['plugin'],
): Array<PluginKind | null> => {
  if (plugin.smallFlag === 0 && plugin.mediumFlag === 0) return masters.map(() => 'full');
  const dir = path.dirname(pluginPath);
  return masters.map((name) => {
    try {
      return pluginKindFromFlags(readPluginHeader(path.join(dir, name)).flags, plugin, name);
    } catch {
      return /\.esl$/i.test(name) ? pluginKindFromFlags(0, plugin, name) : null;
    }
  });
};

/**
 * Which `MAST` entry a FormID stored in a plugin points into.
 *
 * `plain` (Fallout 4 and older): the top byte is the index into `MAST`.
 *
 * `byKind` (Starfield, after xEdit's `GetMasterIndexForFileID`): masters are
 * numbered per kind, in `MAST` order —
 *   - `FE` + bits 12–23: the n-th *small* master (object id in the low 12 bits);
 *   - `FD` + bits 16–23: the n-th *medium* master (object id in the low 16 bits);
 *   - any other top byte: the n-th *full* master.
 * A slot one past the last master of that kind is the plugin's own record.
 *
 * @param masterKinds - Kind of each `MAST` entry, read from the master's own
 *   header; ignored for `plain`.
 * @returns Index into the `MAST` list, or -1 for the plugin's own record.
 */
export const formIdMasterIndex = (
  formId: number,
  masterKinds: readonly PluginKind[],
  slots: EspRecordLayout['plugin']['formIdMasterSlots'],
): number => {
  const top = formId >>> 24;
  if (slots === 'plain') return top < masterKinds.length ? top : -1;

  let kind: PluginKind = 'full';
  let slot = top;
  if (top === 0xfe) {
    kind = 'small';
    slot = (formId >>> 12) & 0xfff;
  } else if (top === 0xfd) {
    kind = 'medium';
    slot = (formId >>> 16) & 0xff;
  }

  let seen = -1;
  for (const [index, masterKind] of masterKinds.entries()) {
    if (masterKind !== kind) continue;
    seen += 1;
    if (seen === slot) return index;
  }
  return -1;
};
