import { pickAnalyzeCandidates, type ClipCandidate } from '../import/clipCandidates';

describe('pickAnalyzeCandidates', () => {
  it('prefers duration near 6s', () => {
    const candidates: ClipCandidate[] = [
      { id: 'a', audioPath: 'a', durationSec: 9, transcript: 'a', upVotes: 10 },
      { id: 'b', audioPath: 'b', durationSec: 6.1, transcript: 'b', upVotes: 1 },
      { id: 'c', audioPath: 'c', durationSec: 4, transcript: 'c', upVotes: 5 },
    ];
    expect(pickAnalyzeCandidates(candidates)[0]?.id).toBe('b');
  });
});
