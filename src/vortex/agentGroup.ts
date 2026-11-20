/**
 * The group an agent's request lands in. A computer joins a group that exists
 * (its own, or one its `group` setting names) or, the first time it is seen,
 * starts one. It never starts a second: a changed `group` setting or a moved
 * staging folder would otherwise make an empty group and upload the whole load
 * order into it again.
 */
import type { Tx } from '../db';
import type { GameId } from '../types';
import { getOrCreateVortexGroup, getVortexGroupByKey, type VortexGroupRow } from './db';

export type AgentGroupRequest = {
  game: GameId;
  groupKey: string;
  label: string;
  stagingPath: string;
  gameDir: string;
  /** The machine asking; a request that names none is not checked. */
  agentKey?: string | null;
};

export type AgentGroupResult = { group: VortexGroupRow } | { refused: string; groupId: number };

/** The group of this game the machine already syncs into, the one it was seen in last. */
const findMachineGroup = async (
  db: Tx,
  game: string,
  agentKey: string,
): Promise<VortexGroupRow | undefined> => {
  const { rows } = await db.query<VortexGroupRow>(
    `SELECT g.id, g.game, g.group_key, g.label, g.staging_path, g.game_dir
     FROM vortex_agents a
     JOIN vortex_groups g ON g.id = a.vortex_group_id
     WHERE g.game = $1 AND a.agent_key = $2
     ORDER BY a.last_seen_at DESC, g.id DESC
     LIMIT 1`,
    [game, agentKey],
  );
  return rows[0];
};

export const resolveAgentGroup = async (
  db: Tx,
  req: AgentGroupRequest,
): Promise<AgentGroupResult> => {
  const agentKey = typeof req.agentKey === 'string' ? req.agentKey.trim() : '';
  if (agentKey && !(await getVortexGroupByKey(db, req.game, req.groupKey))) {
    const home = await findMachineGroup(db, req.game, agentKey);
    if (home) {
      // The key is `<game>:<anchor>`: the anchor is what the `group` setting takes.
      const anchor = home.group_key.slice(home.game.length + 1);
      return {
        groupId: home.id,
        refused:
          `This computer (${agentKey}) already syncs into "${home.label}" (group #${home.id}); ` +
          `a second group would upload everything again. To keep syncing into it, set "group" ` +
          `to "${anchor}" in the agent's settings. To start a new group instead, remove this ` +
          `machine from group #${home.id} first.`,
      };
    }
  }
  return {
    group: await getOrCreateVortexGroup(db, {
      game: req.game,
      groupKey: req.groupKey,
      label: req.label,
      stagingPath: req.stagingPath,
      gameDir: req.gameDir,
    }),
  };
};
