import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../src/db.js';
import { CONFIG } from '../src/config.js';
import { log } from '../src/logger.js';

const DEFAULT_GAMEDICO_DIR = path.resolve('src', 'resources', 'glossary-seed');

interface ImportGameDicoResult {
  files: number;
  parsedTerms: number;
  uniqueTerms: number;
  inserted: number;
  skipped: boolean;
}

interface GlossarySeedEntry {
  formId?: string;
  term?: string;
}

interface SeedGlossaryTerm {
  term: string;
  source: string;
}

const extractTermFromEntry = (entry: GlossarySeedEntry): string | null => {
  const term = entry.term?.trim();
  return term ? term : null;
};

/**
 * Seed glossary terms from legacy GameDico text files.
 *
 * The seed is idempotent: existing `(term, src_lang, tgt_lang)` pairs are kept.
 * Only missing terms are inserted with `translation = NULL` and source `gamedico_seed`.
 */
export const importGameDicoGlossarySeed = async (
  db: Tx,
  options?: { gameDicoDir?: string; srcLang?: string; tgtLang?: string },
): Promise<ImportGameDicoResult> => {
  const gameDicoDir = options?.gameDicoDir ?? process.env.GAMEDICO_DIR ?? DEFAULT_GAMEDICO_DIR;
  const srcLang = options?.srcLang ?? CONFIG.defaultSrcLang;
  const tgtLang = options?.tgtLang ?? CONFIG.defaultTgtLang;

  if (!fs.existsSync(gameDicoDir)) {
    log.warn(`GameDico seed skipped: directory not found (${gameDicoDir})`);
    return { files: 0, parsedTerms: 0, uniqueTerms: 0, inserted: 0, skipped: true };
  }

  const files = fs
    .readdirSync(gameDicoDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const uniqueTerms = new Map<string, SeedGlossaryTerm>();
  let parsedTerms = 0;

  for (const fileName of files) {
    const filePath = path.join(gameDicoDir, fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content) as GlossarySeedEntry[] | { entries?: GlossarySeedEntry[] };
    const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
    const sourceTag = `gamedico_seed:${fileName.replace(/\.json$/i, '')}`;

    for (const entry of entries) {
      const term = extractTermFromEntry(entry);
      if (!term) continue;

      parsedTerms += 1;
      const dedupKey = term.toLowerCase();
      if (!uniqueTerms.has(dedupKey)) {
        uniqueTerms.set(dedupKey, { term, source: sourceTag });
      }
    }
  }

  const terms = [...uniqueTerms.values()];
  let inserted = 0;
  const batchSize = 500;

  for (let i = 0; i < terms.length; i += batchSize) {
    const chunk = terms.slice(i, i + batchSize);
    const placeholders: string[] = [];
    const params: unknown[] = [];

    chunk.forEach((item, idx) => {
      const base = idx * 4;
      placeholders.push(`($${base + 1}, NULL, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(item.term, srcLang, tgtLang, item.source);
    });

    const result = await db.query(
      `INSERT INTO glossary(term, translation, src_lang, tgt_lang, source)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT(term, src_lang, tgt_lang) DO NOTHING`,
      params,
    );

    inserted += result.rowCount ?? 0;
  }

  log.info(
    `GameDico seed: files=${files.length}, parsedTerms=${parsedTerms}, uniqueTerms=${terms.length}, inserted=${inserted}, lang=${srcLang}->${tgtLang}`,
  );

  return {
    files: files.length,
    parsedTerms,
    uniqueTerms: terms.length,
    inserted,
    skipped: false,
  };
};
