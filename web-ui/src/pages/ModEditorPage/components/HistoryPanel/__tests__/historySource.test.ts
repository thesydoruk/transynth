import { describe, expect, it } from 'vitest';
import { resolveHistorySource } from '../historySource';
import type { TranslationHistoryEntry } from '../../../../api';

const entry = (patch: Partial<TranslationHistoryEntry>): TranslationHistoryEntry => ({
  id: 1,
  translation_id: 2,
  text: 'text',
  status: 'auto',
  provenance: null,
  model: null,
  note: null,
  created_at: '2026-01-01T00:00:00Z',
  ...patch,
});

describe('resolveHistorySource', () => {
  it('prefers explicit note', () => {
    expect(resolveHistorySource(entry({ note: 'llm' }))).toBe('llm');
    expect(resolveHistorySource(entry({ note: 'tm' }))).toBe('tm');
  });

  it('falls back to provenance', () => {
    expect(resolveHistorySource(entry({ provenance: 'auto_generated' }))).toBe('llm');
    expect(resolveHistorySource(entry({ provenance: 'tm_auto_edid' }))).toBe('tm');
    expect(resolveHistorySource(entry({ provenance: 'propagation' }))).toBe('tm_propagation');
  });

  it('maps deleted status to clear', () => {
    expect(resolveHistorySource(entry({ status: 'deleted', note: null }))).toBe('clear');
  });
});
