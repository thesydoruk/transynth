import { describe, it, expect } from '@jest/globals';
import { detectSkipHeuristic, stripPlaceholdersForSkipCheck } from '../skipTranslateHeuristics';

describe('stripPlaceholdersForSkipCheck', () => {
  it('removes game placeholders', () => {
    expect(stripPlaceholdersForSkipCheck('Hello ¤PH0¤ world')).toBe('Hello  world');
  });
});

describe('detectSkipHeuristic', () => {
  it('flags placeholder-only strings', () => {
    expect(detectSkipHeuristic('¤PH0¤')?.reason).toMatch(/placeholder/i);
  });

  it('flags numeric-only strings', () => {
    expect(detectSkipHeuristic('+15%')?.reason).toMatch(/Numeric/i);
  });

  it('flags source matching edid', () => {
    expect(detectSkipHeuristic('MyRecord01', { edid: 'MyRecord01' })?.reason).toMatch(/editor ID/i);
  });

  it('returns null for normal dialogue', () => {
    expect(detectSkipHeuristic('Hello, wanderer.')).toBeNull();
  });
});
