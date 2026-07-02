import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { writeFileSync } from 'fs';

const MORPH_PATHS = ['RACE\\FMRN', 'FMRN', 'RACE\\MPPN', 'RACE\\TTGP'];
/** Prefer BDD UA pack, then base game, then WorkshopPlus (often has cleaner morph labels). */
const CANON_MOD_PRIORITY = [2, 43, 44];

const ADJECTIVE_CANON: Record<string, string> = {
  Prominent: 'Виразний',
  Chiseled: 'Висічений',
  Alert: 'Тривога',
  Downturned: 'Знижений',
  Wide: 'Широкий',
  Narrow: 'Вузький',
  Small: 'Малий',
  Full: 'Повний',
  Tired: 'Втомлений',
  Rested: 'Відпочивший',
  Piercing: 'Пронизливий',
  Pout: 'Надутий',
  Shrewd: 'Хитрий',
  Roman: 'Римський',
  Lobeless: 'Без мочки',
  Malformed: 'Деформований',
  Angled: 'Кутовий',
  Average: 'Середній',
};

const MANUAL_OVERRIDES: Record<string, string> = {
  'Nose Bridge': 'Переносиця',
  'Nose - Bridge': 'Переносиця',
  Forehead: 'Лоб',
  'Nose Tip': 'Кінчик носа',
  'Nose - Tip': 'Кінчик носа',
  Scars: 'Шрами',
  FaceDetails: 'Деталі обличчя',
  SkinTints: 'Відтінки шкіри',
  'Skin tone': 'Колір шкіри',
  Brows: 'Брови',
  'Eyelids - Top': 'Верхня повіка',
  'Eyelids - Bottom': 'Нижня повіка',
  'Jaw - Middle': 'Середина щелепи',
  'Jowls - Lower': 'Нижні щоки',
  'Jowls -  Lower': 'Нижні щоки',
  'Jowls - Upper': 'Верхні щоки',
  'Nose - Ridge': 'Гребінь носа',
  Blemishes: 'Подразнення',
  Freckles: 'Веснянки',
  Moles: 'Родимки',
  Dirt: 'Бруд',
  Chin: 'Підборіддя',
  Neck: 'Шия',
  Temple: 'Скроня',
  'Face - Lower': 'Нижня частина обличчя',
  Cheekbones: 'Вилиці',
  'Cheek Bones': 'Вилиці',
  'Cheekbones - Back': 'Вилиці — задня частина',
  'Cheek Bones Back': 'Вилиці — задня частина',
  'Moles - Nose': 'Родинки — ніс',
  'Moles - Full Face': 'Родинки — все обличчя',
  Damage: 'Пошкодження',
};

const normalizeDash = (s: string): string =>
  s
    .replace(/\s*[-–—]\s*/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim();

const isUntranslated = (source: string, translation: string): boolean => {
  const s = source.trim().toLowerCase();
  const t = translation.trim().toLowerCase();
  if (s === t) return true;
  if (/^[a-z0-9 .,'\-:()]+$/i.test(translation) && !/[а-яіїєґ]/i.test(translation)) return true;
  return false;
};

const numberedAdjectiveFix = (source: string): string | null => {
  const m = source.match(/^([A-Za-z]+)\s+(\d+)$/);
  if (!m) return null;
  const adj = ADJECTIVE_CANON[m[1]];
  if (!adj) return null;
  return `${adj} ${m[2]}`;
};

const db = openDb();
try {
  const { rows } = await db.query<{
    source: string;
    translation: string;
    mod_id: number;
    cnt: string;
  }>(
    `SELECT s.text_raw AS source,
            trim(t.text) AS translation,
            r.mod_id,
            COUNT(*)::text AS cnt
     FROM strings s
     JOIN records rec ON rec.id = s.record_id
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
       AND t.text IS NOT NULL AND trim(t.text) <> ''
     WHERE s.lang = 'en'
       AND rec.path = ANY($1::text[])
     GROUP BY s.text_raw, trim(t.text), r.mod_id
     ORDER BY s.text_raw, COUNT(*) DESC`,
    [MORPH_PATHS],
  );

  type Entry = { translation: string; modId: number; cnt: number };
  const bySource = new Map<string, Entry[]>();
  for (const row of rows) {
    const list = bySource.get(row.source) ?? [];
    list.push({ translation: row.translation, modId: row.mod_id, cnt: Number(row.cnt) });
    bySource.set(row.source, list);
  }

  const pickCanon = (source: string, entries: Entry[]): string | null => {
    if (MANUAL_OVERRIDES[source]) return MANUAL_OVERRIDES[source];

    const numbered = numberedAdjectiveFix(source);
    if (numbered) return numbered;

    const good = entries.filter((e) => !isUntranslated(source, e.translation));
    if (good.length === 0) return null;

    for (const modId of CANON_MOD_PRIORITY) {
      const modEntries = good.filter((e) => e.modId === modId);
      if (modEntries.length === 0) continue;
      const byTr = new Map<string, number>();
      for (const e of modEntries) byTr.set(e.translation, (byTr.get(e.translation) ?? 0) + e.cnt);
      return [...byTr.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    const byTr = new Map<string, number>();
    for (const e of good) byTr.set(e.translation, (byTr.get(e.translation) ?? 0) + e.cnt);
    return [...byTr.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  let skipped = 0;
  let inconsistent = 0;
  const glossary: Array<{ term: string; translation: string }> = [];

  for (const [term, entries] of [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(entries.map((e) => e.translation)).size > 1) inconsistent++;
    const picked = pickCanon(term, entries);
    if (!picked || isUntranslated(term, picked)) {
      skipped++;
      continue;
    }
    glossary.push({ term, translation: normalizeDash(picked) });
  }

  const lines = glossary.map(
    (g) => `  { term: ${JSON.stringify(g.term)}, translation: ${JSON.stringify(g.translation)} },`,
  );

  const fileContent = `/**
 * Fallout 4 RACE face editor glossary (FMRN / MPPN / TTGP).
 *
 * Canonical EN→UK pairs for character creation morph sliders, presets, and
 * face-detail labels. Generated from DB (mods 2/43/44) with manual overrides.
 *
 * Regenerate: \`node --import tsx scripts/_analyzeRaceGlossary.ts\`
 * Merged into \`FO4_UK_GLOSSARY\` — run \`npm run db:seed:glossary\` after edits.
 */
import type { GlossaryEntry } from './types';

export const FO4_RACE_UK_GLOSSARY: GlossaryEntry[] = [
${lines.join('\n')}
];
`;

  writeFileSync('src/resources/glossary/fo4-race-uk.ts', fileContent, 'utf8');
  console.log(
    `Entries: ${glossary.length}, skipped (no UA canon): ${skipped}, inconsistent in DB: ${inconsistent}`,
  );
} finally {
  await closeDb();
}
