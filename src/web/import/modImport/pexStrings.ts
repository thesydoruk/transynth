import fs from 'node:fs';
import path from 'node:path';
import { getBa2Reader } from '../../../formats/ba2';
import {
  formatPexStringContext,
  parsePexBuffer,
  pexScriptKeyFromInfo,
  locatePexLiteralInPsc,
  serializePexStoredContext,
  extractQuotedStringLiteralsFromPsc,
  isPexLiteralTranslatable,
  type PexStringUsage,
} from '../../../formats/pex';
import { CONFIG } from '../../../config';
import { logImport } from '../../../logging/loggers';
import { mapWithConcurrency } from '../../../utils/concurrency';
import type { CsvRow, GameType } from '../../../types';
import type { DecompiledPexScript } from '../../export/pexDecompileService';
import { listCompanionGnrlBa2ForPlugin } from './discovery';

type PexScriptStrings = {
  sourceFile: string;
  pexFile: string | null;
  data: Buffer;
  literals: Array<{
    text: string;
    literalIndex: number;
    usages: PexStringUsage[];
  }>;
};

type PexImportRow = {
  csvRow: CsvRow;
  context: string;
};

const pexBundleFromParse = (
  parsed: ReturnType<typeof parsePexBuffer>,
  pexFile: string | null,
  data: Buffer,
): PexScriptStrings => ({
  sourceFile: parsed.info.sourceFile,
  pexFile,
  data,
  literals: parsed.userStrings.map((entry) => ({
    text: entry.text,
    literalIndex: entry.literalIndex,
    usages: entry.usages,
  })),
});

/**
 * Extract translatable strings from all .pex script files inside a BA2 archive.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 */
const loadPexStringsFromBA2 = (ba2Path: string): Map<string, PexScriptStrings> => {
  const reader = getBa2Reader(ba2Path);
  const result = new Map<string, PexScriptStrings>();

  for (const entry of reader.listByExt('pex')) {
    try {
      const buf = reader.extractEntry(entry);
      const parsed = parsePexBuffer(buf);
      if (parsed.strings.length === 0) continue;
      const scriptKey = pexScriptKeyFromInfo(parsed.info) || entry.name.replace(/\.pex$/i, '');
      result.set(scriptKey, pexBundleFromParse(parsed, entry.name, buf));
    } catch (err) {
      logImport.debug(`PEX: skipping "${entry.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
};

/**
 * Extract translatable strings from loose .pex files found under
 * `<modDir>/Scripts/` on disk.
 *
 * @param modDir - Directory containing the mod files (parent of the .esp)
 */
const loadPexStringsFromLooseFiles = (modDir: string): Map<string, PexScriptStrings> => {
  const scriptsDir = path.join(modDir, 'Scripts');
  const result = new Map<string, PexScriptStrings>();
  if (!fs.existsSync(scriptsDir)) return result;

  let files: string[];
  try {
    files = fs.readdirSync(scriptsDir).filter((f) => f.toLowerCase().endsWith('.pex'));
  } catch {
    return result;
  }

  for (const file of files) {
    try {
      const buf = fs.readFileSync(path.join(scriptsDir, file));
      const parsed = parsePexBuffer(buf);
      if (parsed.strings.length === 0) continue;
      const scriptKey = pexScriptKeyFromInfo(parsed.info) || file.replace(/\.pex$/i, '');
      result.set(scriptKey, pexBundleFromParse(parsed, file, buf));
    } catch (err) {
      logImport.debug(
        `PEX: skipping loose file "${file}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return result;
};

/**
 * Collect all PEX translatable strings for a plugin by scanning companion BA2
 * archives and any loose `Scripts/*.pex` files next to the plugin.
 *
 * Merges results so that a script appearing in both a BA2 and loose files
 * prefers the loose file (which may be a patched version).
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectPexStringsSync = (
  espPath: string,
  game: GameType = 'fo4',
): Map<string, PexScriptStrings> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, PexScriptStrings>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(espPath, game)) {
    try {
      for (const [script, bundle] of loadPexStringsFromBA2(ba2Path)) {
        if (!merged.has(script)) merged.set(script, bundle);
      }
    } catch (err) {
      logImport.warn(
        `PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  for (const [script, bundle] of loadPexStringsFromLooseFiles(modDir)) {
    merged.set(script, bundle);
  }

  return merged;
};

const collectPexStrings = async (
  espPath: string,
  game: GameType = 'fo4',
): Promise<Map<string, PexScriptStrings>> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, PexScriptStrings>();

  const ba2Paths = listCompanionGnrlBa2ForPlugin(espPath, game);
  const ba2Results = await mapWithConcurrency(
    ba2Paths,
    CONFIG.modImportIoParallel,
    async (ba2Path) => {
      try {
        return loadPexStringsFromBA2(ba2Path);
      } catch (err) {
        logImport.warn(
          `PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
        );
        return new Map<string, PexScriptStrings>();
      }
    },
  );

  for (const pexMap of ba2Results) {
    for (const [script, bundle] of pexMap) {
      if (!merged.has(script)) merged.set(script, bundle);
    }
  }

  for (const [script, bundle] of loadPexStringsFromLooseFiles(modDir)) {
    merged.set(script, bundle);
  }

  return merged;
};

/**
 * Convert collected PEX script literals into CsvRow objects for DB ingestion.
 *
 * Each unique string in a given script becomes one row:
 *   FormID    : ''              (PEX strings have no ESM FormID)
 *   Signature : 'PEX'           (distinguishes PEX rows in the editor)
 *   Path      : 'PEX\\<script>' (e.g. PEX\\CraftingScript)
 *   Source    : the string literal text
 *
 * `context` stores decompiled Papyrus source context (line + snippet) when Champollion
 * is available, otherwise falls back to script name and literal index.
 *
 * Duplicate strings within the same script are deduplicated here to avoid
 * inserting the same text twice (the PEX string table may repeat entries
 * that are referenced from multiple call sites).
 */
const buildPexCsvRows = (
  pexMap: Map<string, PexScriptStrings>,
  decompiled: Map<string, DecompiledPexScript>,
): PexImportRow[] => {
  const rows: PexImportRow[] = [];
  let skipped = 0;
  for (const [scriptName, bundle] of pexMap) {
    const recordPath = `PEX\\${scriptName}`;
    const seen = new Set<string>();
    const pscBundle = decompiled.get(scriptName);
    const candidates = new Map<
      string,
      { text: string; literalIndex: number; usages: PexStringUsage[] }
    >();

    for (const entry of bundle.literals) {
      candidates.set(entry.text, entry);
    }

    if (pscBundle) {
      for (const text of extractQuotedStringLiteralsFromPsc(pscBundle.pscSource)) {
        if (!candidates.has(text)) {
          candidates.set(text, { text, literalIndex: 0, usages: [] });
        }
      }
    }

    for (const { text, literalIndex, usages } of candidates.values()) {
      if (seen.has(text)) continue;
      if (!isPexLiteralTranslatable(text, usages, pscBundle?.pscSource)) {
        skipped++;
        continue;
      }
      seen.add(text);

      let context = formatPexStringContext(bundle.sourceFile, { literalIndex, usages });
      if (pscBundle) {
        const snippet = locatePexLiteralInPsc(pscBundle.pscSource, text, {
          scriptLabel: path.basename(pscBundle.headerSourceFile || `${scriptName}.psc`),
          headerSourceFile: pscBundle.headerSourceFile,
        });
        if (snippet) context = serializePexStoredContext(snippet);
      }

      rows.push({
        csvRow: {
          FormID: '',
          Signature: 'PEX',
          Path: recordPath,
          PathSimplified: recordPath,
          Source: text,
        },
        context,
      });
    }
  }
  if (skipped > 0) {
    logImport.debug(`PEX filter: skipped ${skipped} non-translatable literal(s)`);
  }
  return rows;
};

export { collectPexStringsSync, collectPexStrings, buildPexCsvRows };
