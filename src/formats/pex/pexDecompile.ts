/**
 * PEX → PSC decompilation (Champollion CLI), cached on disk by PEX digest.
 *
 * Import reads the source to tell player-facing literals from debug ones; the mod
 * editor reads it to show the line a string sits on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../../paths';
import { execFileAsync } from '../../utils/execFile';
import { sha1Hex } from '../../utils/hash';
import { log } from '../../logger';
import { ensureChampollionInstalled } from './champollion';
import { normalizePexScriptKey, parsePexBuffer } from './pexParser';
import { pexScriptBaseName } from './pexScriptKey';

const DECOMPILE_TIMEOUT_MS = 60_000;

const findPscFile = (
  rootDir: string,
  scriptKey: string,
  headerSourceFile: string | null,
): string | null => {
  const targets = new Set<string>();
  targets.add(`${scriptKey}.psc`.toLowerCase());
  if (headerSourceFile) {
    const base = path.basename(headerSourceFile.replace(/\\/g, path.sep)).toLowerCase();
    if (base) targets.add(base);
  }

  const walk = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = walk(full);
        if (nested) return nested;
      } else if (targets.has(entry.name.toLowerCase())) {
        return full;
      }
    }
    return null;
  };

  return walk(rootDir);
};

const runChampollion = async (
  binPath: string,
  pexPath: string,
  outDir: string,
  recreateSubdirs: boolean,
): Promise<void> => {
  const args = ['-p', outDir];
  if (recreateSubdirs) args.push('-s');
  args.push(pexPath);

  await execFileAsync(binPath, args, { timeoutMs: DECOMPILE_TIMEOUT_MS });
};

const decompilePexToPsc = async (
  pexData: Buffer,
  scriptKey: string,
  cacheBucket: number | string,
): Promise<{ pscPath: string; headerSourceFile: string }> => {
  const fileStem = normalizePexScriptKey(pexScriptBaseName(scriptKey));
  const digest = sha1Hex(pexData);
  const cacheDir = path.join(PATHS.pexDecompile, String(cacheBucket), digest);
  fs.mkdirSync(cacheDir, { recursive: true });

  const parsed = parsePexBuffer(pexData);
  const headerSourceFile = parsed.info.sourceFile.trim();
  const scriptLabel = path.basename(headerSourceFile || `${fileStem}.psc`);
  const cachedPsc = path.join(cacheDir, `${fileStem}.psc`);

  if (fs.existsSync(cachedPsc)) {
    return { pscPath: cachedPsc, headerSourceFile };
  }

  const champollion = await ensureChampollionInstalled();
  if (!fs.existsSync(champollion)) {
    throw new Error('Champollion not found. Rebuild the Docker image.');
  }

  const workDir = path.join(cacheDir, 'work');
  const inDir = path.join(workDir, 'in');
  const outDir = path.join(workDir, 'out');
  fs.mkdirSync(inDir, { recursive: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const pexPath = path.join(inDir, `${fileStem}.pex`);
  fs.writeFileSync(pexPath, pexData);

  const recreateSubdirs = /[\\/]/.test(headerSourceFile);
  await runChampollion(champollion, pexPath, outDir, recreateSubdirs);

  const produced = findPscFile(outDir, fileStem, headerSourceFile);
  if (!produced) {
    throw new Error(`Champollion did not produce ${scriptLabel}`);
  }

  fs.copyFileSync(produced, cachedPsc);
  return { pscPath: cachedPsc, headerSourceFile };
};

export type DecompiledPexScript = {
  headerSourceFile: string;
  pscSource: string;
};

/** Decompile one `.pex` buffer to PSC text (cached under mod id + digest). */
export const decompilePexScript = async (
  pexData: Buffer,
  scriptKey: string,
  cacheBucket: number | string,
): Promise<DecompiledPexScript> => {
  const { pscPath, headerSourceFile } = await decompilePexToPsc(pexData, scriptKey, cacheBucket);
  return { headerSourceFile, pscSource: fs.readFileSync(pscPath, 'utf8') };
};

/** Decompile every script in the map; failures are skipped with a warning. */
export const decompilePexScriptMap = async (
  scripts: Map<string, Buffer>,
  cacheBucket: number | string,
): Promise<Map<string, DecompiledPexScript>> => {
  const out = new Map<string, DecompiledPexScript>();
  for (const [scriptKey, data] of scripts) {
    try {
      out.set(scriptKey, await decompilePexScript(data, scriptKey, cacheBucket));
    } catch (err) {
      log.warn(
        `PEX decompile skipped script=${scriptKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
};
