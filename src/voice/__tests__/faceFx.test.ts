import { faceFxDialogueLanguage } from '../faceFx/text';

describe('faceFxDialogueLanguage', () => {
  it('selects Ukrainian when the line has Cyrillic', () => {
    expect(faceFxDialogueLanguage('Привіт, мешканцю.')).toBe('Ukrainian');
    expect(faceFxDialogueLanguage('Pip-Boy працює')).toBe('Ukrainian');
  });

  it('keeps USEnglish for ASCII dialogue', () => {
    expect(faceFxDialogueLanguage('Hello, vault dweller.')).toBe('USEnglish');
  });
});
