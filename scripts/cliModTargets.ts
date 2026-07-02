import type { Tx } from '../src/db';
import { CONFIG } from '../src/config';
import type { GameType } from '../src/types';

export type CliModTarget = {
  modId: number;
  modName: string;
  game: GameType;
  srcLang: string;
};

export type CliModSelector = {
  all?: boolean;
  modId?: string;
  modName?: string;
  srcLang?: string;
};

export const parseModIds = (raw: string | undefined): number[] | undefined => {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    throw new Error('--mod-id must list one or more positive integers');
  }
  return ids;
};

export const formatPct = (done: number, total: number): string => {
  if (total <= 0) return '0%';
  return `${Math.round((done / total) * 100)}%`;
};

export const assertCliModSelector = (args: CliModSelector): void => {
  const hasTarget = args.all || args.modId || args.modName;
  if (!hasTarget) {
    throw new Error('Specify --mod-id, --mod-name, or --all');
  }
  if (args.all && (args.modId || args.modName)) {
    throw new Error('Use either --all or a single-mod selector, not both');
  }
  if (args.modId && args.modName) {
    throw new Error('Use either --mod-id or --mod-name, not both');
  }
};

const listAllModTargets = async (
  db: Tx,
  srcLangOverride: string | undefined,
): Promise<CliModTarget[]> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    game: string;
    src_lang: string | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.src_lang
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE mi.status = 'completed'
       AND mi.mod_id IS NOT NULL
     ORDER BY m.id, mi.updated_at DESC`,
  );

  return rows.map((row) => ({
    modId: row.mod_id,
    modName: row.mod_name,
    game: row.game as GameType,
    srcLang: srcLangOverride ?? row.src_lang?.trim() ?? CONFIG.defaultSrcLang,
  }));
};

export const resolveCliModTargets = async (
  db: Tx,
  selector: CliModSelector,
): Promise<CliModTarget[]> => {
  assertCliModSelector(selector);
  const srcLangOverride = selector.srcLang?.trim() || undefined;

  if (selector.all) {
    return listAllModTargets(db, srcLangOverride);
  }

  let modIds: number[];
  if (selector.modName) {
    const name = selector.modName.trim();
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM mods WHERE name ILIKE $1 ORDER BY id LIMIT 2`,
      [name],
    );
    if (rows.length === 0) throw new Error(`Mod not found: "${name}"`);
    if (rows.length > 1) throw new Error(`Multiple mods match "${name}" — use --mod-id`);
    modIds = [rows[0]!.id];
  } else {
    modIds = parseModIds(selector.modId) ?? [];
  }

  const targets: CliModTarget[] = [];
  for (const modId of modIds) {
    const { rows } = await db.query<{
      mod_id: number;
      mod_name: string;
      game: string;
      src_lang: string | null;
    }>(
      `SELECT m.id AS mod_id,
              m.name AS mod_name,
              COALESCE(m.game, mi.game, 'fo4') AS game,
              mi.src_lang
       FROM mods m
       LEFT JOIN LATERAL (
         SELECT game, src_lang
           FROM mod_imports
          WHERE mod_id = m.id AND status = 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
       ) mi ON TRUE
       WHERE m.id = $1`,
      [modId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Mod id=${modId} not found`);
    targets.push({
      modId: row.mod_id,
      modName: row.mod_name,
      game: row.game as GameType,
      srcLang: srcLangOverride ?? row.src_lang?.trim() ?? CONFIG.defaultSrcLang,
    });
  }
  return targets;
};
