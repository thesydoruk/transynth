import fs from 'node:fs';
import path from 'node:path';
import { EspReader } from '../../../formats/esp';
import { parseStringsBuffer } from '../../../formats/strings';
import type { Tx } from '../../../db';
import { upsertMod } from '../../../db';
import { log } from '../../../logger';
import type { GameType } from '../../../types';
import { CONFIG } from '../../../config';
import { bulkInsertModImportRows, type ModImportBulkRow } from '../modImportBulk';
import { withModImportWriteLock } from '../modImportLocks';
import { deleteModData } from '../../data/queries';
import { buildLstringEspIndex } from './espIndex';
import { buildStringsPackModName, buildStringsPackRows, computeStringsPackHash } from './packRows';
import { resolvePluginPathForStem } from './pluginDiscovery';
import type {
  StringsPackCandidate,
  StringsPackImportOptions,
  StringsPackImportResult,
} from './types';

const countExistingRecords = async (db: Tx, modId: number): Promise<number> => {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM records WHERE mod_id = $1',
    [modId],
  );
  return Number(rows[0]?.count ?? 0);
};

/**
 * Import one stem group into the database.
 *
 * Requires the matching plugin on disk or in previously imported mods so rows
 * can be enriched with FormID / EDID / subrecord paths.
 */
export const importStringsPack = async (
  db: Tx,
  pack: StringsPackCandidate,
  game: GameType = 'fo4',
  options: StringsPackImportOptions = {},
): Promise<StringsPackImportResult> => {
  const force = options.force ?? false;
  const searchDirs = [
    ...(options.pluginSearchDirs ?? []),
    pack.packRoot,
    path.dirname(pack.stringsDir),
  ].filter((dir, index, all) => dir && all.indexOf(path.resolve(dir)) === index);

  const pluginPath = await resolvePluginPathForStem(pack.stem, game, searchDirs, db);
  if (!pluginPath) {
    throw new Error(
      `Plugin "${pack.stem}" not found for strings enrichment. ` +
        `Import the .esp/.esm first or pass --plugins-dir with game Data folder. ` +
        `Searched: ${searchDirs.join(', ')}`,
    );
  }

  const esp = new EspReader(pluginPath, game);
  if (!esp.info.isLocalized) {
    throw new Error(`Plugin "${pluginPath}" is not localized — strings tables are not used`);
  }

  const lstringIndex = buildLstringEspIndex(esp.extractStrings());
  const contentHash = await computeStringsPackHash(pack.files);
  const modName = buildStringsPackModName(pack.stem, contentHash);
  const locales = [...new Set(pack.files.map((f) => f.locale))].sort();
  const absPath = pluginPath;

  const { rows: existing } = await db.query<{ id: number }>(
    'SELECT id FROM mods WHERE name = $1 AND version_hash = $2',
    [modName, contentHash],
  );
  const existingModId = existing[0]?.id;

  if (existingModId != null && !force) {
    const recordCount = await countExistingRecords(db, existingModId);
    if (recordCount > 0) {
      return {
        modId: existingModId,
        modName,
        imported: recordCount,
        skipped: true,
        locales,
        stem: pack.stem,
        pluginPath,
        mappedEntries: recordCount,
        unmappedEntries: 0,
      };
    }
  }

  if (existingModId != null && force) {
    await deleteModData(db, existingModId, 'mod');
  }

  const modId = await upsertMod(db, modName, absPath, contentHash, game);
  const pending: ModImportBulkRow[] = [];
  let mappedEntries = 0;
  let unmappedEntries = 0;

  for (const file of pack.files) {
    const buf = fs.readFileSync(file.filePath);
    const entries = parseStringsBuffer(buf, file.type);
    const { rows, mapped, unmapped } = buildStringsPackRows(file, entries, lstringIndex);
    mappedEntries += mapped;
    unmappedEntries += unmapped;
    for (const csvRow of rows) {
      pending.push({
        csvRow,
        locale: file.locale,
        context: null,
        sourceKind: 'strings-pack',
      });
    }
  }

  if (pending.length === 0) {
    throw new Error(
      `No strings from "${pack.stem}" matched plugin records in "${path.basename(pluginPath)}". ` +
        `${unmappedEntries} lstring id(s) had no ESP references.`,
    );
  }

  const importBatchSize = CONFIG.dbChunkSize;
  let imported = 0;
  await withModImportWriteLock(db, async () => {
    for (let i = 0; i < pending.length; i += importBatchSize) {
      const batch = pending.slice(i, i + importBatchSize);
      const results = await bulkInsertModImportRows(db, modId, batch);
      imported += results.length;
      if (imported > 0 && imported % 5000 === 0) {
        log.info(`  strings pack "${modName}": ${imported}/${pending.length}`);
      }
    }
  });

  if (unmappedEntries > 0) {
    log.warn(
      `[strings-pack ${pack.stem}] ${unmappedEntries} lstring id(s) in files had no matching ESP references and were skipped`,
    );
  }

  return {
    modId,
    modName,
    imported,
    skipped: false,
    locales,
    stem: pack.stem,
    pluginPath,
    mappedEntries,
    unmappedEntries,
  };
};
