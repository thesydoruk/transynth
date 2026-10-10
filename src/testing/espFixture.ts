/**
 * Minimal Bethesda plugins for tests: a TES4 header and flat records, which
 * `EspReader` reads the same way as a real plugin's.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A zero-terminated string subrecord, e.g. `zstring('FULL', 'Sturges')`. */
const zstring = (sig: string, text: string): Buffer => {
  const payload = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const buildRecord = (sig: string, formId: number, subrecords: Buffer[]): Buffer => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, data]);
};

/** A plugin of the given records; `localized` sets the TES4 flag for string tables. */
const buildPlugin = (records: Buffer[], localized = false): Buffer => {
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  if (localized) tes4.writeUInt32LE(0x80, 8);
  return Buffer.concat([tes4, ...records]);
};

/** One named NPC per name, FormIDs counting up from 0x800. */
export const npcPlugin = (names: string[], localized = false): Buffer =>
  buildPlugin(
    names.map((name, i) =>
      buildRecord('NPC_', 0x800 + i, [zstring('EDID', `Npc${i}`), zstring('FULL', name)]),
    ),
    localized,
  );

/**
 * A fresh directory for one test's mod files, two levels below the system temp
 * dir: import code looks one level above a plugin for archives, and the temp
 * dir itself can hold thousands of unrelated files.
 */
export const makeModDir = (): { root: string; modDir: string; cleanup: () => void } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-test-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(modDir);
  return { root, modDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
};
