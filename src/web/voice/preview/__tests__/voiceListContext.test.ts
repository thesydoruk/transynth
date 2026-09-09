import type { Tx } from '../../../../db';
import { loadVoiceListRevision } from '../voiceListContext';

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
