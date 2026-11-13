import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  modImportLocalizeDir,
  resolveModImportExtractRoot,
  resolveModStoredPath,
} from '../../../modStorage';
import { resolveImportPackages } from '../../../modImport';
import { pluginRelPath } from '../../../modImport/packages';
import { loadModImportPaths } from '../../../import/mod/resolvePaths';
import { ensureDir } from '../../../utils/file';

export type VoicePackageContext = {
  packageDir: string;
  pluginRel: string;
  pluginPath: string;
  localizeDir: string | null;
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const resolveVoiceLocalizeDir = (pluginPath: string, targetLang: string): string | null => {
  const extractRoot = resolveModImportExtractRoot(pluginPath);
  if (!extractRoot) return null;
  const localizeDir = modImportLocalizeDir(extractRoot, targetLang);
  return fs.existsSync(localizeDir) ? localizeDir : null;
};

/**
 * The package the import and the voice job resolve for this plugin, when it
 * holds the plugin's voice tree.
 *
 * The job writes each take at `<package localize dir>/<take path relative to the
 * package>`. The editor has to name takes the same way: for an archive wrapped in
 * `Data/` the job's package is the extract root (`Data/Sound/Voice/…`), and a
 * context rooted at `Data/` itself looked for `Sound/Voice/…` beside it — every
 * dubbed line showed as missing and single-line synthesis wrote outside `Data/`.
 */
const importPackageVoiceContext = (
  pluginPath: string,
  targetLang: string,
): VoicePackageContext | null => {
  const extractRoot = resolveModImportExtractRoot(pluginPath);
  if (!extractRoot) return null;
  let pkg: ReturnType<typeof resolveImportPackages>[number] | undefined;
  try {
    pkg = resolveImportPackages(extractRoot, targetLang, pluginPath)[0];
  } catch {
    return null;
  }
  if (!pkg) return null;
  const pluginRel = pluginRelPath(pkg.packageDir, pluginPath);
  // A package picked beside the plugin (a sibling content folder) is not its voice root.
  if (pluginRel.startsWith('..') || path.isAbsolute(pluginRel)) return null;
  const voiceRoot = path.join(pkg.packageDir, ...resolveVoiceRootRel(pluginRel).split('/'));
  if (!fs.existsSync(voiceRoot)) return null;
  return {
    packageDir: pkg.packageDir,
    pluginRel,
    pluginPath,
    localizeDir: fs.existsSync(pkg.localizeDir) ? pkg.localizeDir : null,
  };
};

export const resolveVoicePackageContext = (
  pluginPath: string,
  targetLang: string,
): VoicePackageContext | null => {
  if (!pluginPath || !fs.existsSync(pluginPath)) return null;

  const fromImport = importPackageVoiceContext(pluginPath, targetLang);
  if (fromImport) return fromImport;

  const pluginDir = path.dirname(pluginPath);
  const pluginName = path.basename(pluginPath);
  const candidates: Array<{ packageDir: string; pluginRel: string }> = [
    { packageDir: pluginDir, pluginRel: pluginName },
  ];

  const pluginDirNorm = pluginDir.replace(/\\/g, '/');
  if (pluginDirNorm.endsWith('/Data')) {
    candidates.push({
      packageDir: path.dirname(pluginDir),
      pluginRel: normalizeRelPath(path.join('Data', pluginName)),
    });
  }

  for (const candidate of candidates) {
    const voiceRoot = path.join(
      candidate.packageDir,
      ...resolveVoiceRootRel(candidate.pluginRel).split('/'),
    );
    if (fs.existsSync(voiceRoot)) {
      return {
        ...candidate,
        pluginPath,
        localizeDir: resolveVoiceLocalizeDir(pluginPath, targetLang),
      };
    }
  }

  return {
    packageDir: pluginDir,
    pluginRel: pluginName,
    pluginPath,
    localizeDir: resolveVoiceLocalizeDir(pluginPath, targetLang),
  };
};

export const resolveModVoiceContext = async (
  db: Tx,
  modId: number,
  targetLang?: string,
): Promise<
  | {
      ok: true;
      mod: { name: string; abs_path: string };
      ctx: VoicePackageContext;
      targetLang: string;
    }
  | { ok: false; reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing'; message: string }
> => {
  const { rows } = await db.query<{ name: string; abs_path: string | null }>(
    `SELECT name, abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  let resolvedTargetLang = targetLang?.trim();
  if (!resolvedTargetLang) {
    const { rows: importRows } = await db.query<{ tgt_lang: string }>(
      `SELECT tgt_lang FROM mod_imports WHERE mod_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [modId],
    );
    resolvedTargetLang = importRows[0]?.tgt_lang?.trim() || CONFIG.defaultTgtLang;
  }

  const pluginPath = resolveModStoredPath(mod.abs_path);
  const ctx = resolveVoicePackageContext(pluginPath, resolvedTargetLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }
  await fillVoiceLocalizeDirFromImport(db, modId, ctx);

  return {
    ok: true,
    mod: { name: mod.name, abs_path: pluginPath },
    ctx,
    targetLang: resolvedTargetLang,
  };
};

/** Prefer the import-job localize tree when plugin-path inference misses Vortex extracts. */
export const fillVoiceLocalizeDirFromImport = async (
  db: Tx,
  modId: number,
  ctx: VoicePackageContext,
): Promise<void> => {
  if (ctx.localizeDir) return;
  try {
    const paths = await loadModImportPaths(db, { modId });
    if (fs.existsSync(paths.localizeDir)) ctx.localizeDir = paths.localizeDir;
  } catch {
    // No import job or extract — leave localizeDir null.
  }
};

export const resolveLocalizeDir = (ctx: VoicePackageContext, targetLang: string): string | null => {
  const extractRoot = resolveModImportExtractRoot(ctx.pluginPath);
  if (!extractRoot) return null;
  const packages = resolveImportPackages(extractRoot, targetLang, ctx.pluginPath);
  const localizeDir = packages[0]?.localizeDir ?? modImportLocalizeDir(extractRoot, targetLang);
  ensureDir(localizeDir);
  return localizeDir;
};
