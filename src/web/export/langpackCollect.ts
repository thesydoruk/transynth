import fs from 'node:fs';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { patchStringsMap } from '../../formats/esp';
import { discoLangFolderNameForLocale } from '../../formats/po';
import { patchPexBuffer, collectModPexSources } from '../../formats/pex';
import { writeStringsBuffer } from '../../formats/strings';
import { log } from '../../logger';
import { exportLocaleSlots } from '../../locale/exportSlots';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import { exportPatchedEsp } from './exportEsp';
import { getPexTranslationOverlays } from './exportPex';
import { collectExportableVoiceFiles } from './exportVoiceFiles';
import { collectInterfacePatchEntries } from './exportInterfacePatch';
import { collectMcmPatchEntries } from './exportMcmPatch';
import { collectDiscoPoPatchEntries } from './exportDiscoPoPatch';
import type { ZipPackEntry } from './exportTypes';
import { loadSourceStringsFiles } from './sourceStringsLoader';
import { getTranslationOverlaysByType, hasTranslationOverlayChanges } from './translationOverlay';

/** Final Cut langpack: `.po` folder + localized `.wav` under Audio/. */
const collectDiscoLangpackEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ZipPackEntry[]> => {
  const files: ZipPackEntry[] = [];
  const extractRoot = resolveModImportExtractRoot(modPath);
  const langFolder = discoLangFolderNameForLocale(targetLang);

  try {
    const poFiles = await collectDiscoPoPatchEntries(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      extractRoot,
    );
    files.push(...poFiles);
  } catch (err) {
    log.info(
      `Disco langpack: PO export failed for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const voiceFiles = await collectExportableVoiceFiles(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      'disco',
      {
        extensions: ['.wav'],
        zipPathTransform: (relPath) => {
          const cleaned = relPath.replace(/^Audio\//i, '');
          return `${langFolder}/Audio/${cleaned}`;
        },
      },
    );
    for (const voiceFile of voiceFiles) {
      files.push({ name: voiceFile.name, absPath: voiceFile.absPath });
    }
    if (voiceFiles.length > 0) {
      log.info(
        `Disco langpack: included ${voiceFiles.length} localized .wav file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Disco langpack: no localized voice for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  return files;
};

const collectBethesdaLangpackEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
): Promise<ZipPackEntry[]> => {
  const files: ZipPackEntry[] = [];

  try {
    const sourceFiles = loadSourceStringsFiles(modPath, srcLang, game);
    const overlays = await getTranslationOverlaysByType(db, modId, srcLang, targetLang, game);
    const slots = exportLocaleSlots(targetLang, game);
    let stringsCount = 0;
    for (const sourceFile of sourceFiles) {
      const overlay = overlays.get(sourceFile.type) ?? new Map();
      if (!hasTranslationOverlayChanges(sourceFile.sourceMap, overlay)) continue;
      const patched = patchStringsMap(sourceFile.sourceMap, overlay);
      const buf = writeStringsBuffer(patched, sourceFile.type);
      for (const slot of slots) {
        const fileName = `${sourceFile.nameStem}_${slot}.${sourceFile.type}`;
        files.push({ name: `Strings/${fileName}`, data: buf });
        stringsCount++;
      }
    }
    if (stringsCount > 0) {
      log.info(
        `Langpack export: included ${stringsCount} changed STRINGS file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Langpack export: no localized STRINGS for mod ${modId}, skipping strings tables (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    const patchedBuf = Buffer.from(esp.contentBase64, 'base64');
    const originalBuf = fs.readFileSync(modPath);
    if (!patchedBuf.equals(originalBuf)) {
      files.push({ name: esp.fileName, data: patchedBuf });
      log.info(`Langpack export: included patched ESP (${esp.size} bytes)`);
    }
  } catch {
    log.info(`Langpack export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  try {
    const overlays = await getPexTranslationOverlays(db, modId, srcLang, targetLang);
    const sources = collectModPexSources(modPath);
    let pexCount = 0;
    for (const [scriptKey, source] of sources) {
      const overlay = overlays.get(scriptKey);
      if (!overlay || overlay.size === 0) continue;
      const hasChanges = [...overlay.entries()].some(([src, exp]) => exp !== src);
      if (!hasChanges) continue;

      const patched = patchPexBuffer(source.data, overlay);
      const fileName =
        source.archivePath.replace(/\\/g, '/').split('/').pop() ?? `${scriptKey}.pex`;
      const archivePath = source.archivePath.includes('\\')
        ? source.archivePath
        : `Scripts\\${fileName}`;
      files.push({ name: archivePath.replace(/\\/g, '/'), data: patched });
      pexCount++;
    }
    if (pexCount > 0) {
      log.info(`Langpack export: included ${pexCount} changed PEX script(s) for mod ${modId}`);
    }
  } catch {
    log.info(`Langpack export: no patched PEX scripts for mod ${modId}, skipping Scripts`);
  }

  try {
    const voiceFiles = await collectExportableVoiceFiles(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    for (const voiceFile of voiceFiles) {
      files.push({ name: voiceFile.name, absPath: voiceFile.absPath });
    }
    if (voiceFiles.length > 0) {
      log.info(
        `Langpack export: included ${voiceFiles.length} localized voice file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Langpack export: no localized voice files for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const interfaceFiles = await collectInterfacePatchEntries(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    files.push(...interfaceFiles);
  } catch (err) {
    log.info(
      `Langpack export: no Interface patch files for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const mcmFiles = await collectMcmPatchEntries(db, modId, modPath, srcLang, targetLang, game);
    files.push(...mcmFiles);
  } catch (err) {
    log.info(
      `Langpack export: no MCM patch files for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  return files;
};

/**
 * Collect loose localization files for one mod (no ZIP, no per-mod folder).
 * Empty result means the mod has nothing exportable — callers decide whether to throw.
 */
export const collectLangpackEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ZipPackEntry[]> => {
  if (game === 'disco') {
    return collectDiscoLangpackEntries(db, modId, modPath, srcLang, targetLang);
  }
  return collectBethesdaLangpackEntries(db, modId, modPath, srcLang, targetLang, game);
};
