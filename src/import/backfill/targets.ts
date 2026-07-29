/**
 * Resolve which mods can be re-scanned for strings their original import missed.
 *
 * A backfill needs the plugin file the mod was imported from plus the locale
 * settings of that import, so mods ingested from CSV, EET or an orphaned
 * STRINGS pack are reported as skipped rather than silently ignored.
 */
import fs from 'node:fs';
import type { Tx } from '../../db';
import type { GameType } from '../../types';

export type BackfillTarget = {
  modId: number;
  modName: string;
  game: GameType;
  espPath: string;
  srcLang: string;
  isLocalized: boolean;
};

export type BackfillSkip = {
  modId: number;
  modName: string;
  reason: string;
};

type TargetRow = {
  id: number;
  name: string;
  game: string | null;
  abs_path: string | null;
  esp_path: string | null;
  src_lang: string | null;
  is_localized: number | null;
};

const TARGETS_SQL = `
  SELECT m.id, m.name, m.game, m.abs_path, i.esp_path, i.src_lang, i.is_localized
  FROM mods m
  LEFT JOIN LATERAL (
    SELECT esp_path, src_lang, is_localized
    FROM mod_imports
    WHERE mod_id = m.id
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
  ) i ON TRUE
  WHERE $1::int IS NULL OR m.id = $1::int
  ORDER BY m.id`;

const existingFile = (...candidates: Array<string | null>): string | null => {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/** List mods whose plugin is still on disk, plus the ones that cannot be re-scanned. */
export const listBackfillTargets = async (
  db: Tx,
  modId?: number | null,
): Promise<{ targets: BackfillTarget[]; skipped: BackfillSkip[] }> => {
  const { rows } = await db.query<TargetRow>(TARGETS_SQL, [modId ?? null]);
  const targets: BackfillTarget[] = [];
  const skipped: BackfillSkip[] = [];

  for (const row of rows) {
    const espPath = existingFile(row.abs_path, row.esp_path);
    if (!espPath) {
      skipped.push({
        modId: row.id,
        modName: row.name,
        reason:
          row.abs_path || row.esp_path
            ? 'plugin file missing on disk'
            : 'not imported from a plugin',
      });
      continue;
    }
    targets.push({
      modId: row.id,
      modName: row.name,
      game: (row.game as GameType) ?? 'fo4',
      espPath,
      srcLang: row.src_lang ?? 'en',
      isLocalized: (row.is_localized ?? 0) === 1,
    });
  }

  return { targets, skipped };
};
