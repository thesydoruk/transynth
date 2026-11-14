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

  it('uppercases translation when target source is ALL CAPS', () => {
    expect(adaptTmTranslation('Вибране', 'Favorites', 'FAVORITES')).toBe('ВИБРАНЕ');
  });

  it('copies an exact match as reviewed: the dash and the casing stay', () => {
    expect(adaptTmTranslation('Броня — легка', 'Light armor', 'Light armor')).toBe('Броня — легка');
    expect(adaptTmTranslation('Не цікаво', 'NOT INTERESTED', 'NOT INTERESTED')).toBe('Не цікаво');
  });

  it('keeps the dash of an adapted match too', () => {
    expect(adaptTmTranslation('Затискач 01 — синій', 'Clamp 01 - Blue', 'Clamp 02 - Blue')).toBe(
      'Затискач 02 — синій',
    );
  });

  it('folds guillemets the way a save does', () => {
    expect(adaptTmTranslation('Журнал «Наука Тесли»', 'Tesla Science', 'Tesla Science')).toBe(
      'Журнал "Наука Тесли"',
    );
  });

  it("swaps another line's MCM key for the target's", () => {
    expect(
      adaptTmTranslation(
        'Клацни, щоб ${helpClickAction}',
        'Click to ${helpClickAction}',
        'Click to ${Item_sorter_help}',
      ),
    ).toBe('Клацни, щоб ${Item_sorter_help}');
  });

  it('keeps alias tags that differ only by digits to the number transplant', () => {
    expect(
      adaptTmTranslation(
        'Іди до <Alias=Location002>',
        'Go to <Alias=Location002>',
        'Go to <Alias=Location003>',
      ),
    ).toBe('Іди до <Alias=Location003>');
  });

  it('returns null when the translation lacks the matched placeholder', () => {
    expect(
      adaptTmTranslation('Іди туди', 'Go to <Alias=myLocation>', 'Go to <Alias=TargetLocation>'),
    ).toBeNull();
  });

  it('applies ALL CAPS after numeric transplant', () => {
    expect(
      adaptTmTranslation('Комбінезон Сховища 88', 'Vault 88 Jumpsuit', 'VAULT 111 JUMPSUIT'),
    ).toBe('КОМБІНЕЗОН СХОВИЩА 111');
  });
});
