/**
 * MCM Translation File Reader
 *
 * MCM (Mod Configuration Menu, via MCM Helper / F4SE) allows Fallout 4 and
 * Skyrim mod authors to add in-game configuration menus. Each MCM that
 * supports localization ships plain-text translation files inside the mod's
 * BA2 archive (or as loose files):
 *
 *   Interface\Translations\<ModName>_<LANG>.txt
 *
 * File format:
 *   - One key-value pair per line.
 *   - Key starts with `$` (dollar sign), followed by the term identifier.
 *   - Key and value are separated by a single TAB character (`\t`).
 *   - Empty lines and lines that do not start with `$` are ignored.
 *   - Files may be encoded as UTF-16 LE (with BOM), UTF-8 BOM, or plain UTF-8.
 *
 * Example line:
 *   $SettingDifficulty\tDifficulty
 *
 * This module exposes:
 *   - `parseMcmBuffer(buf)` — parses a raw buffer and returns a Map<key, text>.
 *   - `mcmLocaleFromPath(filePath)` — extracts the locale suffix from a file path/name.
 */

/**
 * Parse an MCM translation file buffer.
 *
 * Automatically detects encoding via BOM:
 *   - 0xFF 0xFE → UTF-16 LE
 *   - 0xEF 0xBB 0xBF → UTF-8 with BOM
 *   - Otherwise → plain UTF-8
 *
 * @param buf - Raw file contents as a Node.js Buffer
 * @returns   Map of `$key` → translated text string
 */
export const parseMcmBuffer = (buf: Buffer): Map<string, string> => {
  let content: string;

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16 LE BOM — most common encoding for Bethesda translation files
    content = buf.subarray(2).toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE BOM — rare, but handle by swapping byte pairs
    const body = buf.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    content = swapped.toString('utf16le');
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    // UTF-8 BOM
    content = buf.subarray(3).toString('utf8');
  } else {
    // Plain UTF-8 (no BOM)
    content = buf.toString('utf8');
  }

  const result = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Skip empty lines and non-key lines (keys must start with $)
    if (!line || !line.startsWith('$')) continue;

    // Key and value are separated by the first TAB
    const tabIdx = line.indexOf('\t');
    if (tabIdx < 0) continue;

    const key = line.slice(0, tabIdx).trim();
    // Value may contain tabs — only split on the first one
    const value = line.slice(tabIdx + 1);

    if (key && value) {
      result.set(key, value);
    }
  }

  return result;
};

/**
 * Extract the locale suffix from an MCM translation file path.
 *
 * MCM files follow the naming convention:
 *   Interface\Translations\<ModName>_<LANG>.txt
 *
 * Examples:
 *   "Interface\\Translations\\MyMod_english.txt"  → "english"
 *   "Interface/Translations/MyMod_GERMAN.txt"      → "german"
 *   "MyMod_french.txt"                             → "french"
 *
 * @param filePath - Archive-relative path or bare filename
 * @returns Lowercase locale string (e.g. "english"), or `null` if pattern
 *          does not match (i.e. the file is not an MCM translation file).
 */
export const mcmLocaleFromPath = (filePath: string): string | null => {
  // Take just the filename from any path separators
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';

  // Pattern: <anything>_<LANG>.txt  — LANG is at least one letter
  const match = base.match(/_([a-z]+)\.txt$/i);
  return match ? match[1].toLowerCase() : null;
};

const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);

/** Serialize MCM key/value pairs as UTF-16 LE with BOM (Bethesda convention). */
export const writeMcmBuffer = (entries: Array<{ key: string; text: string }>): Buffer => {
  const lines = entries.map(({ key, text }) => `${key}\t${text}`).join('\r\n');
  return Buffer.concat([UTF16_LE_BOM, Buffer.from(lines, 'utf16le')]);
};
