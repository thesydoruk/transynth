import { tmRevisionNoteForProvenance } from '../translationRevisions';

describe('tmRevisionNoteForProvenance', () => {
  it('maps propagation provenance to tm_propagation note', () => {
    expect(tmRevisionNoteForProvenance('propagation')).toBe('tm_propagation');
  });

  it('maps TM auto provenance to tm note', () => {
    expect(tmRevisionNoteForProvenance('tm_auto_anchor')).toBe('tm');
  });
});
