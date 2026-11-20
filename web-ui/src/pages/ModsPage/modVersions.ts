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

const onMachine = (mod: Mod): boolean => (mod.machines?.length ?? 0) > 0;

/**
 * Current version first; older siblings of the same source / plugin / Nexus id / name go
 * under it. Families keep the order their current version has in `mods`, so the caller
 * decides how the list is sorted.
 *
 * Two Vortex machines may run different versions of one mod: each of those is in use, so
 * each gets a row of its own, and the versions no machine holds go under the newest.
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
    const alsoInUse = sorted.filter(
      (mod) => mod.id !== current.id && mod.is_current !== false && onMachine(mod),
    );
    const heads = onMachine(current) ? [current, ...alsoInUse] : [current];
    const previous = sorted.filter((mod) => !heads.includes(mod));
    groups.push({ current, previous });
    for (const head of heads.slice(1)) groups.push({ current: head, previous: [] });
  }

  return groups.sort((a, b) => position.get(a.current.id)! - position.get(b.current.id)!);
};
