/**
 * Unit tests for MCM translation file parser.
 */
import { describe, it, expect } from '@jest/globals';
import { parseMcmBuffer, mcmLocaleFromPath } from '../mcmReader.js';

describe('parseMcmBuffer — UTF-8 plain', () => {
  it('parses a basic key-value pair', () => {
    const buf = Buffer.from('$SettingDifficulty\tDifficulty', 'utf8');
    const map = parseMcmBuffer(buf);
    expect(map.get('$SettingDifficulty')).toBe('Difficulty');
  });

  it('parses multiple lines', () => {
    const content = '$KeyA\tValue A\n$KeyB\tValue B\n$KeyC\tValue C';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.size).toBe(3);
    expect(map.get('$KeyA')).toBe('Value A');
    expect(map.get('$KeyC')).toBe('Value C');
  });

  it('skips empty lines', () => {
    const content = '$KeyA\tValue A\n\n\n$KeyB\tValue B';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.size).toBe(2);
  });

  it('skips lines without a leading $', () => {
    const content = '$Good\tOK\nNotAKey\tskipped\n; comment\t skipped too';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.size).toBe(1);
    expect(map.get('$Good')).toBe('OK');
  });

  it('skips lines with no tab separator', () => {
    const content = '$NoTab\n$HasTab\tValue';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.size).toBe(1);
    expect(map.get('$HasTab')).toBe('Value');
  });

  it('value may contain embedded tabs (only first tab splits)', () => {
    const content = '$Key\tValue with\ttabs\there';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.get('$Key')).toBe('Value with\ttabs\there');
  });

  it('handles CRLF line endings', () => {
    const content = '$A\tAlpha\r\n$B\tBeta\r\n';
    const map = parseMcmBuffer(Buffer.from(content, 'utf8'));
    expect(map.size).toBe(2);
    expect(map.get('$A')).toBe('Alpha');
  });

  it('returns empty map for empty buffer', () => {
    const map = parseMcmBuffer(Buffer.alloc(0));
    expect(map.size).toBe(0);
  });
});

describe('parseMcmBuffer — UTF-8 BOM', () => {
  it('strips UTF-8 BOM and parses normally', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const text = Buffer.from('$Key\tBOM Value', 'utf8');
    const map = parseMcmBuffer(Buffer.concat([bom, text]));
    expect(map.get('$Key')).toBe('BOM Value');
  });
});

describe('parseMcmBuffer — UTF-16 LE BOM', () => {
  it('decodes UTF-16 LE (most common Bethesda encoding)', () => {
    const bom = Buffer.from([0xff, 0xfe]);
    const text = Buffer.from('$Key\tUtf16Value', 'utf16le');
    const map = parseMcmBuffer(Buffer.concat([bom, text]));
    expect(map.get('$Key')).toBe('Utf16Value');
  });

  it('handles Cyrillic text in UTF-16 LE', () => {
    const bom = Buffer.from([0xff, 0xfe]);
    const text = Buffer.from('$Ключ\tЗначення', 'utf16le');
    const map = parseMcmBuffer(Buffer.concat([bom, text]));
    expect(map.get('$Ключ')).toBe('Значення');
  });
});

describe('mcmLocaleFromPath', () => {
  it('extracts locale from archive path with backslashes', () => {
    expect(mcmLocaleFromPath('Interface\\Translations\\MyMod_english.txt')).toBe('english');
  });

  it('extracts locale from archive path with forward slashes', () => {
    expect(mcmLocaleFromPath('Interface/Translations/MyMod_german.txt')).toBe('german');
  });

  it('extracts locale from bare filename', () => {
    expect(mcmLocaleFromPath('SomeMod_french.txt')).toBe('french');
  });

  it('is case-insensitive for locale suffix', () => {
    expect(mcmLocaleFromPath('Mod_ENGLISH.txt')).toBe('english');
  });

  it('returns null for .txt file without underscore-locale pattern', () => {
    expect(mcmLocaleFromPath('interface.txt')).toBeNull();
  });

  it('returns null for non-.txt files', () => {
    expect(mcmLocaleFromPath('Mod_english.strings')).toBeNull();
  });
});