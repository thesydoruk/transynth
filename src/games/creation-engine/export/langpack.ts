import fs from 'node:fs';
import type { GameId } from '../../../types';
import type { ModExportContext } from '../../contract';
import { patchStringsMap } from '../../../formats/esp';
import { patchPexBuffer, collectModPexSources } from '../../../formats/pex';
import { writeStringsBuffer } from '../../../formats/strings';
import { log } from '../../../logger';
import { exportLocaleSlots } from '../../../locale/exportSlots';
import { exportPatchedEsp } from '../../../web/export/exportEsp';
import { getPexTranslationOverlays } from '../../../web/export/exportPex';
import { collectExportableVoiceFiles } from '../../../web/export/exportVoiceFiles';
import { collectInterfacePatchEntries } from '../../../web/export/exportInterfacePatch';
import { collectMcmPatchEntries } from '../../../web/export/exportMcmPatch';
import type { ZipPackEntry } from '../../../web/export/exportTypes';
import { loadSourceStringsFiles } from '../../../web/export/sourceStringsLoader';
import {
  getTranslationOverlaysByType,
  hasTranslationOverlayChanges,
} from '../../../web/export/translationOverlay';

/**
 * Loose localized files for one Creation Engine mod: patched string tables,
 * a patched plugin, patched Papyrus scripts, synthesized voice, and the
 * Interface / MCM text files that ship beside them.
 *
 * Every step is independent and best-effort — a mod with no MCM files still
 * exports its STRINGS.
 */
export const collectCreationEngineLangpackEntries = async ({
  db,
  modId,
  modPath,
  srcLang,
  targetLang,
  game,
}: ModExportContext & { game: GameId }): Promise<ZipPackEntry[]> => {
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
