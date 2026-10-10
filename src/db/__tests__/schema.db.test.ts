import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { runSchema } from '..';
import { allGameIds } from '../../games/registry';
import { insertMod, insertString, insertTranslation, useTestDb } from '../../testing/testDb';

const SCHEMA_SQL = fs.readFileSync(path.resolve('sql/schema.sql'), 'utf8');

describe('sql/schema.sql', () => {
  const db = useTestDb();

  // The schema does not migrate on container start: production runs
  // `npm run db:init` by hand after every pull, over live data.
  it('applies again over existing data without losing it', async () => {
    const modId = await insertMod(db());
    const stringId = await insertString(db(), { modId, text: 'Sturges', formid: '0001F00A' });
    await insertTranslation(db(), { stringId, text: 'Стерджес' });

    await runSchema(db(), SCHEMA_SQL);
    await runSchema(db(), SCHEMA_SQL);

    const { rows } = await db().query(
      `SELECT t.text FROM translations t JOIN strings s ON s.id = t.src_string_id
        WHERE s.id = $1`,
      [stringId],
    );
    expect(rows).toEqual([{ text: 'Стерджес' }]);
  });

  it('seeds the first-run QA rule once per game, and never over edited rules', async () => {
    await runSchema(db(), SCHEMA_SQL);
    await runSchema(db(), SCHEMA_SQL);
    const { rows: seeded } = await db().query<{ game: string }>(
      `SELECT game FROM qa_rules ORDER BY game`,
    );
    expect(seeded.map((r) => r.game)).toEqual([...allGameIds()].sort());

    await db().query(`DELETE FROM qa_rules WHERE game <> 'fo4'`);
    await runSchema(db(), SCHEMA_SQL);
    const { rows: kept } = await db().query(`SELECT game FROM qa_rules`);
    expect(kept).toEqual([{ game: 'fo4' }]);
  });

  it('holds one translation per source string and language', async () => {
    const modId = await insertMod(db());
    const stringId = await insertString(db(), { modId, text: 'Sturges' });
    await insertTranslation(db(), { stringId, text: 'Стерджес' });

    await expect(insertTranslation(db(), { stringId, text: 'Стьорджес' })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      insertTranslation(db(), { stringId, text: 'Sturges', targetLang: 'de' }),
    ).resolves.toBeGreaterThan(0);
  });
});
