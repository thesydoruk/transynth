import type { GameType } from '../types';
import { log } from '../logger';
import type { Tx } from './types';

export const upsertMod = async (
  db: Tx,
  name: string,
  absPath: string,
  versionHash: string,
  game: GameType = 'fo4',
  nexus?: { nexusModId?: number; nexusName?: string },
): Promise<number> => {
  log.debug(`DB: upsertMod name=${name} game=${game}`);
  const { rows } = await db.query(
    `INSERT INTO mods(name, abs_path, version_hash, game, nexus_mod_id, nexus_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(name, version_hash) DO UPDATE SET
       abs_path = EXCLUDED.abs_path,
       game = EXCLUDED.game,
       nexus_mod_id = COALESCE(EXCLUDED.nexus_mod_id, mods.nexus_mod_id),
       nexus_name = COALESCE(EXCLUDED.nexus_name, mods.nexus_name)
     RETURNING id`,
    [name, absPath, versionHash, game, nexus?.nexusModId ?? null, nexus?.nexusName ?? null],
  );
  return rows[0].id;
};
