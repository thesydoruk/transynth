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
    `INSERT INTO mods(name, abs_path, version_hash, game, nexus_mod_id, nexus_name, origin)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual')
     ON CONFLICT (name, version_hash) WHERE vortex_group_id IS NULL DO UPDATE SET
       abs_path = EXCLUDED.abs_path,
       game = EXCLUDED.game,
       nexus_mod_id = COALESCE(EXCLUDED.nexus_mod_id, mods.nexus_mod_id),
       nexus_name = COALESCE(EXCLUDED.nexus_name, mods.nexus_name)
     RETURNING id`,
    [name, absPath, versionHash, game, nexus?.nexusModId ?? null, nexus?.nexusName ?? null],
  );
  return rows[0].id;
};

export const upsertVortexMod = async (
  db: Tx,
  params: {
    name: string;
    absPath: string;
    versionHash: string;
    game: GameType;
    groupId: number;
    channel: 'mods' | 'game';
    gameReleaseId?: number | null;
    versionLabel?: string | null;
    nexus?: { nexusModId?: number; nexusName?: string };
  },
): Promise<number> => {
  log.debug(`DB: upsertVortexMod name=${params.name} group=${params.groupId}`);
  const { rows } = await db.query(
    `INSERT INTO mods(
       name, abs_path, version_hash, game, nexus_mod_id, nexus_name,
       origin, vortex_group_id, channel, game_release_id, version_label
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'vortex', $7, $8, $9, $10)
     ON CONFLICT (vortex_group_id, name, version_hash) WHERE vortex_group_id IS NOT NULL
     DO UPDATE SET
       abs_path = EXCLUDED.abs_path,
       game = EXCLUDED.game,
       channel = EXCLUDED.channel,
       game_release_id = COALESCE(EXCLUDED.game_release_id, mods.game_release_id),
       nexus_mod_id = COALESCE(EXCLUDED.nexus_mod_id, mods.nexus_mod_id),
       nexus_name = COALESCE(EXCLUDED.nexus_name, mods.nexus_name),
       version_label = COALESCE(EXCLUDED.version_label, mods.version_label)
     RETURNING id`,
    [
      params.name,
      params.absPath,
      params.versionHash,
      params.game,
      params.nexus?.nexusModId ?? null,
      params.nexus?.nexusName ?? null,
      params.groupId,
      params.channel,
      params.gameReleaseId ?? null,
      params.versionLabel ?? null,
    ],
  );
  return rows[0].id;
};
