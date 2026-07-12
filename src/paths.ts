import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const toolsDir = path.resolve(process.env.TOOLS_DIR ?? path.join(dataDir, 'tools'));

/** Runtime data directories (logs, uploads, cache, DB files). */
export const PATHS = {
  dataDir,
  toolsDir,
  logs: path.resolve(process.env.LOG_DIR ?? path.join(dataDir, 'logs')),
  modUploads: path.resolve(process.env.MOD_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'mod')),
  eetUploads: path.resolve(process.env.EET_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'eet')),
  csvUploads: path.resolve(process.env.CSV_UPLOAD_DIR ?? path.join(dataDir, 'uploads', 'csv')),
  gamesCache: path.resolve(process.env.GAMES_CACHE_DIR ?? path.join(dataDir, 'cache', 'games')),
  /** Local extraction target for scan:mods archives (never on network shares). */
  scanExtract: path.resolve(
    process.env.SCAN_EXTRACT_DIR ?? path.join(dataDir, 'cache', 'scan-extract'),
  ),
  /** Cached Champollion PSC output keyed by mod id + PEX digest. */
  pexDecompile: path.resolve(
    process.env.PEX_DECOMPILE_CACHE_DIR ?? path.join(dataDir, 'cache', 'pex-decompile'),
  ),
  /** Cached FUZ/XWM → WAV previews for the mod editor voice modal. */
  voicePreview: path.resolve(
    process.env.VOICE_PREVIEW_CACHE_DIR ?? path.join(dataDir, 'cache', 'voice-preview'),
  ),
  /** Champollion CLI installed by `npm run tools:install`. */
  champollion: path.resolve(
    process.env.CHAMPOLLION_INSTALL_DIR ?? path.join(toolsDir, 'champollion'),
  ),
  backups: path.resolve(process.env.BACKUP_DIR ?? path.join(dataDir, 'backups')),
  postgres: path.resolve(process.env.POSTGRES_DATA_DIR ?? path.join(dataDir, 'postgres')),
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
    PATHS.backups,
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
};
