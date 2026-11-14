import type { Mod } from '../../api';

export type ModVersionGroup = {
  current: Mod;
  previous: Mod[];
};

export const formatModDisplayName = (mod: {
  name: string;
  version_label?: string | null;
}): string => {
  const version = mod.version_label?.trim();
  return version ? `${mod.name} · ${version}` : mod.name;
};

// A plugin is one load-order slot, so it names the family even when the plugins
// of one Vortex folder share a Nexus id; a plugin-less mod keeps Nexus id / name.
// The Vortex group is part of the key: the same plugin uploaded by hand and synced
// from Vortex (or from two groups) is two separate mods, never two versions of one.
const familyKey = (mod: Mod): string => {
  const channel = mod.channel ?? '';
  const base = `${channel}:${mod.vortex_group_id ?? 'manual'}`;
  if (mod.vortex_plugin) return `${base}:plugin:${mod.vortex_plugin.toLowerCase()}`;
  if (mod.nexus_mod_id) return `${base}:nexus:${mod.nexus_mod_id}`;
  return `${base}:name:${mod.name.toLowerCase()}`;
};

const createdAt = (mod: Mod): number => {
  const ts = Date.parse(mod.created_at);
  return Number.isFinite(ts) ? ts : 0;
};

/**
 * Current version first; older siblings of the same source / plugin / Nexus id / name go
 * under it. Families keep the order their current version has in `mods`, so the caller
 * decides how the list is sorted.
 */
export const groupModVersions = (mods: Mod[]): ModVersionGroup[] => {
  const buckets = new Map<string, Mod[]>();
  for (const mod of mods) {
    const key = familyKey(mod);
    const list = buckets.get(key);
    if (list) list.push(mod);
    else buckets.set(key, [mod]);
  }

  const position = new Map(mods.map((mod, index) => [mod.id, index]));
  const groups: ModVersionGroup[] = [];
  for (const family of buckets.values()) {
    const sorted = [...family].sort((a, b) => createdAt(b) - createdAt(a));
    const current = sorted.find((mod) => mod.is_current !== false) ?? sorted[0]!;
    const previous = sorted
      .filter((mod) => mod.id !== current.id)
      .sort((a, b) => createdAt(b) - createdAt(a));
    groups.push({ current, previous });
  }

  return groups.sort((a, b) => position.get(a.current.id)! - position.get(b.current.id)!);
};
