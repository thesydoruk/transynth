import type { Tx } from '../../../../db';
import {
  CATALOG_REBUILD_MIN_INTERVAL_MS,
  canReuseCatalog,
  loadVoiceListRevision,
} from '../voiceListContext';

const mockDb = (row: {
  synth_n: string;
  synth_at: Date | string | null;
  ref_n: string;
  ref_at: Date | string | null;
}): Tx =>
  ({
    query: async () => ({ rows: [row] }),
  }) as unknown as Tx;

describe('loadVoiceListRevision', () => {
  it('fingerprints empty synthesis and refs', async () => {
    const rev = await loadVoiceListRevision(
      mockDb({ synth_n: '0', synth_at: null, ref_n: '0', ref_at: null }),
      33,
      'uk',
    );
    expect(rev).toBe('0:none:0:none');
  });

  it('changes when a take is stamped', async () => {
    const before = await loadVoiceListRevision(
      mockDb({ synth_n: '80', synth_at: '2026-09-09T19:12:00.000Z', ref_n: '1', ref_at: null }),
      33,
      'uk',
    );
    const after = await loadVoiceListRevision(
      mockDb({ synth_n: '85', synth_at: '2026-09-09T19:12:53.000Z', ref_n: '1', ref_at: null }),
      33,
      'uk',
    );
    expect(before).not.toBe(after);
  });
});

describe('canReuseCatalog', () => {
  it('reuses a build whose revision still matches, at any age', () => {
    expect(canReuseCatalog({ revision: 'r1', builtAt: 0 }, 'r1', 10_000_000)).toBe(true);
  });

  it('reuses a young build even when takes moved the revision on', () => {
    const builtAt = 1_000_000;
    expect(canReuseCatalog({ revision: 'r1', builtAt }, 'r2', builtAt + 5_000)).toBe(true);
    expect(
      canReuseCatalog({ revision: 'r1', builtAt }, 'r2', builtAt + CATALOG_REBUILD_MIN_INTERVAL_MS),
    ).toBe(false);
  });

  it('builds when nothing is cached', () => {
    expect(canReuseCatalog(undefined, 'r1', 0)).toBe(false);
  });
});
