/**
 * The archive that holds an official plugin's string tables, when none of the
 * archives its unit already carries does.
 *
 * A unit carries the plugin's archives of the usual roles (`- Main`,
 * `- Localization`, `- Interface`, `- Voices`). Starfield keeps some tables
 * elsewhere: Shattered Space in a numbered `ShatteredSpace - Main02.ba2`, and
 * `BlueprintShips-SFBGS050.esm` in the archive of the master it extends
 * (`SFBGS050 - Main.ba2`). Without that archive the server imports a localized
 * plugin with no tables at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ba2Reader, isBa2GnrArchive } from '../formats/ba2';
import { readPluginHeader } from '../formats/esp/pluginHeader';
import { parsePluginStringsFileName } from '../formats/strings/stringsFileName';

const TES4_LOCALIZED = 0x80;
const TABLE_EXTENSIONS = ['strings', 'dlstrings', 'ilstrings'] as const;
/** Roles of an archive that can hold string tables: Main (numbered too), Localization, Interface. */
const TABLE_ROLE_RE = /^(main\d*|localization|interface.*)$/;

const archiveRole = (fileName: string): string | null =>
  fileName.toLowerCase().match(/ - ([^.]+)\.ba2$/)?.[1] ?? null;

/** True when the BA2 lists a `<stem>_<locale>.*strings` table. Unreadable archives hold none. */
const holdsPluginTables = (archivePath: string, pluginStem: string): boolean => {
  try {
    if (!isBa2GnrArchive(archivePath)) return false;
    const reader = new Ba2Reader(archivePath);
    try {
      return TABLE_EXTENSIONS.some((ext) =>
        reader.listByExt(ext).some((entry) => {
          const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? entry.name;
          return parsePluginStringsFileName(base, pluginStem) != null;
        }),
      );
    } finally {
      reader.close();
    }
  } catch {
    return false;
  }
};

const hasLooseTables = (dataDir: string, pluginStem: string): boolean => {
  try {
    return fs
      .readdirSync(path.join(dataDir, 'Strings'))
      .some((name) => parsePluginStringsFileName(name, pluginStem) != null);
  } catch {
    return false;
  }
};

/** `<stem> - <role>.ba2` files of one plugin whose role can hold tables, by name. */
const tableArchivesOf = (dataEntries: readonly string[], pluginStem: string): string[] => {
  const prefix = `${pluginStem.toLowerCase()} - `;
  return dataEntries
    .filter((name) => {
      const lower = name.toLowerCase();
      const role = archiveRole(lower);
      return lower.startsWith(prefix) && role != null && TABLE_ROLE_RE.test(role);
    })
    .sort((a, b) => a.localeCompare(b, 'en'));
};

/**
 * File name (in `dataDir`) of the archive to add to the plugin's unit, or null:
 * the plugin is not localized, its tables are loose or in an archive the unit
 * carries already, or no archive has them.
 *
 * @param carried - File names the unit already lists.
 */
export const findMissingStringsArchive = (
  dataDir: string,
  pluginFileName: string,
  dataEntries: readonly string[],
  carried: readonly string[],
): string | null => {
  const pluginPath = path.join(dataDir, pluginFileName);
  let header: { flags: number; masters: string[] };
  try {
    header = readPluginHeader(pluginPath);
  } catch {
    return null;
  }
  if ((header.flags & TES4_LOCALIZED) === 0) return null;

  const stem = path.basename(pluginFileName, path.extname(pluginFileName));
  if (hasLooseTables(dataDir, stem)) return null;

  const carriedLower = new Set(carried.map((name) => name.toLowerCase()));
  const carriedArchives = carried.filter((name) => {
    const role = archiveRole(name);
    return role != null && TABLE_ROLE_RE.test(role);
  });
  if (carriedArchives.some((name) => holdsPluginTables(path.join(dataDir, name), stem))) {
    return null;
  }

  // The plugin's own numbered archives first, then its masters', nearest master first.
  const owners = [
    stem,
    ...[...header.masters].reverse().map((m) => path.basename(m, path.extname(m))),
  ];
  for (const owner of owners) {
    for (const name of tableArchivesOf(dataEntries, owner)) {
      if (carriedLower.has(name.toLowerCase())) continue;
      if (holdsPluginTables(path.join(dataDir, name), stem)) return name;
    }
  }
  return null;
};
