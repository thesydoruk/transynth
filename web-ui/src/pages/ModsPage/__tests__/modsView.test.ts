import { describe, expect, it } from 'vitest';
import type { Mod } from '../../../api';
import {
  DEFAULT_MODS_VIEW,
  aggregateProgress,
  filterMods,
  groupMods,
  modStatus,
  parseModsView,
  sortGameContent,
  splitAddons,
  splitByContent,
  writeModsView,
  type ModsView,
} from '../modsView';

const mod = (partial: Partial<Mod> & Pick<Mod, 'id' | 'name'>): Mod => ({
  abs_path: '',
  version_hash: String(partial.id),
  game: 'fo4',
  nexus_mod_id: null,
  nexus_name: null,
  nexus_thumbnail: null,
  created_at: '2026-01-01T00:00:00.000Z',
  record_count: 0,
  string_count: 100,
  translated_count: 0,
  approved_count: 0,
  fuzzy_count: 0,
  is_current: true,
  content_kind: 'mod',
  content_kind_manual: false,
  vortex_group_id: null,
  ...partial,
});

const view = (patch: Partial<ModsView>): ModsView => ({ ...DEFAULT_MODS_VIEW, ...patch });
const ids = (mods: Array<{ id: number }>) => mods.map((m) => m.id);

describe('modStatus', () => {
  it('is todo while something is untranslated', () => {
    expect(modStatus(mod({ id: 1, name: 'A', translated_count: 99 }))).toBe('todo');
  });

  it('is review when all is translated but not all approved', () => {
    expect(modStatus(mod({ id: 1, name: 'A', translated_count: 100, approved_count: 99 }))).toBe(
      'review',
    );
  });

  it('is done when everything is approved', () => {
    expect(modStatus(mod({ id: 1, name: 'A', translated_count: 100, approved_count: 100 }))).toBe(
      'done',
    );
  });

  it('treats a mod without strings as todo', () => {
    expect(modStatus(mod({ id: 1, name: 'A', string_count: 0 }))).toBe('todo');
  });
});

describe('parseModsView / writeModsView', () => {
  it('reads defaults from an empty query', () => {
    expect(parseModsView(new URLSearchParams())).toEqual(DEFAULT_MODS_VIEW);
  });

  it('reads every parameter and ignores unknown values', () => {
    const params = new URLSearchParams('source=7&content=game&status=bogus&q=ui&group=status');
    expect(parseModsView(params)).toEqual({
      source: 7,
      content: 'game',
      status: 'all',
      q: 'ui',
      group: 'status',
    });
    expect(parseModsView(new URLSearchParams('source=manual')).source).toBe('manual');
    expect(parseModsView(new URLSearchParams('source=abc')).source).toBe('all');
  });

  it('leaves defaults out of the URL and keeps unrelated parameters', () => {
    const start = new URLSearchParams('other=1&status=todo');
    const next = writeModsView(start, { status: 'all', source: 3 });
    expect(next.toString()).toBe('other=1&source=3');
  });
});

describe('filterMods', () => {
  const mods = [
    mod({ id: 1, name: 'Fallout4', content_kind: 'base' }),
    mod({ id: 2, name: 'Workshop Plus', vortex_group_id: 5, translated_count: 100 }),
    mod({ id: 3, name: 'Hud Tweaks', translated_count: 100, approved_count: 100 }),
  ];

  it('filters by source', () => {
    expect(ids(filterMods(mods, view({ source: 'manual' })))).toEqual([1, 3]);
    expect(ids(filterMods(mods, view({ source: 5 })))).toEqual([2]);
  });

  it('filters by content', () => {
    expect(ids(filterMods(mods, view({ content: 'game' })))).toEqual([1]);
    expect(ids(filterMods(mods, view({ content: 'mods' })))).toEqual([2, 3]);
  });

  it('filters by status', () => {
    expect(ids(filterMods(mods, view({ status: 'todo' })))).toEqual([1]);
    expect(ids(filterMods(mods, view({ status: 'review' })))).toEqual([2]);
    expect(ids(filterMods(mods, view({ status: 'done' })))).toEqual([3]);
  });

  it('searches the display name case-insensitively', () => {
    expect(ids(filterMods(mods, view({ q: ' HUD ' })))).toEqual([3]);
  });

  it('keeps older versions with a matching current version', () => {
    const old = mod({ id: 4, name: 'Hud Tweaks', is_current: false, created_at: '2025-01-01' });
    expect(ids(filterMods([...mods, old], view({ status: 'done' })))).toEqual([3, 4]);
  });
});

describe('splitByContent / splitAddons', () => {
  const mods = [
    mod({ id: 1, name: 'Mod' }),
    mod({ id: 2, name: 'Far Harbor', content_kind: 'dlc' }),
    mod({ id: 3, name: 'CC Item', content_kind: 'addon' }),
    mod({ id: 4, name: 'Fallout4', content_kind: 'base' }),
  ];

  it('puts base, dlc and addon into game content', () => {
    const split = splitByContent(mods);
    expect(ids(split.game)).toEqual([2, 3, 4]);
    expect(ids(split.mods)).toEqual([1]);
  });

  it('separates add-ons from the rest of game content', () => {
    const { core, addons } = splitAddons(splitByContent(mods).game);
    expect(ids(core)).toEqual([2, 4]);
    expect(ids(addons)).toEqual([3]);
  });
});

describe('sortGameContent', () => {
  it('orders base, dlc, addon; uploads before Vortex; then by name', () => {
    const sorted = sortGameContent([
      mod({ id: 1, name: 'Zeta', content_kind: 'addon' }),
      mod({ id: 2, name: 'Alpha', content_kind: 'dlc', vortex_group_id: 1 }),
      mod({ id: 3, name: 'Beta', content_kind: 'dlc' }),
      mod({ id: 4, name: 'Fallout4', content_kind: 'base', vortex_group_id: 1 }),
      mod({ id: 5, name: 'Alpha', content_kind: 'dlc' }),
    ]);
    expect(ids(sorted)).toEqual([4, 5, 3, 2, 1]);
  });
});

describe('groupMods', () => {
  const mods = [
    mod({ id: 1, name: 'A', vortex_group_id: 9 }),
    mod({ id: 2, name: 'B' }),
    mod({ id: 3, name: 'C', vortex_group_id: 2, translated_count: 100, approved_count: 100 }),
  ];
  const label = (key: string) => `L:${key}`;

  it('returns one unlabelled group for none', () => {
    expect(groupMods(mods, 'none', label)).toEqual([{ key: 'all', mods }]);
  });

  it('groups by source: uploads first, then groups by id', () => {
    const groups = groupMods(mods, 'source', label);
    expect(groups.map((g) => [g.key, g.label, ids(g.mods)])).toEqual([
      ['manual', 'L:manual', [2]],
      ['2', 'L:2', [3]],
      ['9', 'L:9', [1]],
    ]);
  });

  it('groups by status in work order and drops empty buckets', () => {
    const groups = groupMods(mods, 'status', label);
    expect(groups.map((g) => g.key)).toEqual(['todo', 'done']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupMods([], 'source', label)).toEqual([]);
  });
});

describe('aggregateProgress', () => {
  it('sums the current version of each family only', () => {
    const current = mod({ id: 1, name: 'A', translated_count: 50, approved_count: 20 });
    const old = mod({ id: 2, name: 'A', is_current: false, created_at: '2025-01-01' });
    const other = mod({ id: 3, name: 'B', translated_count: 100, approved_count: 100 });
    const { stats } = aggregateProgress([current, old, other]);
    expect(stats.total).toBe(200);
    expect(stats.translated).toBe(150);
    expect(stats.approved).toBe(120);
  });
});
