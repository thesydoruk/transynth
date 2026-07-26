import { inferNarratorGenderHeuristic } from '../narratorGenderHeuristics';
import { narratorToSpeakerGender, parseNarratorGender } from '../narratorGender';
import { mergeNarratorGender } from '../../web/llm/translateBatch/mergeNarratorGender';

describe('inferNarratorGenderHeuristic', () => {
  it('detects female from body references', () => {
    const hit = inferNarratorGenderHeuristic({
      source: 'I looked at my breasts and felt nervous.',
      edid: null,
    });
    expect(hit?.gender).toBe('female');
  });

  it('defers first-person diary entries to LLM', () => {
    const hit = inferNarratorGenderHeuristic({
      source: 'I had no idea what I was getting into.',
      edid: 'DP_RoxyDiaryTerminal',
      signature: 'BOOK',
    });
    expect(hit).toBeNull();
  });

  it('returns neutral for impersonal TERM entries', () => {
    const hit = inferNarratorGenderHeuristic({
      source: 'The Commonwealth is a dangerous place.',
      edid: 'SomeBook',
      signature: 'TERM',
    });
    expect(hit?.gender).toBe('neutral');
  });
});

describe('mergeNarratorGender', () => {
  it('applies narrator gender for TERM records', () => {
    const merged = mergeNarratorGender(
      {
        speakerName: null,
        speakerGender: 'unknown',
        addresseeName: null,
        addresseeGender: 'unknown',
      },
      'female',
      'TERM',
    );
    expect(merged.speakerGender).toBe('female');
  });

  it('does not override INFO dialog gender', () => {
    const merged = mergeNarratorGender(
      {
        speakerName: 'Preston',
        speakerGender: 'male',
        addresseeName: 'Player',
        addresseeGender: 'any',
      },
      'female',
      'INFO',
    );
    expect(merged.speakerGender).toBe('male');
  });
});

describe('narratorToSpeakerGender', () => {
  it('maps definite genders only', () => {
    expect(narratorToSpeakerGender(parseNarratorGender('female'))).toBe('female');
    expect(narratorToSpeakerGender(parseNarratorGender('neutral'))).toBeNull();
  });
});
