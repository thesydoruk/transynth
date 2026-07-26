import fs from 'node:fs';
import path from 'node:path';
import { getBa2Reader } from '../../formats/ba2';
import {
  parseMcmBuffer,
  mcmLocaleFromPath,
  resolveMcmModPrefix,
  resolveMcmTranslationPrefixes,
  listMcmTranslationDirs,
  isMcmTranslationArchivePath,
  mcmTranslationMatchesMod,
  resolveModDirectoryFromPath,
  loadMcmLocalesFromConfigJson,
} from '../../formats/mcm';
import { CONFIG } from '../../config';
import { logImport } from '../../logging/loggers';
import { mapWithConcurrency } from '../../utils/concurrency';
import type { CsvRow, GameType } from '../../types';
import { listCompanionGnrlBa2ForPlugin } from './discovery';

const loadMcmLocalesFromBA2 = (
  ba2Path: string,
  modPrefixes: string[],
): Map<string, Map<string, string>> => {
  const reader = getBa2Reader(ba2Path);
  const locales = new Map<string, Map<string, string>>();

  const txtEntries = reader.listByExt('txt').filter((e) => isMcmTranslationArchivePath(e.name));

  for (const entry of txtEntries) {
    const baseName = path.basename(entry.name);
    if (!mcmTranslationMatchesMod(baseName, modPrefixes)) continue;

    const locale = mcmLocaleFromPath(entry.name);
    if (!locale) continue;

    const buf = reader.extractEntry(entry);
    const mcmMap = parseMcmBuffer(buf);
    if (mcmMap.size === 0) continue;

    if (!locales.has(locale)) locales.set(locale, new Map());
    const existing = locales.get(locale)!;
    for (const [k, v] of mcmMap) existing.set(k, v);
  }

  return locales;
};

/**
 * Load MCM translation files from loose files on disk.
 *
 * @param modDir - Directory containing the mod files
 * @param modPrefix - MCM modName prefix from config.json or plugin stem
 */
const loadMcmLocalesFromLooseFiles = (
  modDir: string,
  modPrefixes: string[],
): Map<string, Map<string, string>> => {
  const locales = new Map<string, Map<string, string>>();

  for (const dir of listMcmTranslationDirs(modDir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!mcmTranslationMatchesMod(file, modPrefixes)) continue;

      const locale = mcmLocaleFromPath(file);
      if (!locale) continue;

      const buf = fs.readFileSync(path.join(dir, file));
      const mcmMap = parseMcmBuffer(buf);
      if (mcmMap.size === 0) continue;

      if (!locales.has(locale)) locales.set(locale, new Map());
      const existing = locales.get(locale)!;
      for (const [k, v] of mcmMap) existing.set(k, v);
    }
  }

  return locales;
};

/**
 * Collect all MCM locales for a mod folder by scanning GNRL BA2 archives and loose
 * translation txt files that match the mod's MCM prefix.
 */
const collectMcmLocalesForMod = (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): Map<string, Map<string, string>> => {
  const modPrefix = resolveMcmModPrefix(modDir, anchorPath);
  const modPrefixes = resolveMcmTranslationPrefixes(modDir, modPrefix);
  const merged = new Map<string, Map<string, string>>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(anchorPath, game)) {
    try {
      for (const [locale, mcmMap] of loadMcmLocalesFromBA2(ba2Path, modPrefixes)) {
        if (!merged.has(locale)) merged.set(locale, new Map());
        for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
      }
    } catch (err) {
      logImport.warn(
        `MCM: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromLooseFiles(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromConfigJson(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    const bucket = merged.get(locale)!;
    for (const [k, v] of mcmMap) {
      if (!bucket.has(k)) bucket.set(k, v);
    }
  }

  return merged;
};

/** Parallel BA2 scan — used during long-running import only. */
const collectMcmLocalesForModParallel = async (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): Promise<Map<string, Map<string, string>>> => {
  const modPrefix = resolveMcmModPrefix(modDir, anchorPath);
  const modPrefixes = resolveMcmTranslationPrefixes(modDir, modPrefix);
  const merged = new Map<string, Map<string, string>>();

  const ba2Paths = listCompanionGnrlBa2ForPlugin(anchorPath, game);
  const ba2LocaleMaps = await mapWithConcurrency(
    ba2Paths,
    CONFIG.modImportIoParallel,
    async (ba2Path) => {
      try {
        return loadMcmLocalesFromBA2(ba2Path, modPrefixes);
      } catch (err) {
        logImport.warn(
          `MCM: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
        );
        return new Map<string, Map<string, string>>();
      }
    },
  );

  for (const mcmLocales of ba2LocaleMaps) {
    for (const [locale, mcmMap] of mcmLocales) {
      if (!merged.has(locale)) merged.set(locale, new Map());
      for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
    }
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromLooseFiles(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromConfigJson(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    const bucket = merged.get(locale)!;
    for (const [k, v] of mcmMap) {
      if (!bucket.has(k)) bucket.set(k, v);
    }
  }

  return merged;
};

/**
 * Collect all MCM locales for a plugin by scanning GNRL BA2 archives and loose
 * `Interface/Translations` files that match the mod's MCM prefix.
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectMcmLocales = (espPath: string): Map<string, Map<string, string>> => {
  const modDir = resolveModDirectoryFromPath(espPath);
  return collectMcmLocalesForMod(modDir, espPath);
};

const countMcmTranslationRecords = (modDir: string, anchorPath: string): number => {
  const locales = collectMcmLocalesForMod(modDir, anchorPath);
  let max = 0;
  for (const mcmMap of locales.values()) max = Math.max(max, mcmMap.size);
  return max;
};

const buildMcmCsvRows = (mcmMap: Map<string, string>): CsvRow[] =>
  Array.from(mcmMap.entries()).map(([key, text]) => ({
    FormID: '',
    Signature: 'MCM',
    Path: `MCM\\${key}`,
    PathSimplified: `MCM\\${key}`,
    Source: text,
  }));

export { collectMcmLocalesForModParallel, countMcmTranslationRecords, buildMcmCsvRows };
