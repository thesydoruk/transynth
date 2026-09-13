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

const familyKey = (mod: Mod): string => {
  const channel = mod.channel ?? '';
  if (mod.nexus_mod_id) return `${channel}:nexus:${mod.nexus_mod_id}`;
  return `${channel}:name:${mod.name.toLowerCase()}`;
};

const createdAt = (mod: Mod): number => {
  const ts = Date.parse(mod.created_at);
  return Number.isFinite(ts) ? ts : 0;
};

/** Current version first; older siblings of the same Nexus id / name go under it. */
export const groupModVersions = (mods: Mod[]): ModVersionGroup[] => {
  const buckets = new Map<string, Mod[]>();
  for (const mod of mods) {
    const key = familyKey(mod);
    const list = buckets.get(key);
    if (list) list.push(mod);
    else buckets.set(key, [mod]);
  }

  const groups: ModVersionGroup[] = [];
  for (const family of buckets.values()) {
    const sorted = [...family].sort((a, b) => createdAt(b) - createdAt(a));
    const current = sorted.find((mod) => mod.is_current !== false) ?? sorted[0]!;
    const previous = sorted
      .filter((mod) => mod.id !== current.id)
      .sort((a, b) => createdAt(b) - createdAt(a));
    groups.push({ current, previous });
  }

  groups.sort((a, b) => {
    if (a.current.channel === 'game' && b.current.channel !== 'game') return -1;
    if (b.current.channel === 'game' && a.current.channel !== 'game') return 1;
    return a.current.name.localeCompare(b.current.name);
  });
  return groups;
};
