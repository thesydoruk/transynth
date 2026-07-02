import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { FO4_UK_GLOSSARY } from '../src/resources/glossary/fo4-uk';

const MOD_ID = Number(process.argv[2] ?? '2');
const MIN_COUNT = Number(process.argv[3] ?? '2');
const TOP_N = Number(process.argv[4] ?? '150');

const existingGlossary = new Map(FO4_UK_GLOSSARY.map((g) => [g.term.toLowerCase(), g.translation]));

const db = openDb();
try {
  const mod = await db.query<{ id: number; name: string; abs_path: string | null; game: string }>(
    'SELECT id, name, abs_path, game FROM mods WHERE id = $1',
    [MOD_ID],
  );
  if (mod.rows.length === 0) {
    console.error(`Mod ${MOD_ID} not found`);
    process.exit(1);
  }
  console.log(`=== Mod ${MOD_ID}: ${mod.rows[0].name} [${mod.rows[0].game}] ===\n`);

  const stats = await db.query<{
    strings: string;
    translated: string;
    reviewed: string;
  }>(
    `SELECT COUNT(DISTINCT s.id)::text AS strings,
            COUNT(DISTINCT t.id) FILTER (WHERE t.text IS NOT NULL AND trim(t.text) <> '')::text AS translated,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('reviewed','human'))::text AS reviewed
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
     WHERE r.mod_id = $1`,
    [MOD_ID],
  );
  console.log('Stats:', stats.rows[0]);

  // All EN source → UK translation variants within this mod
  const { rows } = await db.query<{
    source: string;
    translation: string;
    cnt: string;
    path: string;
  }>(
    `SELECT s.text_raw AS source,
            trim(t.text) AS translation,
            rec.path,
            COUNT(*)::text AS cnt
     FROM strings s
     JOIN records rec ON rec.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
       AND t.text IS NOT NULL AND trim(t.text) <> ''
     WHERE s.lang = 'en'
       AND rec.mod_id = $1
     GROUP BY s.text_raw, trim(t.text), rec.path
     ORDER BY s.text_raw, COUNT(*) DESC`,
    [MOD_ID],
  );

  type Variant = { translation: string; cnt: number; paths: Set<string> };
  const bySource = new Map<string, Map<string, Variant>>();

  for (const row of rows) {
    const trMap = bySource.get(row.source) ?? new Map<string, Variant>();
    const existing = trMap.get(row.translation);
    if (existing) {
      existing.cnt += Number(row.cnt);
      existing.paths.add(row.path);
    } else {
      trMap.set(row.translation, {
        translation: row.translation,
        cnt: Number(row.cnt),
        paths: new Set([row.path]),
      });
    }
    bySource.set(row.source, trMap);
  }

  // Inconsistent: same EN source, multiple UK translations
  const inconsistent: Array<{
    source: string;
    total: number;
    variants: Array<{ translation: string; cnt: number; pct: number }>;
    winner: string;
    inGlossary: boolean;
    glossaryTranslation: string | undefined;
  }> = [];

  for (const [source, trMap] of bySource) {
    if (trMap.size <= 1) continue;
    const sorted = [...trMap.values()].sort((a, b) => b.cnt - a.cnt);
    const total = sorted.reduce((s, v) => s + v.cnt, 0);
    inconsistent.push({
      source,
      total,
      variants: sorted.map((v) => ({
        translation: v.translation,
        cnt: v.cnt,
        pct: Math.round((v.cnt / total) * 100),
      })),
      winner: sorted[0].translation,
      inGlossary: existingGlossary.has(source.toLowerCase()),
      glossaryTranslation: existingGlossary.get(source.toLowerCase()),
    });
  }

  inconsistent.sort(
    (a, b) =>
      b.variants.length - a.variants.length ||
      b.total - a.total ||
      a.source.localeCompare(b.source),
  );

  console.log(`\nUnique EN sources with UK translation: ${bySource.size}`);
  console.log(`Inconsistent (multiple UK variants): ${inconsistent.length}`);

  console.log(`\n=== TOP INCONSISTENCIES (min total ${MIN_COUNT}) ===`);
  const filtered = inconsistent.filter((i) => i.total >= MIN_COUNT);
  for (const item of filtered.slice(0, TOP_N)) {
    const glossNote = item.inGlossary ? ` [GLOSSARY: "${item.glossaryTranslation}"]` : '';
    console.log(`\n"${item.source}" (${item.total} uses)${glossNote}`);
    console.log(`  WIN: "${item.winner}"`);
    console.log(
      `  ALL: ${item.variants.map((v) => `"${v.translation}" (${v.cnt}, ${v.pct}%)`).join(' | ')}`,
    );
  }

  // Short proper nouns / title-case terms that appear as standalone strings
  const { rows: shortTerms } = await db.query<{
    source: string;
    translation: string;
    cnt: string;
  }>(
    `SELECT s.text_raw AS source,
            trim(t.text) AS translation,
            COUNT(*)::text AS cnt
     FROM strings s
     JOIN records rec ON rec.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
       AND t.text IS NOT NULL AND trim(t.text) <> ''
     WHERE s.lang = 'en'
       AND rec.mod_id = $1
       AND length(trim(s.text_raw)) BETWEEN 3 AND 60
       AND s.text_raw !~ '[\\n\\r]'
       AND s.text_raw ~ '^[A-Z][a-zA-Z0-9 ''\\-\\.]+$'
     GROUP BY s.text_raw, trim(t.text)
     HAVING COUNT(*) >= $2
     ORDER BY COUNT(*) DESC, s.text_raw
     LIMIT 300`,
    [MOD_ID, MIN_COUNT],
  );

  const shortBySource = new Map<string, Array<{ translation: string; cnt: number }>>();
  for (const row of shortTerms) {
    const list = shortBySource.get(row.source) ?? [];
    list.push({ translation: row.translation, cnt: Number(row.cnt) });
    shortBySource.set(row.source, list);
  }

  console.log(`\n=== GLOSSARY CANDIDATES (proper-noun-like, not in base glossary) ===`);
  const candidates: Array<{
    term: string;
    translation: string;
    cnt: number;
    note: string;
    priority: number;
  }> = [];

  for (const [source, variants] of shortBySource) {
    if (existingGlossary.has(source.toLowerCase())) continue;
    const sorted = [...variants].sort((a, b) => b.cnt - a.cnt);
    const total = sorted.reduce((s, v) => s + v.cnt, 0);
    const winner = sorted[0].translation;
    const note =
      sorted.length > 1
        ? `conflict ${sorted.map((v) => `"${v.translation}"(${v.cnt})`).join(' vs ')}`
        : `consistent x${total}`;
    candidates.push({
      term: source,
      translation: winner,
      cnt: total,
      note,
      priority: (sorted.length > 1 ? 1000 : 0) + total + source.length,
    });
  }

  candidates.sort((a, b) => b.priority - a.priority || a.term.localeCompare(b.term));

  for (const g of candidates.slice(0, TOP_N)) {
    console.log(
      `{ term: '${g.term.replace(/'/g, "\\'")}', translation: '${g.translation.replace(/'/g, "\\'")}' }, // ${g.note}`,
    );
  }
  console.log(`\nTotal glossary candidates: ${candidates.length}`);

  // Frequent multi-word terms in mod not in glossary (from longer strings)
  const { rows: ngrams } = await db.query<{ term: string; cnt: string }>(
    `WITH mod_sources AS (
       SELECT DISTINCT s.text_raw
       FROM strings s
       JOIN records rec ON rec.id = s.record_id
       WHERE s.lang = 'en' AND rec.mod_id = $1
         AND length(s.text_raw) BETWEEN 5 AND 80
     )
     SELECT unnest(regexp_matches(text_raw, '[A-Z][a-z]+(?: [A-Z][a-z]+)+', 'g')) AS term,
            COUNT(*)::text AS cnt
     FROM mod_sources
     GROUP BY 1
     HAVING COUNT(*) >= 3
     ORDER BY COUNT(*) DESC
     LIMIT 100`,
    [MOD_ID],
  );

  const missingNgrams = ngrams.filter((n) => !existingGlossary.has(n.term.toLowerCase()));
  console.log(`\n=== FREQUENT MULTI-WORD PROPER TERMS (missing from glossary) ===`);
  for (const n of missingNgrams.slice(0, 50)) {
    const variants = shortBySource.get(n.term);
    const tr = variants?.[0]?.translation ?? '?';
    const conflict = variants && variants.length > 1 ? ' CONFLICT' : '';
    console.log(`  "${n.term}" x${n.cnt} → ${tr}${conflict}`);
  }

  // Compare mod translations vs base game (mod 43) for shared terms
  const { rows: shared } = await db.query<{
    source: string;
    mod_tr: string;
    base_tr: string;
    mod_cnt: string;
  }>(
    `WITH mod_tr AS (
       SELECT s.text_raw AS source, trim(t.text) AS translation, COUNT(*) AS cnt
       FROM strings s
       JOIN records rec ON rec.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
         AND t.text IS NOT NULL AND trim(t.text) <> ''
       WHERE rec.mod_id = $1 AND s.lang = 'en'
       GROUP BY s.text_raw, trim(t.text)
     ),
     mod_winner AS (
       SELECT DISTINCT ON (source) source, translation AS mod_tr, cnt AS mod_cnt
       FROM mod_tr ORDER BY source, cnt DESC
     ),
     base_tr AS (
       SELECT DISTINCT ON (s.text_raw)
              s.text_raw AS source, trim(t.text) AS base_tr
       FROM strings s
       JOIN records rec ON rec.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
         AND t.status IN ('reviewed','human')
         AND t.text IS NOT NULL AND trim(t.text) <> ''
       WHERE rec.mod_id = 43 AND s.lang = 'en'
       ORDER BY s.text_raw, t.updated_at DESC
     )
     SELECT m.source, m.mod_tr, b.base_tr, m.mod_cnt::text
     FROM mod_winner m
     JOIN base_tr b ON b.source = m.source
     WHERE lower(trim(m.mod_tr)) <> lower(trim(b.base_tr))
       AND length(m.source) >= 3
     ORDER BY m.mod_cnt DESC
     LIMIT 80`,
    [MOD_ID],
  );

  console.log(`\n=== MOD vs BASE GAME (mod 43) TRANSLATION MISMATCHES ===`);
  for (const row of shared) {
    const gloss = existingGlossary.get(row.source.toLowerCase());
    const glossNote = gloss ? ` [glossary="${gloss}"]` : '';
    console.log(
      `"${row.source}" x${row.mod_cnt}: mod="${row.mod_tr}" vs base="${row.base_tr}"${glossNote}`,
    );
  }
} finally {
  await closeDb();
}
