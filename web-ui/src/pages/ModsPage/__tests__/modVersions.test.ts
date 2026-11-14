import { describe, expect, it } from 'vitest';
import type { Mod } from '../../../api';
import { formatModDisplayName, groupModVersions } from '../modVersions';

const mod = (partial: Partial<Mod> & Pick<Mod, 'id' | 'name'>): Mod => ({
  abs_path: '',
  version_hash: String(partial.id),
  game: 'fo4',
  nexus_mod_id: null,
  nexus_name: null,
  nexus_thumbnail: null,
  created_at: '2026-01-01T00:00:00.000Z',
  record_count: 0,
  string_count: 0,
  translated_count: 0,
  approved_count: 0,
  fuzzy_count: 0,
  is_current: true,
  content_kind: 'mod',
  content_kind_manual: false,
  ...partial,
});

describe('formatModDisplayName', () => {
  it('appends the version label', () => {
    expect(formatModDisplayName({ name: 'Fallout4', version_label: '1.11.240.0' })).toBe(
      'Fallout4 · 1.11.240.0',
    );
  });

  it('keeps the bare name when there is no version', () => {
    expect(formatModDisplayName({ name: 'FallUI - HUD' })).toBe('FallUI - HUD');
  });
});

describe('groupModVersions', () => {
  it('nests older siblings under the current version', () => {
    const current = mod({
      id: 2,
      name: 'FallUI - Inventory',
      nexus_mod_id: 48758,
      version_label: '2.2.1',
      is_current: true,
      created_at: '2026-02-01T00:00:00.000Z',
    });
    const old = mod({
      id: 1,
      name: 'FallUI - Inventory',
      nexus_mod_id: 48758,
      version_label: '2.1.0',
      is_current: false,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(groupModVersions([old, current])).toEqual([{ current, previous: [old] }]);
  });

  // FallUI ships several plugins in one folder: same Nexus id, separate mods.
  it('keeps plugins that share a Nexus id apart', () => {
    const inventory = mod({
      id: 1,
      name: 'FallUI - Inventory',
      nexus_mod_id: 48758,
      vortex_plugin: 'fallui - inventory.esp',
    });
    const vrPatch = mod({
      id: 2,
      name: 'FallUI - VR-Patch',
      nexus_mod_id: 48758,
      vortex_plugin: 'fallui - vr-patch.esp',
    });
    expect(groupModVersions([inventory, vrPatch])).toEqual([
      { current: inventory, previous: [] },
      { current: vrPatch, previous: [] },
    ]);
  });

  it('never folds the same plugin from different sources into one family', () => {
    const manual = mod({ id: 1, name: 'Workshop Plus', vortex_plugin: 'workshopplus.esp' });
    const vortex = mod({
      id: 2,
      name: 'Workshop Plus',
      vortex_plugin: 'workshopplus.esp',
      vortex_group_id: 1,
    });
    const otherGroup = mod({
      id: 3,
      name: 'Workshop Plus',
      vortex_plugin: 'workshopplus.esp',
      vortex_group_id: 2,
    });
    expect(groupModVersions([manual, vortex, otherGroup])).toEqual([
      { current: manual, previous: [] },
      { current: vortex, previous: [] },
      { current: otherGroup, previous: [] },
    ]);
  });

  it('keeps the order of the input list', () => {
    const b = mod({ id: 1, name: 'B' });
    const a = mod({ id: 2, name: 'A' });
    expect(groupModVersions([b, a]).map((g) => g.current.id)).toEqual([1, 2]);
  });

  it('nests versions of one plugin even when the Nexus id changed', () => {
    const current = mod({
      id: 2,
      name: 'Workshop Plus',
      nexus_mod_id: 1234,
      vortex_plugin: 'workshopplus.esp',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    const old = mod({
      id: 1,
      name: 'Workshop Plus',
      vortex_plugin: 'WorkshopPlus.esp',
      is_current: false,
    });
    expect(groupModVersions([old, current])).toEqual([{ current, previous: [old] }]);
  });
});
