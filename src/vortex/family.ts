/**
 * Which `mods` rows are versions of one Vortex mod.
 *
 * A plugin takes one load-order slot in a group, so its file name names the
 * mod even when Vortex renames the folder or several plugins share a folder
 * (and so a Nexus id). A mod without a plugin anchor keeps the older key: the
 * Nexus id, else the lower-cased name. The channel is always part of the family.
 */
import { isPlugin } from '../import/mod/discovery';

/** Lower-cased plugin file name of a path, or null when it is not a plugin. */
export const vortexPluginKey = (filePath: string | null | undefined): string | null => {
  if (!filePath) return null;
  const base = filePath.split(/[\\/]/).pop() ?? '';
  return base && isPlugin(base) ? base.toLowerCase() : null;
};

const familyKeySql = (plugin: string, nexusModId: string, name: string): string =>
  `COALESCE('p:' || lower(${plugin}), 'n:' || ${nexusModId}::text, 'm:' || lower(${name}))`;

/** SQL family key of the `mods` row aliased `alias` (channel compared apart). */
export const modFamilySql = (alias: string): string =>
  familyKeySql(`${alias}.vortex_plugin`, `${alias}.nexus_mod_id`, `${alias}.name`);

/** SQL family key built from three bound parameters: plugin, Nexus id, name. */
export const paramFamilySql = (plugin: number, nexusModId: number, name: number): string =>
  familyKeySql(`$${plugin}::text`, `$${nexusModId}::int`, `$${name}::text`);
