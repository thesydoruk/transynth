import { findGlossaryViolation } from '../../llm/glossaryVerify';
import { rewriteSonFormsToSynth } from '../synthSonConfusion';
import { glossaryTermMatchesSource } from '../../web/data/queries/glossaryHelpers';

describe('rewriteSonFormsToSynth', () => {
  it('rewrites bare син to синт', () => {
    expect(rewriteSonFormsToSynth('Макдоно - син... це не сюрприз.')).toBe(
      'Макдоно - синт... це не сюрприз.',
    );
  });

  it('rewrites only the remaining son-form after a correct синт', () => {
    expect(
      rewriteSonFormsToSynth(
        'Чейз попросила мене знайти синта, який зник. Брукс сказав, що син попрямував на південь.',
      ),
    ).toBe(
      'Чейз попросила мене знайти синта, який зник. Брукс сказав, що синт попрямував на південь.',
    );
  });

  it('preserves title case', () => {
    expect(rewriteSonFormsToSynth('Цей Син прийшов сюди')).toBe('Цей Синт прийшов сюди');
  });
});

describe('glossary Synth matching', () => {
  it('mixed-case Synth does not match lowercase dialogue synth', () => {
    expect(glossaryTermMatchesSource('That synth came here.', 'Synth')).toBe(false);
  });

  it('lowercase synth entry matches dialogue and flags missing синт', () => {
    expect(glossaryTermMatchesSource('That synth came here.', 'synth')).toBe(true);
    const violation = findGlossaryViolation('That synth came here.', 'Цей син прийшов сюди.', [
      { term: 'synth', translation: 'синт' },
    ]);
    expect(violation).toEqual({ term: 'synth', translation: 'синт' });
  });

  it('lowercase synths entry matches plurals', () => {
    expect(glossaryTermMatchesSource('Fucking synths!', 'synths')).toBe(true);
    expect(glossaryTermMatchesSource('Fucking synths!', 'Synth')).toBe(false);
  });
});
