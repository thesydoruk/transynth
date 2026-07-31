import {
  interfaceTranslateArchivePath,
  interfaceTranslateExportSlot,
  interfaceTranslateKeyFromRecordPath,
  interfaceTranslateLocaleFromPath,
  parseInterfaceTranslateBuffer,
  writeInterfaceTranslateBuffer,
} from '../interfaceTranslate';

describe('interfaceTranslate', () => {
  it('parses UTF-16 LE Translate files', () => {
    const buf = writeInterfaceTranslateBuffer([
      { key: '$10 Mins', text: '10 Mins' },
      { key: '$ABORT', text: 'ABORT' },
    ]);
    const map = parseInterfaceTranslateBuffer(buf);
    expect(map.get('$10 Mins')).toBe('10 Mins');
    expect(map.get('$ABORT')).toBe('ABORT');
  });

  it('detects locale from Translate file names', () => {
    expect(interfaceTranslateLocaleFromPath('Interface/Translate_en.txt')).toBe('en');
    expect(interfaceTranslateLocaleFromPath('Translate_ru.txt')).toBe('ru');
    expect(interfaceTranslateLocaleFromPath('MCM_en.txt')).toBeNull();
  });

  it('maps Ukrainian exports to Translate_en.txt for FO4', () => {
    expect(interfaceTranslateExportSlot('uk', 'fo4')).toBe('en');
    expect(interfaceTranslateArchivePath('uk', 'fo4')).toBe('Interface\\Translate_en.txt');
  });

  it('extracts UI keys from record paths', () => {
    expect(interfaceTranslateKeyFromRecordPath('Interface\\Translate_en\\$10 Mins', 'en')).toBe(
      '$10 Mins',
    );
    expect(interfaceTranslateKeyFromRecordPath('MCM\\$Foo', 'en')).toBeNull();
  });
});
