import { inferNarratorGenderHeuristic } from '../narratorGenderHeuristics';
import {
  isNarratorGenderTrusted,
  narratorToSpeakerGender,
  parseNarratorGender,
} from '../narratorGender';
import { mergeNarratorGender } from '../../../worker/src/jobs/translate/batch/mergeNarratorGender';

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
      false,
    );
    expect(merged.speakerGender).toBe('female');
  });

  it('does not override the gender of a spoken line', () => {
    const merged = mergeNarratorGender(
      {
        speakerName: 'Preston',
        speakerGender: 'male',
        addresseeName: 'Player',
        addresseeGender: 'any',
      },
      'female',
      true,
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

describe('isNarratorGenderTrusted', () => {
  it('trusts a gender a person set by hand', () => {
    expect(isNarratorGenderTrusted('manual', null)).toBe(true);
  });

  it('trusts an override whatever produced the underlying guess', () => {
    expect(isNarratorGenderTrusted('heuristic', 'female')).toBe(true);
    expect(isNarratorGenderTrusted(null, 'male')).toBe(true);
  });

  it('does not trust an inference', () => {
    // The heuristic labelled Piper Wright's own article male on the real corpus.
    expect(isNarratorGenderTrusted('heuristic', null)).toBe(false);
    expect(isNarratorGenderTrusted('llm', null)).toBe(false);
    expect(isNarratorGenderTrusted('edid', null)).toBe(false);
  });

  it('does not trust a missing or blank answer', () => {
    expect(isNarratorGenderTrusted(null, null)).toBe(false);
    expect(isNarratorGenderTrusted(undefined, undefined)).toBe(false);
    expect(isNarratorGenderTrusted('heuristic', '   ')).toBe(false);
  });
});
