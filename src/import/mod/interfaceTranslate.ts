import fs from 'node:fs';
import path from 'node:path';
import { getBa2Reader } from '../../formats/ba2';
import {
  interfaceTranslateLocaleFromPath,
  isInterfaceTranslatePath,
  parseInterfaceTranslateBuffer,
} from '../../formats/interface';
import { listCompanionGnrlBa2ForPlugin } from './discovery';
import type { GameType } from '../../types';
import type { CsvRow } from '../../types';

const loadInterfaceTranslateFromBa2 = (ba2Path: string): Map<string, Map<string, string>> => {
  const reader = getBa2Reader(ba2Path);
  const locales = new Map<string, Map<string, string>>();

  for (const entry of reader.listByExt('txt')) {
    const baseName = path.basename(entry.name);
    if (!isInterfaceTranslatePath(baseName)) continue;

    const locale = interfaceTranslateLocaleFromPath(baseName);
    if (!locale) continue;

    const map = parseInterfaceTranslateBuffer(reader.extractEntry(entry));
    if (map.size === 0) continue;
    locales.set(locale, map);
  }

  return locales;
};

const loadInterfaceTranslateFromLooseFiles = (modDir: string): Map<string, Map<string, string>> => {
  const locales = new Map<string, Map<string, string>>();
  const ifaceDir = path.join(modDir, 'Interface');
  if (!fs.existsSync(ifaceDir)) return locales;

  for (const file of fs.readdirSync(ifaceDir)) {
    if (!isInterfaceTranslatePath(file)) continue;
    const locale = interfaceTranslateLocaleFromPath(file);
    if (!locale) continue;

    const map = parseInterfaceTranslateBuffer(fs.readFileSync(path.join(ifaceDir, file)));
    if (map.size === 0) continue;
    locales.set(locale, map);
  }

  return locales;
};

/** Collect all `Interface/Translate_*.txt` locales for one plugin package. */
export const collectInterfaceTranslateLocales = (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): Map<string, Map<string, string>> => {
  const merged = new Map<string, Map<string, string>>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(anchorPath, game)) {
    try {
      for (const [locale, map] of loadInterfaceTranslateFromBa2(ba2Path)) {
        if (!merged.has(locale)) merged.set(locale, new Map());
        for (const [key, text] of map) merged.get(locale)!.set(key, text);
      }
    } catch {
      // Skip unreadable archives.
    }
  }

  for (const [locale, map] of loadInterfaceTranslateFromLooseFiles(modDir)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [key, text] of map) merged.get(locale)!.set(key, text);
  }

  return merged;
};

export const buildInterfaceTranslateCsvRows = (
  locale: string,
  translateMap: Map<string, string>,
): CsvRow[] =>
  Array.from(translateMap.entries()).map(([key, text]) => ({
    FormID: '',
    Signature: 'UI',
    Path: `Interface\\Translate_${locale}\\${key}`,
    PathSimplified: `Interface\\Translate_${locale}\\${key}`,
    Source: text,
  }));

export const countInterfaceTranslateRecords = (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): number => {
  const locales = collectInterfaceTranslateLocales(modDir, anchorPath, game);
  let max = 0;
  for (const map of locales.values()) max = Math.max(max, map.size);
  return max;
};
