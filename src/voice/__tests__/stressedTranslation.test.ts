import {
  effectiveStressedTranslation,
  isStressedTranslationCurrent,
  stripStressMarks,
  stressedMatchesSource,
} from '../stressedTranslation';

describe('stripStressMarks', () => {
  it('removes combining acute accents', () => {
    expect(stripStressMarks('Я не мо\u0301жу')).toBe('Я не можу');
  });
});

describe('stressedMatchesSource', () => {
  it('accepts source with only stress marks added', () => {
    expect(stressedMatchesSource('Приві\u0301т', 'Привіт')).toBe(true);
  });

  it('rejects spelling drift', () => {
    expect(stressedMatchesSource('Мени\u0301', 'Мені')).toBe(false);
    expect(stressedMatchesSource('У ци\u0301м мі\u0301сті', 'У цьому місті')).toBe(false);
  });

  it('rejects whitespace drift', () => {
    expect(stressedMatchesSource('єкі\u0301лька', 'є кілька')).toBe(false);
  });
});

describe('isStressedTranslationCurrent / effectiveStressedTranslation', () => {
  it('requires matching stress_src snapshot', () => {
    const row = {
      translation: 'Привіт',
      textStressed: 'Приві\u0301т',
      stressSrcText: 'Старий',
    };
    expect(isStressedTranslationCurrent(row)).toBe(false);
    expect(effectiveStressedTranslation(row)).toBeNull();
  });

  it('rejects letter drift even when stress_src matches', () => {
    const row = {
      translation: 'Мені не подобається',
      textStressed: 'Мени\u0301 не подоба\u0301ється',
      stressSrcText: 'Мені не подобається',
    };
    expect(isStressedTranslationCurrent(row)).toBe(false);
    expect(effectiveStressedTranslation(row)).toBeNull();
  });

  it('returns stressed text when current', () => {
    const stressed = 'Приві\u0301т';
    const row = {
      translation: 'Привіт',
      textStressed: stressed,
      stressSrcText: 'Привіт',
    };
    expect(isStressedTranslationCurrent(row)).toBe(true);
    expect(effectiveStressedTranslation(row)).toBe(stressed);
  });
});
