/**
 * Cached access to a mod's voice catalog.
 *
 * Building a catalog scans the localize tree and runs several queries, and the
 * editor asks for it twice per screen (speakers, then lines). The cache keeps
 * one build per mod and language pair, keyed by a fingerprint of the data that
 * must never be served stale.
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { gamePlugin } from '../../../games/registry';
import { resolveModStoredPath } from '../../../modStorage';
import type { VoiceLineCatalogResult } from '../../../voice/lineCatalog';

export type { VoiceLineCatalog, VoiceLineCatalogError } from '../../../voice/lineCatalog';

type CacheEntry = { revision: string; result: Promise<VoiceLineCatalogResult> };

const cache = new Map<string, CacheEntry>();

const cacheKey = (modId: number, srcLang: string, targetLang: string): string =>
  `${modId}:${srcLang}:${targetLang}`;

/**
 * Cheap fingerprint of data the voice list must not serve stale.
 *
 * The worker writes `voice_synthesis_state` in another process, so a wall-clock
 * TTL cannot see new takes. Speaker refs change on the web process.
 */
export const loadVoiceListRevision = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<string> => {
  const { rows } = await db.query<{
    synth_n: string;
    synth_at: Date | string | null;
    ref_n: string;
    ref_at: Date | string | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::text
          FROM voice_synthesis_state
         WHERE mod_id = $1 AND target_lang = $2) AS synth_n,
       (SELECT MAX(synthesized_at)
          FROM voice_synthesis_state
         WHERE mod_id = $1 AND target_lang = $2) AS synth_at,
       (SELECT COUNT(*)::text
          FROM voice_speaker_refs
         WHERE mod_id = $1) AS ref_n,
       (SELECT MAX(updated_at)
          FROM voice_speaker_refs
         WHERE mod_id = $1) AS ref_at`,
    [modId, targetLang],
  );
  const row = rows[0];
  const stamp = (value: Date | string | null | undefined): string => {
    if (value == null) return 'none';
    return value instanceof Date ? value.toISOString() : String(value);
  };
  return `${row?.synth_n ?? '0'}:${stamp(row?.synth_at)}:${row?.ref_n ?? '0'}:${stamp(row?.ref_at)}`;
};

const buildVoiceListContext = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceLineCatalogResult> => {
  const { rows } = await db.query<{ abs_path: string | null; game: string | null }>(
    `SELECT abs_path, game FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  if (!mod.abs_path)
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };

  const voice = gamePlugin(mod.game).voice;
  if (!voice) {
    return { ok: false, reason: 'no_voice_files', message: 'This game has no voice support' };
  }

  return voice.loadLineCatalog(db, {
    modId,
    pluginPath: resolveModStoredPath(mod.abs_path),
    srcLang,
    targetLang,
  });
};

/**
 * Load a mod's voice catalog. Speaker and line requests reuse one build while
 * the synthesis/reference revision is unchanged; a finished voice job bumps the
 * stamps, so the next request rebuilds and sees the new audio immediately.
 */
export const getVoiceListContext = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceLineCatalogResult> => {
  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const revision = await loadVoiceListRevision(db, modId, resolvedTargetLang);
  const key = cacheKey(modId, srcLang, resolvedTargetLang);
  const hit = cache.get(key);
  if (hit && hit.revision === revision) return hit.result;

  const result = buildVoiceListContext(db, modId, srcLang, resolvedTargetLang).then((loaded) => {
    if (!loaded.ok) {
      const current = cache.get(key);
      if (current?.revision === revision) cache.delete(key);
    }
    return loaded;
  });
  cache.set(key, { revision, result });
  return result;
};

/** Drop cached voice context after mutations that change audio or references. */
export const invalidateVoiceListContext = (modId: number): void => {
  for (const key of cache.keys()) {
    if (key.startsWith(`${modId}:`)) cache.delete(key);
  }
};
