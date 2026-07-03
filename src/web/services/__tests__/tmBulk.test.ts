import { tmConfidenceForMethod, tmProvenanceForMethod } from '../tmBulk';

describe('tmProvenanceForMethod', () => {
  it('maps match methods to tm_auto_* provenance', () => {
    expect(tmProvenanceForMethod('anchor')).toBe('tm_auto_anchor');
    expect(tmProvenanceForMethod('edid')).toBe('tm_auto_edid');
    expect(tmProvenanceForMethod('text_norm')).toBe('tm_auto_text_norm');
  });
});

describe('tmConfidenceForMethod', () => {
  it('assigns descending confidence by method priority', () => {
    expect(tmConfidenceForMethod('anchor')).toBe(0.95);
    expect(tmConfidenceForMethod('edid')).toBe(0.85);
    expect(tmConfidenceForMethod('text_norm')).toBe(0.75);
  });
});
