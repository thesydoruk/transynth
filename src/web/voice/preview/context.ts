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
  const packages = resolveImportPackages(extractRoot, targetLang, pluginPath);
  const localizeDir = packages[0]?.localizeDir;
  return localizeDir && fs.existsSync(localizeDir) ? localizeDir : null;
};

export const resolveVoicePackageContext = (
  pluginPath: string,
  targetLang: string,
): VoicePackageContext | null => {
  if (!pluginPath || !fs.existsSync(pluginPath)) return null;

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

  return {
    ok: true,
    mod: { name: mod.name, abs_path: pluginPath },
    ctx,
    targetLang: resolvedTargetLang,
  };
};

export const resolveLocalizeDir = (ctx: VoicePackageContext, targetLang: string): string | null => {
  const extractRoot = resolveModImportExtractRoot(ctx.pluginPath);
  if (!extractRoot) return null;
  const packages = resolveImportPackages(extractRoot, targetLang, ctx.pluginPath);
  const localizeDir = packages[0]?.localizeDir ?? modImportLocalizeDir(extractRoot, targetLang);
  ensureDir(localizeDir);
  return localizeDir;
};
