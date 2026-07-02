import { describe, it, expect } from '@jest/globals';
import {
  buildGlossaryFixSuggestion,
  findGlossaryViolation,
  resolveGlossaryFixSuggestion,
} from '../glossaryVerify';

describe('glossaryVerify', () => {
  const glossary = [{ term: 'Layer Handle', translation: 'Обробник шару' }];

  it('detects missing canonical term in numbered series', () => {
    const violation = findGlossaryViolation('Layer Handle - 4', 'Ручка шару 4', glossary);
    expect(violation).toEqual({ term: 'Layer Handle', translation: 'Обробник шару' });
  });

  it('accepts canonical numbered translation', () => {
    expect(findGlossaryViolation('Layer Handle - 2', 'Обробник шару — 2', glossary)).toBeNull();
  });

  it('builds numbered dash fix and keeps translated parenthetical', () => {
    expect(
      buildGlossaryFixSuggestion(
        'Layer Handle - 4 (Invisible)',
        'Ручка шару 4 (невидима)',
        'Layer Handle',
        'Обробник шару',
      ),
    ).toBe('Обробник шару — 4 (невидима)');
  });

  it('resolves fix suggestion from glossary entries', () => {
    expect(resolveGlossaryFixSuggestion('Layer Handle - 10', 'Ручка шару 10', glossary)).toBe(
      'Обробник шару — 10',
    );
  });
});
