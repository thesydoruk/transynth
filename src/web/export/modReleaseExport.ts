import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { exportGameArchives } from './exportArchives';
import { exportLocalizedStringsFiles } from './exportLocalizedStrings';
import { exportPatchedEsp } from './exportEsp';
import { exportPatchedPexFiles } from './exportPex';
import { collectLocalizedVoiceFiles } from './exportVoiceFiles';
import type {
  ExportedStringsFile,
  ModExportTarget,
  ModReleaseExportOptions,
  ModReleaseExportResult,
} from './exportTypes';

const writeExportedFile = (outDir: string, file: ExportedStringsFile, written: string[]): void => {
  const relPath = file.fileName.replace(/\\/g, '/');
  const dest = path.join(outDir, relPath);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(file.contentBase64, 'base64'));
  written.push(relPath);
};

const writeLooseStringsFiles = (
  outDir: string,
  files: ExportedStringsFile[],
  written: string[],
): void => {
  const stringsDir = path.join(outDir, 'Strings');
  ensureDir(stringsDir);
  for (const file of files) {
    const dest = path.join(stringsDir, file.fileName);
    fs.writeFileSync(dest, Buffer.from(file.contentBase64, 'base64'));
    written.push(path.join('Strings', file.fileName).replace(/\\/g, '/'));
  }
};

const exportErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * List mods eligible for bulk export (completed import, plugin path on disk).
 */
export const listModExportTargets = async (
  db: Tx,
  opts: { modIds?: number[]; game?: GameType } = {},
): Promise<ModExportTarget[]> => {
  const params: unknown[] = [];
  const filters: string[] = [
    `m.abs_path IS NOT NULL`,
    `mi.status = 'completed'`,
    `mi.mod_id IS NOT NULL`,
  ];

  if (opts.modIds?.length) {
    params.push(opts.modIds);
    filters.push(`m.id = ANY($${params.length}::int[])`);
  }
  if (opts.game) {
    params.push(opts.game);
    filters.push(`COALESCE(m.game, mi.game, 'fo4') = $${params.length}`);
  }

  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    abs_path: string;
    src_lang: string | null;
    game: string | null;
    is_localized: number | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        m.abs_path,
        mi.src_lang,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.is_localized
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE ${filters.join(' AND ')}
     ORDER BY m.id, mi.updated_at DESC`,
    params,
  );

  return rows
    .filter((row) => fs.existsSync(row.abs_path))
    .map((row) => ({
      modId: row.mod_id,
      modName: row.mod_name,
      modPath: row.abs_path,
      srcLang: row.src_lang ?? CONFIG.defaultSrcLang,
      game: (row.game ?? 'fo4') as GameType,
      isLocalized: (row.is_localized ?? 0) === 1,
    }));
};

/**
 * Export one mod's translation release to a directory on disk.
 *
 * Default behaviour (see {@link ModReleaseExportOptions}):
 * - patch the ESP with embedded translations when possible,
 * - fall back to loose STRINGS tables for localized mods,
 * - write patched PEX scripts as loose files under `Scripts\`,
 * - do not create BA2/BSA archives.
 */
export const exportModRelease = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
  outDir: string,
  options: ModReleaseExportOptions = {},
): Promise<ModReleaseExportResult> => {
  const forceLocalized = options.forceLocalized ?? false;
  const repackArchives = options.repackArchives ?? false;
  const localizeScripts = options.localizeScripts !== false;

  ensureDir(outDir);
  const written: string[] = [];
  const warnings: string[] = [];
  const modName = path.basename(modPath);

  if (forceLocalized) {
    try {
      const stringsFiles = await exportLocalizedStringsFiles(
        db,
        modId,
        modPath,
        srcLang,
        targetLang,
        game,
      );
      if (!repackArchives) {
        writeLooseStringsFiles(outDir, stringsFiles, written);
      }
    } catch (err) {
      warnings.push(`STRINGS: ${exportErrorMessage(err)}`);
    }
  } else {
    try {
      const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
      writeExportedFile(outDir, esp, written);
    } catch (espErr) {
      try {
        const stringsFiles = await exportLocalizedStringsFiles(
          db,
          modId,
          modPath,
          srcLang,
          targetLang,
          game,
        );
        if (!repackArchives) {
          writeLooseStringsFiles(outDir, stringsFiles, written);
        }
      } catch (stringsErr) {
        warnings.push(
          `ESP: ${exportErrorMessage(espErr)}; STRINGS fallback: ${exportErrorMessage(stringsErr)}`,
        );
      }
    }
  }

  if (localizeScripts && !repackArchives) {
    try {
      const pexFiles = await exportPatchedPexFiles(db, modId, modPath, srcLang, targetLang);
      for (const pex of pexFiles) {
        writeExportedFile(outDir, pex, written);
      }
    } catch (err) {
      warnings.push(`Scripts: ${exportErrorMessage(err)}`);
    }
  }

  if (!repackArchives) {
    try {
      const voiceFiles = collectLocalizedVoiceFiles(modPath, targetLang);
      for (const voiceFile of voiceFiles) {
        const relPath = voiceFile.name.replace(/\\/g, '/');
        const dest = path.join(outDir, relPath);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(voiceFile.absPath, dest);
        written.push(relPath);
      }
    } catch (err) {
      warnings.push(`Voice: ${exportErrorMessage(err)}`);
    }
  }

  if (repackArchives) {
    try {
      const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, {
        includeScripts: localizeScripts,
      });
      for (const archive of archives) {
        writeExportedFile(outDir, archive, written);
      }
    } catch (err) {
      warnings.push(`Archive: ${exportErrorMessage(err)}`);
    }
  }

  if (written.length === 0) {
    throw new Error(
      `No exportable content for mod ${modId} (${modName}): ${warnings.join('; ') || 'nothing produced'}`,
    );
  }

  log.info(
    `Release export mod ${modId}: ${written.length} file(s) → ${outDir}` +
      (warnings.length ? ` (${warnings.length} warning(s))` : ''),
  );

  return { modId, modName, outDir, files: written, warnings };
};
