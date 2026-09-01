import { describe, expect, it } from '@jest/globals';
import { extractDiscoQuotedSpeech, hasDiscoNarrationOutsideQuotes } from '../discoSpokenText';

describe('extractDiscoQuotedSpeech', () => {
  it('returns null for quote-free narration', () => {
    expect(extractDiscoQuotedSpeech('Your key no longer turns in the lock.')).toBeNull();
  });

  it('extracts ASCII double-quoted speech', () => {
    expect(extractDiscoQuotedSpeech('She gathers herself for a moment, then says, "Okay."')).toBe(
      'Okay.',
    );
  });

  it('joins multiple quoted segments in order', () => {
    expect(extractDiscoQuotedSpeech('"Foo," he says, "bar."')).toBe('Foo, bar.');
  });

  it('supports typographic and guillemet quotes (translations)', () => {
    expect(extractDiscoQuotedSpeech('Вона каже: «Гаразд».')).toBe('Гаразд');
    expect(extractDiscoQuotedSpeech('He mumbles: “What...?”')).toBe('What...?');
  });
});

describe('hasDiscoNarrationOutsideQuotes', () => {
  it('is false when the whole line is one quote', () => {
    expect(hasDiscoNarrationOutsideQuotes('"Nah, I\'ll get by somehow."')).toBe(false);
  });

  it('is false without quotes', () => {
    expect(hasDiscoNarrationOutsideQuotes('Punch the door.')).toBe(false);
  });

  it('is true for narration followed by speech', () => {
    expect(hasDiscoNarrationOutsideQuotes('He nods. "Yes, we both need rest."')).toBe(true);
  });

  it('ignores bare punctuation outside quotes', () => {
    expect(hasDiscoNarrationOutsideQuotes('"Foo," -- "bar."')).toBe(false);
  });
});
