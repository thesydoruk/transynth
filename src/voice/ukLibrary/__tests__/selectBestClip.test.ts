import { pickAnalyzeCandidates, type ClipCandidate } from '../import/clipCandidates';

describe('pickAnalyzeCandidates', () => {
  it('prefers duration near 6s when phoneme coverage is equal', () => {
    const candidates: ClipCandidate[] = [
      {
        id: 'a',
        audioPath: 'a',
        durationSec: 9,
        transcript: 'Однак село таке тихе, коли люди сидять удома.',
        upVotes: 10,
      },
      {
        id: 'b',
        audioPath: 'b',
        durationSec: 6.1,
        transcript: 'Однак село таке тихе, коли люди сидять удома.',
        upVotes: 1,
      },
      {
        id: 'c',
        audioPath: 'c',
        durationSec: 4,
        transcript: 'Однак село таке тихе, коли люди сидять удома.',
        upVotes: 5,
      },
    ];
    expect(pickAnalyzeCandidates(candidates)[0]?.id).toBe('b');
  });
});
