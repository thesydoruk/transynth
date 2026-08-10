import path from 'node:path';
import { mergeTtsReferenceClips, speakerTextsFromClips } from '../mergeTtsReferenceClips';

describe('mergeTtsReferenceClips', () => {
  it('returns only the local clip when no UK library override', () => {
    const clips = mergeTtsReferenceClips(null, {
      wavPath: '/tmp/line.wav',
      speakerText: 'Hello.',
    });
    expect(clips).toEqual([{ wavPath: '/tmp/line.wav', speakerText: 'Hello.' }]);
  });

  it('puts UK library first, then the line/speaker clip', () => {
    const clips = mergeTtsReferenceClips(
      { wavPath: '/lib/uk.wav', speakerText: 'Український текст.' },
      { wavPath: '/tmp/line.wav', speakerText: 'Hello.' },
    );
    expect(clips.map((c) => c.wavPath)).toEqual(['/lib/uk.wav', '/tmp/line.wav']);
    expect(speakerTextsFromClips(clips)).toEqual(['Український текст.', 'Hello.']);
  });

  it('dedupes when UK and local paths resolve to the same file', () => {
    const shared = path.join('/tmp', 'same.wav');
    const clips = mergeTtsReferenceClips(
      { wavPath: shared, speakerText: 'A.' },
      { wavPath: shared, speakerText: 'B.' },
    );
    expect(clips).toHaveLength(1);
    expect(clips[0]?.speakerText).toBe('A.');
  });

  it('returns only the global clip when local is omitted', () => {
    const clips = mergeTtsReferenceClips({ wavPath: '/lib/uk.wav', speakerText: 'УА.' }, null);
    expect(clips).toEqual([{ wavPath: '/lib/uk.wav', speakerText: 'УА.' }]);
  });

  it('returns an empty list when both sides are omitted', () => {
    expect(mergeTtsReferenceClips(null, null)).toEqual([]);
  });
});
