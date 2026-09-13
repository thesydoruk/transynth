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
});
