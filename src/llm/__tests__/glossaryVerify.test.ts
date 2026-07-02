import { describe, it, expect } from '@jest/globals';
import {
  buildGlossaryFixSuggestion,
  canonicalPresentInTranslation,
  findGlossaryViolation,
  isExactOrDashGlossarySource,
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

  it('accepts inflected canonical words in long text', () => {
    expect(
      findGlossaryViolation(
        'Layer Handle copy method',
        'Метод копіювання обробника шару',
        glossary,
      ),
    ).toBeNull();
  });

  it('skips RACE/FMRN compound morph labels', () => {
    const raceGlossary = [{ term: 'Blemishes', translation: 'Подразнення' }];
    expect(
      findGlossaryViolation('Blemishes Forehead 4', 'Висипи на лобі 4', raceGlossary, {
        grup: 'RACE',
        field: 'FMRN',
      }),
    ).toBeNull();
    expect(
      findGlossaryViolation('Blemishes', 'Висипи', raceGlossary, { grup: 'RACE', field: 'FMRN' }),
    ).toEqual({ term: 'Blemishes', translation: 'Подразнення' });
  });

  it('skips Workshop Plus brand name', () => {
    const wsGlossary = [{ term: 'Workshop', translation: 'Майстерня' }];
    expect(
      findGlossaryViolation('Workshop Plus: Tracking', 'Workshop Plus: Відстеження', wsGlossary),
    ).toBeNull();
  });

  it('detects exact and dash glossary sources', () => {
    expect(isExactOrDashGlossarySource('Layer Handle - 4', 'Layer Handle')).toBe(true);
    expect(isExactOrDashGlossarySource('Full Diamond', 'Full')).toBe(false);
  });

  it('matches canonical stems in inflected translation', () => {
    expect(canonicalPresentInTranslation('обробника шару', 'Обробник шару')).toBe(true);
  });
});
