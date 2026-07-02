/**
 * On-demand PEX → PSC decompilation for the mod editor (Champollion CLI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Tx } from '../db';
import { PATHS } from '../paths';
import { ensureChampollionInstalled } from '../tools/installChampollion';
import { sha1Hex } from '../utils/hash';
import { collectModPexSources } from '../formats/pex';
import {
  locatePexLiteralInPsc,
  pexScriptKeyFromRecordPath,
  type PexSourceLocateResult,
} from '../formats/pex/pexSourceLocate';
import { normalizePexScriptKey, parsePexBuffer } from '../formats/pex/pexParser';
import { parsePexStoredContext } from '../formats/pex/pexStoredContext';
import { log } from '../logger';

export type PexSourceSnippetResult =
  | { ok: true; snippet: PexSourceLocateResult }
  | {
      ok: false;
      reason:
        | 'not_pex'
        | 'mod_not_found'
        | 'string_not_found'
        | 'pex_not_found'
        | 'decompiler_missing'
        | 'decompile_failed'
        | 'literal_not_found';
      message: string;
    };

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
  exePath: string,
  pexPath: string,
  outDir: string,
  recreateSubdirs: boolean,
): Promise<void> => {
  const args = ['-p', outDir];
  if (recreateSubdirs) args.push('-s');
  args.push(pexPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Champollion timed out'));
    }, DECOMPILE_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Champollion exited with code ${code}`));
    });
  });
};

const decompilePexToPsc = async (
  pexData: Buffer,
  scriptKey: string,
  cacheBucket: number | string,
): Promise<{ pscPath: string; headerSourceFile: string }> => {
  const fileStem = normalizePexScriptKey(scriptKey);
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
    throw new Error('Champollion not found after install');
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

/**
 * Decompile the owning `.pex` and locate the Papyrus source line for one PEX string row.
 */
export const getPexSourceSnippetForString = async (
  db: Tx,
  modId: number,
  stringId: number,
): Promise<PexSourceSnippetResult> => {
  const { rows } = await db.query<{
    signature: string | null;
    path: string | null;
    text_raw: string;
    context: string | null;
    abs_path: string | null;
  }>(
    `SELECT r.signature, r.path, s.text_raw, s.context, m.abs_path
       FROM strings s
       JOIN records r ON s.record_id = r.id
       JOIN mods m ON r.mod_id = m.id
      WHERE s.id = $1 AND r.mod_id = $2`,
    [stringId, modId],
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'string_not_found', message: 'String row not found' };
  }
  if (row.signature !== 'PEX') {
    return { ok: false, reason: 'not_pex', message: 'Not a PEX string row' };
  }

  const stored = parsePexStoredContext(row.context);
  if (stored) {
    return { ok: true, snippet: stored };
  }
  if (!row.abs_path || !fs.existsSync(row.abs_path)) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod plugin file not found on disk' };
  }

  const scriptKey = pexScriptKeyFromRecordPath(row.path ?? '');
  if (!scriptKey) {
    return { ok: false, reason: 'pex_not_found', message: 'Invalid PEX record path' };
  }

  const sources = collectModPexSources(row.abs_path);
  const pexSource = sources.get(scriptKey) ?? null;

  if (!pexSource) {
    return {
      ok: false,
      reason: 'pex_not_found',
      message: `Compiled script not found for ${scriptKey}`,
    };
  }

  try {
    await ensureChampollionInstalled();
  } catch {
    return {
      ok: false,
      reason: 'decompiler_missing',
      message: 'Champollion not available. Check network access or set CHAMPOLLION_PATH in .env',
    };
  }

  let pscPath: string;
  let headerSourceFile: string;
  try {
    ({ pscPath, headerSourceFile } = await decompilePexToPsc(pexSource.data, scriptKey, modId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`PEX decompile failed mod=${modId} script=${scriptKey}: ${message}`);
    const reason = message.includes('CHAMPOLLION_PATH') ? 'decompiler_missing' : 'decompile_failed';
    return { ok: false, reason, message };
  }

  const pscSource = fs.readFileSync(pscPath, 'utf8');
  const snippet = locatePexLiteralInPsc(pscSource, row.text_raw, {
    scriptLabel: path.basename(headerSourceFile || `${scriptKey}.psc`),
    headerSourceFile,
  });

  if (!snippet) {
    return {
      ok: false,
      reason: 'literal_not_found',
      message: 'Literal not found in decompiled source',
    };
  }

  return { ok: true, snippet };
};
