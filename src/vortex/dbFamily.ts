/** Version families of Vortex mods: plan targets, carry sources, the current version. */
import type { Tx } from '../db';
import { modFamilySql, paramFamilySql, vortexPluginKey } from './family';
import { scopedVortexFileHash } from './groupKey';
import type { VortexPlanPayload, VortexPlanUnit } from './types';

export const planVortexUnits = async (
  db: Tx,
  groupId: number,
  payload: VortexPlanPayload,
): Promise<VortexPlanUnit[]> => {
  const planned: VortexPlanUnit[] = [];
  for (const unit of payload.units) {
    const scoped = scopedVortexFileHash(groupId, unit.contentHash);
    // A folder with several plugins has one job per plugin, `<scoped>:<stem>`.
    const { rows: jobs } = await db.query<{ id: number; mod_id: number | null; status: string }>(
      `SELECT id, mod_id, status FROM mod_imports
       WHERE file_hash = $1 OR starts_with(file_hash, $1 || ':')
       ORDER BY import_extras DESC, id`,
      [scoped],
    );
    const job = jobs[0];
    const meta = {
      pluginStem: unit.pluginStem,
      pluginFileName: unit.pluginFileName,
      ...(unit.plugins ? { plugins: unit.plugins } : {}),
      sourceFolder: unit.sourceFolder,
      nexusModId: unit.nexusModId,
      nexusModName: unit.nexusModName,
    };
    if (job && jobs.every((row) => row.status === 'completed' && row.mod_id)) {
      planned.push({
        unitId: unit.unitId,
        action: 'skip',
        channel: unit.channel,
        name: unit.name,
        contentHash: unit.contentHash,
        scopedFileHash: scoped,
        existingModId: job.mod_id,
        existingJobId: job.id,
        existingModIds: jobs.map((row) => row.mod_id!),
        ...meta,
      });
      continue;
    }

    const { rows: prev } = await db.query<{ id: number }>(
      `SELECT m.id FROM mods m
       WHERE m.vortex_group_id = $1
         AND m.channel IS NOT DISTINCT FROM $2
         AND m.version_hash <> $3
         AND ${modFamilySql('m')} = ${paramFamilySql(4, 5, 6)}
       ORDER BY m.created_at DESC LIMIT 1`,
      [
        groupId,
        unit.channel,
        unit.contentHash,
        vortexPluginKey(unit.pluginFileName),
        unit.nexusModId || null,
        unit.name,
      ],
    );

    planned.push({
      unitId: unit.unitId,
      action: prev[0] ? 'update' : 'upload',
      channel: unit.channel,
      name: unit.name,
      contentHash: unit.contentHash,
      scopedFileHash: scoped,
      existingModId: prev[0]?.id ?? job?.mod_id ?? null,
      existingJobId: job?.id ?? null,
      ...meta,
    });
  }
  return planned;
};

/**
 * The newest other version of a mod, to carry translations from. A mod without
 * a plugin also falls back to a plugin-less row of the same name, so a folder
 * that gained a Nexus id still finds the version imported before it.
 */
export const findPreviousVortexMod = async (
  db: Tx,
  params: { groupId: number; newModId: number },
): Promise<number | null> => {
  const sameFamily = `${modFamilySql('p')} = ${modFamilySql('n')}`;
  const { rows } = await db.query<{ id: number }>(
    `SELECT p.id
     FROM mods n
     JOIN mods p
       ON p.vortex_group_id = n.vortex_group_id
      AND p.channel IS NOT DISTINCT FROM n.channel
      AND p.id <> n.id
      AND (${sameFamily}
           OR (n.vortex_plugin IS NULL AND p.vortex_plugin IS NULL
               AND lower(p.name) = lower(n.name)))
     WHERE n.vortex_group_id = $1 AND n.id = $2
     ORDER BY (${sameFamily}) DESC, p.created_at DESC
     LIMIT 1`,
    [params.groupId, params.newModId],
  );
  return rows[0]?.id ?? null;
};

/** Mark staging-present mods as current; older siblings in the same family stay archived. */
export const markCurrentVortexMods = async (
  db: Tx,
  groupId: number,
  presentModIds: number[],
): Promise<void> => {
  if (presentModIds.length === 0) return;
  await db.query(
    `WITH present AS (
       SELECT id, vortex_plugin, nexus_mod_id, name, channel, created_at
       FROM mods
       WHERE vortex_group_id = $1 AND id = ANY($2::int[])
     ),
     newest AS (
       SELECT DISTINCT ON (${modFamilySql('p')}, COALESCE(p.channel, '')) p.id
       FROM present p
       ORDER BY ${modFamilySql('p')}, COALESCE(p.channel, ''), p.created_at DESC
     ),
     siblings AS (
       SELECT m.id
       FROM mods m
       JOIN present p
         ON ${modFamilySql('m')} = ${modFamilySql('p')}
        AND m.channel IS NOT DISTINCT FROM p.channel
       WHERE m.vortex_group_id = $1
     )
     UPDATE mods m SET is_current = (m.id IN (SELECT id FROM newest))
     WHERE m.id IN (SELECT id FROM siblings)`,
    [groupId, presentModIds],
  );
};
