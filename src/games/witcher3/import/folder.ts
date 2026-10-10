/**
 * What a folder on disk holds, for `npm run import:folder -- --game w3`.
 *
 * Three shapes are worth telling apart:
 * - the game root (it has `content/content0`): the game and its DLC as one
 *   mod. Its `mods` folder is left out — those are other people's mods and
 *   are imported on their own;
 * - a `mods` folder with `perMod`: one mod per `mods/<modName>`, each keeping
 *   its folder name in its paths, because that is where the export puts the
 *   files back;
 * - anything else: the whole tree as one mod.
 *
 * Planned for copying: the string tables, the voice containers
 * (`<lang>pc.w3speech` — 4.2 GB for English, what voice synthesis clones and
 * the voice export rebuilds from), and the scene files that say who speaks
 * each line. Scenes are taken out of the `.bundle` archives and staged loose
 * under `scenes/` (253 MB for the game): the 2.1 GB of archives they come in
 * are mostly meshes and textures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logImport } from '../../../logging/loggers';
import type { FolderImportFile, FolderImportOptions, FolderImportUnit } from '../../contract';
import { readBundleEntry, readBundleIndex } from '../bundles';
import { isW3SceneFile, isW3VoiceTagTable } from '../scenes';
import { listW3SpeechFiles, listW3StringsFiles, type W3LanguageFile } from '../packLayout';

const isGameRoot = (dir: string): boolean => fs.existsSync(path.join(dir, 'content', 'content0'));

const relPath = (contentDir: string, file: W3LanguageFile): string => {
  const name = path.basename(file.absPath);
  return contentDir ? `${contentDir}/${name}` : name;
};

const selectFiles = (
  root: string,
  options: FolderImportOptions,
  skipMods: boolean,
): W3LanguageFile[] =>
  [...listW3StringsFiles(root), ...listW3SpeechFiles(root)].filter(
    (file) =>
      (!options.langs || options.langs.has(file.lang)) &&
      !(skipMods && /^mods(\/|$)/i.test(file.contentDir)),
  );

const hasTables = (file: FolderImportFile): boolean =>
  file.relPath.toLowerCase().endsWith('.w3strings');

const listBundlesUnder = (root: string, skipMods: boolean): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!(skipMods && /^mods$/i.test(childRel))) walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bundle')) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root, '');
  return out.sort();
};

/** Scene files and voice-tag tables inside the archives, staged under `<prefix>scenes/`. */
const sceneFiles = (root: string, prefix: string, skipMods: boolean): FolderImportFile[] => {
  const byPath = new Map<string, FolderImportFile>();
  for (const bundle of listBundlesUnder(root, skipMods)) {
    for (const entry of readBundleIndex(bundle).entries) {
      if (!isW3SceneFile(entry.path) && !isW3VoiceTagTable(entry.path)) continue;
      const relPath = `${prefix}scenes/${entry.path}`;
      // A later archive's copy wins, as the game's own load order does.
      byPath.set(relPath, {
        relPath,
        size: entry.size,
        read: () => {
          const fd = fs.openSync(bundle, 'r');
          try {
            return readBundleEntry(fd, entry);
          } finally {
            fs.closeSync(fd);
          }
        },
      });
    }
  }
  return [...byPath.values()];
};

export const planWitcher3FolderImport = (
  dir: string,
  options: FolderImportOptions,
): FolderImportUnit[] => {
  if (options.perMod) {
    return (
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry): FolderImportUnit => {
          const root = path.join(dir, entry.name);
          return {
            name: entry.name,
            sourceFolder: root,
            files: [
              ...selectFiles(root, options, false).map((file) => ({
                absPath: file.absPath,
                relPath: relPath(
                  file.contentDir ? `${entry.name}/${file.contentDir}` : entry.name,
                  file,
                ),
              })),
              ...sceneFiles(root, `${entry.name}/`, false),
            ],
          };
        })
        // Scenes alone are nothing to translate.
        .filter((unit) => unit.files.some(hasTables))
    );
  }

  const gameRoot = isGameRoot(dir);
  if (gameRoot && fs.existsSync(path.join(dir, 'mods'))) {
    logImport.info(
      `Witcher 3 game root: leaving out "mods" — import them with --dir "${path.join(dir, 'mods')}" --per-mod`,
    );
  }
  const files: FolderImportFile[] = [
    ...selectFiles(dir, options, gameRoot).map((file) => ({
      absPath: file.absPath,
      relPath: relPath(file.contentDir, file),
    })),
    ...sceneFiles(dir, '', gameRoot),
  ];
  if (!files.some((file) => hasTables(file))) return [];
  return [
    {
      name: options.name ?? (gameRoot ? 'The Witcher 3' : path.basename(dir)),
      sourceFolder: dir,
      files,
    },
  ];
};
