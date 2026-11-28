/**
 * Files that travel with a take: same folder, same stem, another extension
 * (Starfield's `.ffxanim` beside its `.wem`). A take without them is not
 * complete, so every place that writes, copies or checks a take goes through
 * here. For a format with no sidecars each function does what the plain file
 * call it replaces did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeIfChanged } from '../modImport/packages';
import { ensureDir } from '../utils/file';
import type { BuiltVoiceTake, VoiceTakeSidecar } from './takeFormat/types';

type TakeFiles = Pick<BuiltVoiceTake, 'data' | 'sidecars'>;

/** Path of a take's sidecar: the take's own path with the extension swapped. */
export const takeSidecarPath = (takePath: string, extension: string): string =>
  `${takePath.slice(0, takePath.length - path.extname(takePath).length)}${extension}`;

/** Is the take on disk, with every sidecar its format needs? */
export const takeOnDisk = (takePath: string, sidecarExtensions: readonly string[]): boolean =>
  fs.existsSync(takePath) &&
  sidecarExtensions.every((extension) => fs.existsSync(takeSidecarPath(takePath, extension)));

const writeSidecars = (takePath: string, sidecars: readonly VoiceTakeSidecar[]): void => {
  for (const sidecar of sidecars) {
    fs.writeFileSync(takeSidecarPath(takePath, sidecar.extension), sidecar.data);
  }
};

/** Write a take and its sidecars, replacing what is there. */
export const writeVoiceTake = (takePath: string, built: TakeFiles): void => {
  ensureDir(path.dirname(takePath));
  fs.writeFileSync(takePath, built.data);
  writeSidecars(takePath, built.sidecars);
};

/**
 * {@link writeIfChanged} for a take: false when the file on disk already holds
 * these bytes. Its sidecars are written either way, so a take whose animation
 * went missing gets it back.
 */
export const writeVoiceTakeIfChanged = (
  takePath: string,
  built: TakeFiles,
  baselinePath: string | null,
): boolean => {
  const changed = writeIfChanged(takePath, built.data, baselinePath);
  writeSidecars(takePath, built.sidecars);
  return changed;
};

/**
 * Delete a take and its sidecars. A sidecar left without its take goes too.
 * True when the take itself was there.
 */
export const removeVoiceTake = (
  takePath: string,
  sidecarExtensions: readonly string[],
): boolean => {
  const present = fs.existsSync(takePath);
  if (present) fs.unlinkSync(takePath);
  for (const extension of sidecarExtensions) {
    const sidecar = takeSidecarPath(takePath, extension);
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  return present;
};

/** Copy the sidecars a take has next to its copy. A missing one is skipped. */
export const copyTakeSidecars = async (
  fromTakePath: string,
  toTakePath: string,
  sidecarExtensions: readonly string[],
): Promise<void> => {
  for (const extension of sidecarExtensions) {
    const from = takeSidecarPath(fromTakePath, extension);
    if (!fs.existsSync(from)) continue;
    await fs.promises.copyFile(from, takeSidecarPath(toTakePath, extension));
  }
};
