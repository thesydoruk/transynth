import { describe, expect, it } from '@jest/globals';
import { vortexUnitKey } from '../groupKey';
import { findPlanUnit, unitsNeverUploaded } from '../planUnits';
import type { VortexPlanUnit } from '../types';

// A real unitId from production: 101 characters, past the router's default limit.
const LONG_ID =
  'mods:sim settlements 2 - all chapters pack 73394 3.8.1a 2026-10-27t05-48z 86dab3tia:ss2_xpac_chapter2';

const unit = (patch: Partial<VortexPlanUnit>): VortexPlanUnit => ({
  unitId: 'mods:a:a',
  action: 'upload',
  channel: 'mods',
  name: 'A',
  contentHash: 'h',
  scopedFileHash: 'v1:h',
  existingModId: null,
  existingJobId: null,
  pluginStem: null,
  pluginFileName: null,
  sourceFolder: null,
  nexusModId: null,
  nexusModName: null,
  ...patch,
});

describe('vortexUnitKey', () => {
  it('is a short hex handle that fits any URL segment', () => {
    expect(LONG_ID.length).toBeGreaterThan(100);
    expect(vortexUnitKey(LONG_ID)).toMatch(/^[0-9a-f]{16}$/);
    expect(vortexUnitKey(LONG_ID)).not.toBe(vortexUnitKey(`${LONG_ID}x`));
  });
});

describe('findPlanUnit', () => {
  const units = [{ unitId: 'mods:x:x' }, { unitId: LONG_ID }];

  it('finds a unit by its short key', () => {
    expect(findPlanUnit(units, vortexUnitKey(LONG_ID))).toBe(units[1]);
  });

  it('still finds a unit by the full id an older agent sends', () => {
    expect(findPlanUnit(units, 'mods:x:x')).toBe(units[0]);
  });

  it('finds nothing for an unknown key', () => {
    expect(findPlanUnit(units, vortexUnitKey('mods:y:y'))).toBeUndefined();
  });
});

describe('unitsNeverUploaded', () => {
  it('lists planned uploads the server neither registered nor refused', () => {
    const units = [
      unit({ unitId: 'lost', name: 'Lost' }),
      unit({ unitId: 'lost-update', action: 'update', existingModId: 5 }),
      unit({ unitId: 'registered', existingJobId: 3 }),
      unit({ unitId: 'refused', rejected: 'Archive holds no files this game can import (fo4)' }),
      unit({ unitId: 'skipped', action: 'skip', existingModId: 9 }),
    ];
    expect(unitsNeverUploaded(units).map((u) => u.unitId)).toEqual(['lost', 'lost-update']);
  });
});
