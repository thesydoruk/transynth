import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root, resolved from this module rather than `process.cwd()`.
 *
 * The worker starts via `npm --prefix worker start`, so its cwd is `worker/`.
 * Relative `*_DIR` env values must still point at the same tree as the web
 * process, otherwise jobs read and write a second, empty data directory.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve a configured directory, treating relative values as repo-root relative. */
export const resolveDir = (dir: string): string =>
  path.isAbsolute(dir) ? path.normalize(dir) : path.resolve(projectRoot, dir);

const dataDir = resolveDir(process.env.DATA_DIR ?? './data');
const toolsDir = resolveDir(process.env.TOOLS_DIR ?? path.join(dataDir, 'tools'));

/** Runtime data directories (logs, uploads, cache, DB files). */
export const PATHS = {
  dataDir,
  toolsDir,
  logs: resolveDir(process.env.LOG_DIR ?? path.join(dataDir, 'logs')),
  modUploads: resolveDir(process.env.MOD_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'mod')),
  eetUploads: resolveDir(process.env.EET_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'eet')),
  csvUploads: resolveDir(process.env.CSV_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'csv')),
  gamesCache: resolveDir(process.env.GAMES_CACHE_DIR ?? path.join(dataDir, 'cache', 'games')),
  /** Local extraction target for scan:mods archives (never on network shares). */
  scanExtract: resolveDir(
    process.env.SCAN_EXTRACT_DIR ?? path.join(dataDir, 'cache', 'scan-extract'),
  ),
  /** Cached Champollion PSC output keyed by mod id + PEX digest. */
  pexDecompile: resolveDir(
    process.env.PEX_DECOMPILE_CACHE_DIR ?? path.join(dataDir, 'cache', 'pex-decompile'),
  ),
  /** Cached FUZ/XWM → WAV previews for the mod editor voice modal. */
  voicePreview: resolveDir(
    process.env.VOICE_PREVIEW_CACHE_DIR ?? path.join(dataDir, 'cache', 'voice-preview'),
  ),
  /** Cached audio-intel transcripts keyed by wav path + mtime + size. */
  audioIntel: resolveDir(
    process.env.AUDIO_INTEL_CACHE_DIR ?? path.join(dataDir, 'cache', 'audio-intel'),
  ),
  /** Temporary voice regeneration previews before the user commits one attempt. */
  voiceRegenerate: resolveDir(
    process.env.VOICE_REGENERATE_DIR ?? path.join(dataDir, 'cache', 'voice-regenerate'),
  ),
  /** Champollion CLI installed by `npm run tools:install`. */
  champollion: resolveDir(
    process.env.CHAMPOLLION_INSTALL_DIR ?? path.join(toolsDir, 'champollion'),
  ),
  backups: resolveDir(process.env.BACKUP_DIR ?? path.join(dataDir, 'backups')),
  postgres: resolveDir(process.env.POSTGRES_DATA_DIR ?? path.join(dataDir, 'postgres')),
  /** Background langpack ZIPs written by the worker (`{id}/{fileName}`). */
  exports: resolveDir(process.env.EXPORTS_DIR ?? path.join(dataDir, 'exports')),
};

/** Create standard data subdirectories if they do not exist yet. */
export const ensureDataDirs = (): void => {
  for (const dir of [
    PATHS.logs,
    PATHS.modUploads,
    PATHS.eetUploads,
    PATHS.csvUploads,
    PATHS.gamesCache,
    PATHS.scanExtract,
    PATHS.pexDecompile,
    PATHS.voicePreview,
    PATHS.audioIntel,
    PATHS.voiceRegenerate,
    PATHS.exports,
    PATHS.backups,
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
};
