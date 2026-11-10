import type { CsvRow } from '../../types';
import fs from 'node:fs';
import path from 'node:path';
import { getBa2Reader } from '../../formats/ba2';
import {
  formatPexStringContext,
  parsePexBuffer,
  pexScriptKeyFromInfo,
  locatePexLiteralInPsc,
  serializePexStoredContext,
  extractQuotedStringLiteralsFromPsc,
  isPexLiteralTranslatable,
  listLoosePexFiles,
  pexScriptKeyFromRelPath,
  type PexStringUsage,
} from '../../formats/pex';
import { CONFIG } from '../../config';
import { logImport } from '../../logging/loggers';
import { mapWithConcurrency } from '../../utils/concurrency';
import type { DecompiledPexScript } from '../../web/export/pexDecompileService';
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

/** Parse one script; null when it holds no strings or does not parse. */
const parsePexScript = (
  archivePath: string,
  data: Buffer,
): { scriptKey: string; bundle: PexScriptStrings } | null => {
  try {
    const parsed = parsePexBuffer(data);
    if (parsed.strings.length === 0) return null;
    const scriptKey = pexScriptKeyFromRelPath(archivePath, pexScriptKeyFromInfo(parsed.info));
    if (!scriptKey) return null;
    return { scriptKey, bundle: pexBundleFromParse(parsed, archivePath, data) };
  } catch (err) {
    logImport.debug(`PEX: skipping "${archivePath}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
};

/**
 * Extract translatable strings from all .pex script files inside a BA2 archive.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 */
const loadPexStringsFromBA2 = (ba2Path: string): Map<string, PexScriptStrings> => {
  const reader = getBa2Reader(ba2Path);
  const result = new Map<string, PexScriptStrings>();

  for (const entry of reader.listByExt('pex')) {
    let buf: Buffer;
    try {
      buf = reader.extractEntry(entry);
    } catch (err) {
      logImport.debug(`PEX: skipping "${entry.name}": ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const script = parsePexScript(entry.name, buf);
    if (script) result.set(script.scriptKey, script.bundle);
  }

  return result;
};

/**
 * Extract translatable strings from loose .pex files under `<modDir>/Scripts/`,
 * at any depth: an unpacked archive leaves namespaced scripts in subfolders
 * (`Scripts/SimSettlementsV2/Quests/…`).
 *
 * @param modDir - Directory containing the mod files (parent of the .esp)
 */
const loadPexStringsFromLooseFiles = (modDir: string): Map<string, PexScriptStrings> => {
  const result = new Map<string, PexScriptStrings>();
  for (const file of listLoosePexFiles(modDir)) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file.absPath);
    } catch {
      continue;
    }
    const script = parsePexScript(file.archivePath, buf);
    if (script) result.set(script.scriptKey, script.bundle);
  }
  return result;
};

const collectPexStrings = async (espPath: string): Promise<Map<string, PexScriptStrings>> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, PexScriptStrings>();

  const ba2Paths = listCompanionGnrlBa2ForPlugin(espPath);
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

  // The game matches script names without case, and an archive may spell the
  // folders differently from the loose copy: one script, one key.
  const keyByLower = new Map<string, string>();
  const put = (script: string, bundle: PexScriptStrings, override: boolean): void => {
    const known = keyByLower.get(script.toLowerCase());
    if (known && !override) return;
    if (known) merged.delete(known);
    keyByLower.set(script.toLowerCase(), script);
    merged.set(script, bundle);
  };

  for (const pexMap of ba2Results) {
    for (const [script, bundle] of pexMap) put(script, bundle, false);
  }

  for (const [script, bundle] of loadPexStringsFromLooseFiles(modDir)) {
    put(script, bundle, true);
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

export { collectPexStrings, buildPexCsvRows };
