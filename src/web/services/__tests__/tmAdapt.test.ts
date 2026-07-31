import { adaptTmTranslation } from '../tmAdapt';

describe('adaptTmTranslation', () => {
  it('returns translation unchanged when sources match exactly', () => {
    expect(
      adaptTmTranslation('Комбінезон Сховища 88', 'Vault 88 Jumpsuit', 'Vault 88 Jumpsuit'),
    ).toBe('Комбінезон Сховища 88');
  });

  it('transplants numbers when sources differ only by numeric values', () => {
    expect(
      adaptTmTranslation('Комбінезон Сховища 88', 'Vault 88 Jumpsuit', 'Vault 111 Jumpsuit'),
    ).toBe('Комбінезон Сховища 111');
  });

  it('transplants multiple numbers positionally', () => {
    expect(
      adaptTmTranslation('Шкода: 100, Вага: 5', 'Damage: 100, Weight: 5', 'Damage: 150, Weight: 8'),
    ).toBe('Шкода: 150, Вага: 8');
  });

  it('returns null when numbers cannot be transplanted safely', () => {
    expect(
      adaptTmTranslation('Текст без чисел', 'Vault 88 Jumpsuit', 'Vault 111 Jumpsuit'),
    ).toBeNull();
  });

  it('returns null when number counts differ', () => {
    expect(adaptTmTranslation('Рівень 5', 'Level 5', 'Level 5 of 10')).toBeNull();
  });
});
