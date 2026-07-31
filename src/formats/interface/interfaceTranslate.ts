import type { GameType } from '../../types';
import { parseMcmBuffer } from '../mcm/mcmTranslations';
import type { InterfaceTranslateEntry } from './types/InterfaceTranslateEntry';

const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);

/** Parse `Interface/Translate_<locale>.txt` (same `$key<TAB>text` layout as MCM). */
export const parseInterfaceTranslateBuffer = (buf: Buffer): Map<string, string> =>
  parseMcmBuffer(buf);

/** Extract locale suffix from `Translate_en.txt` or archive path. */
export const interfaceTranslateLocaleFromPath = (filePath: string): string | null => {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const match = base.match(/^Translate_([a-z]+)\.txt$/i);
  return match ? match[1].toLowerCase() : null;
};

export const isInterfaceTranslatePath = (filePath: string): boolean =>
  interfaceTranslateLocaleFromPath(filePath) != null;

/**
 * Fallout 4/76 Ukrainian releases ship UI text in `Translate_en.txt`
 * while the game language stays English.
 */
export const interfaceTranslateExportSlot = (targetLang: string, game: GameType): string => {
  const lang = targetLang.trim().toLowerCase();
  if ((game === 'fo4' || game === 'fo76') && lang === 'uk') return 'en';
  return lang;
};

export const interfaceTranslateFileName = (targetLang: string, game: GameType): string =>
  `Translate_${interfaceTranslateExportSlot(targetLang, game)}.txt`;

export const interfaceTranslateArchivePath = (targetLang: string, game: GameType): string =>
  `Interface\\${interfaceTranslateFileName(targetLang, game)}`;

/** Record path prefix for imported Interface translate keys. */
export const interfaceTranslateRecordPrefix = (sourceLocale: string): string =>
  `Interface\\Translate_${sourceLocale.trim().toLowerCase()}\\`;

export const interfaceTranslateRecordPath = (sourceLocale: string, key: string): string =>
  `${interfaceTranslateRecordPrefix(sourceLocale)}${key}`;

export const interfaceTranslateKeyFromRecordPath = (
  pathValue: string,
  sourceLocale: string,
): string | null => {
  const prefix = interfaceTranslateRecordPrefix(sourceLocale);
  const normalized = pathValue.replace(/\//g, '\\');
  if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const key = normalized.slice(prefix.length);
  return key.startsWith('$') ? key : null;
};

export const writeInterfaceTranslateBuffer = (entries: InterfaceTranslateEntry[]): Buffer => {
  const lines = entries.map(({ key, text }) => `${key}\t${text}`).join('\r\n');
  return Buffer.concat([UTF16_LE_BOM, Buffer.from(lines, 'utf16le')]);
};

export const readInterfaceTranslateEntries = (buf: Buffer): InterfaceTranslateEntry[] =>
  [...parseInterfaceTranslateBuffer(buf).entries()].map(([key, text]) => ({ key, text }));
