import type { ZipPackEntry } from './exportTypes';
import type { VortexFileWinner } from '../../vortex/types';

/** Flatten zip paths so Vortex sees one Data tree, not a folder per mod. */
export const normalizeLangpackZipPath = (raw: string): string => {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return cleaned.replace(/^data\//i, '');
};

const winnerFolderByPath = (winners: readonly VortexFileWinner[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const winner of winners) {
    const key = normalizeLangpackZipPath(winner.path).toLowerCase();
    if (key) map.set(key, winner.sourceFolder);
  }
  return map;
};

const folderEquals = (left: string | null | undefined, right: string): boolean =>
  Boolean(left) && left!.toLowerCase() === right.toLowerCase();

export type TaggedLangpackEntry = {
  entry: ZipPackEntry;
  sourceFolder?: string | null;
};

/**
 * Merge onto shared game paths. Later entries win unless Vortex deployment
 * names a winning staging folder for that exact path.
 */
export const mergeLangpackEntries = (
  entries: ZipPackEntry[] | TaggedLangpackEntry[],
  fileWinners?: readonly VortexFileWinner[],
): ZipPackEntry[] => {
  const tagged: TaggedLangpackEntry[] = entries.map((item) =>
    'entry' in item ? item : { entry: item },
  );
  const groups = new Map<string, TaggedLangpackEntry[]>();
  for (const item of tagged) {
    const name = normalizeLangpackZipPath(item.entry.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push({ ...item, entry: { ...item.entry, name } });
    groups.set(key, list);
  }

  const winners = fileWinners ? winnerFolderByPath(fileWinners) : null;
  const merged: ZipPackEntry[] = [];
  for (const list of groups.values()) {
    const last = list[list.length - 1]!;
    const winnerFolder = winners?.get(last.entry.name.toLowerCase());
    const fromWinner = winnerFolder
      ? [...list].reverse().find((item) => folderEquals(item.sourceFolder, winnerFolder))
      : undefined;
    merged.push((fromWinner ?? last).entry);
  }
  return merged;
};
