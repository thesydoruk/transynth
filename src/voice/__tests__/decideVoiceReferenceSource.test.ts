import {
  decideVoiceReferenceSource,
  isLineReferenceSuitable,
  type VoiceReferenceSourceDecision,
} from '../decideVoiceReferenceSource';

jest.mock('../speakerReference/scoring', () => ({
  scoreReferenceWav: jest.fn(),
}));

const { scoreReferenceWav } = jest.requireMock('../speakerReference/scoring') as {
  scoreReferenceWav: jest.Mock;
};

describe('decideVoiceReferenceSource', () => {
  it('uses speaker mode whenever project mode is speaker', () => {
    expect(decideVoiceReferenceSource('speaker', true)).toEqual({
      kind: 'speaker',
      reason: 'mode',
    });
    expect(decideVoiceReferenceSource('speaker', false)).toEqual({
      kind: 'speaker',
      reason: 'mode',
    });
  });

  it('keeps line mode when the line clip is suitable', () => {
    expect(decideVoiceReferenceSource('line', true)).toEqual({ kind: 'line' });
  });

  it('falls back to speaker when the line is unsuitable', () => {
    const decision: VoiceReferenceSourceDecision = decideVoiceReferenceSource('line', false);
    expect(decision).toEqual({ kind: 'speaker', reason: 'line_unsuitable' });
  });
});

describe('isLineReferenceSuitable', () => {
  it('rejects clips scored as unsuitable', () => {
    scoreReferenceWav.mockReturnValue(Number.NEGATIVE_INFINITY);
    expect(isLineReferenceSuitable('/tmp/short.wav')).toBe(false);
  });

  it('accepts finite reference scores', () => {
    scoreReferenceWav.mockReturnValue(6.5);
    expect(isLineReferenceSuitable('/tmp/ok.wav')).toBe(true);
  });
});
