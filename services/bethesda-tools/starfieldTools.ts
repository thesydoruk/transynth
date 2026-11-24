/**
 * The Starfield Creation Kit's two lip tools, supplied by the user.
 *
 * `npm run tools:install -- --game-dir <Starfield>` copies the Creation Kit's
 * `Tools/LipGenerator` and `Tools/FaceFX` folders into the tools mount as
 * `starfield/LipGenerator` and `starfield/FaceFX`, next to (never over) the Fallout
 * `FonixData.cdf`. Run from a Docker Desktop bind mount of a Windows folder the
 * executables page-fault at start, so they are copied once to a folder on the
 * container's own filesystem and run from there; the copy is redone when the mounted
 * files change (name, size or modification time).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIP_GENERATOR_DIR = 'LipGenerator';
export const FACEFX_DIR = 'FaceFX';

/** What both tools need; any other file in the two folders is copied along. */
export const STARFIELD_TOOL_FILES = {
  [LIP_GENERATOR_DIR]: [
    'LipGenerator.exe',
    'FonixData.cdf',
    'icudt58.dll',
    'icuin58.dll',
    'icuuc58.dll',
    'libresample.dll',
    'libsndfile-1.dll',
  ],
  [FACEFX_DIR]: [
    'ffxc.exe',
    'StarfieldHumanMale.facefx',
    'StarfieldHumanFemale.facefx',
    'GenesisDefault.facefx',
  ],
} as const;

export type FaceFxActor = 'male' | 'female';

export const ACTOR_FILES: Readonly<Record<FaceFxActor, string>> = {
  male: 'StarfieldHumanMale.facefx',
  female: 'StarfieldHumanFemale.facefx',
};
export const ANALYSIS_ACTOR_FILE = 'GenesisDefault.facefx';

export type StarfieldToolPaths = {
  lipGenerator: string;
  ffxc: string;
  actor: (actor: FaceFxActor) => string;
  analysisActor: string;
};

export const starfieldToolPaths = (root: string): StarfieldToolPaths => ({
  lipGenerator: path.join(root, LIP_GENERATOR_DIR, 'LipGenerator.exe'),
  ffxc: path.join(root, FACEFX_DIR, 'ffxc.exe'),
  actor: (actor) => path.join(root, FACEFX_DIR, ACTOR_FILES[actor]),
  analysisActor: path.join(root, FACEFX_DIR, ANALYSIS_ACTOR_FILE),
});

/** Required files missing under `root`, as `LipGenerator/x.dll`; empty when complete. */
export const missingStarfieldTools = (root: string): string[] =>
  Object.entries(STARFIELD_TOOL_FILES).flatMap(([dir, files]) =>
    files
      .filter((file) => !fs.existsSync(path.join(root, dir, file)))
      .map((file) => `${dir}/${file}`),
  );

/** Every file of the two folders with its size and mtime: changes when the install does. */
export const starfieldToolsSignature = (root: string): string =>
  Object.keys(STARFIELD_TOOL_FILES)
    .flatMap((dir) => {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) return [];
      return fs
        .readdirSync(full, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const stat = fs.statSync(path.join(full, entry.name));
          return `${dir}/${entry.name}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
        })
        .sort();
    })
    .join('\n');

export class StarfieldToolsMissingError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    const named = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
    super(
      `Starfield lip tools are not installed (missing ${named}${more}); run ` +
        '`npm run tools:install -- --game-dir <Starfield or its Creation Kit>`',
    );
    this.name = 'StarfieldToolsMissingError';
    this.missing = missing;
  }
}

/** Copy the two folders' files from `source` into a new `dest` through a staging folder. */
const copyStarfieldTools = async (source: string, dest: string): Promise<void> => {
  const staging = `${dest}.staging`;
  await fs.promises.rm(staging, { recursive: true, force: true });
  for (const dir of Object.keys(STARFIELD_TOOL_FILES)) {
    const from = path.join(source, dir);
    await fs.promises.mkdir(path.join(staging, dir), { recursive: true });
    for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      await fs.promises.copyFile(path.join(from, entry.name), path.join(staging, dir, entry.name));
    }
  }
  await fs.promises.rename(staging, dest);
};

/**
 * A container-local copy of the mounted tools. `ensure()` returns the folder to run
 * them from: `<localRoot>/<hash of the source signature>`, copied on first use and
 * again whenever the mounted files change; older copies are removed then. Concurrent
 * calls share one copy. Throws `StarfieldToolsMissingError` when the mount lacks a file.
 */
export const createStarfieldToolsCache = (source: string, localRoot: string) => {
  const pending = new Map<string, Promise<string>>();

  const copy = async (dest: string): Promise<string> => {
    await fs.promises.mkdir(localRoot, { recursive: true });
    await copyStarfieldTools(source, dest);
    for (const name of await fs.promises.readdir(localRoot)) {
      const other = path.join(localRoot, name);
      if (other !== dest) await fs.promises.rm(other, { recursive: true, force: true });
    }
    return dest;
  };

  const ensure = async (): Promise<string> => {
    const missing = missingStarfieldTools(source);
    if (missing.length > 0) throw new StarfieldToolsMissingError(missing);
    const version = createHash('sha256')
      .update(starfieldToolsSignature(source))
      .digest('hex')
      .slice(0, 16);
    const dest = path.join(localRoot, version);
    if (fs.existsSync(dest)) return dest;
    let job = pending.get(dest);
    if (!job) {
      job = copy(dest).finally(() => pending.delete(dest));
      pending.set(dest, job);
    }
    return job;
  };

  return { ensure, installed: (): boolean => missingStarfieldTools(source).length === 0 };
};

export type StarfieldToolsCache = ReturnType<typeof createStarfieldToolsCache>;
