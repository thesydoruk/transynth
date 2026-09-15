import type { ModExportContext } from '../../contract';
import { log } from '../../../logger';
import { resolveModImportExtractRoot } from '../../../modStorage/paths';
import { collectExportableVoiceFiles } from '../../../web/export/exportVoiceFiles';
import type { ZipPackEntry } from '../../../web/export/exportTypes';
import { discoLangFolderNameForLocale } from '../packLayout';
import { collectDiscoPoPatchEntries } from './poPatch';

/** Final Cut langpack: `.po` folder + localized `.wav` under Audio/. */
export const collectDiscoLangpackEntries = async ({
  db,
  modId,
  modPath,
  srcLang,
  targetLang,
}: ModExportContext): Promise<ZipPackEntry[]> => {
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
