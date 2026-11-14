import type { Tx } from '../../../../db';
import {
  promoteTranslationsToReference,
  REFERENCE_PROMOTE_STATUSES,
  referenceListWhere,
  updateReferenceTranslation,
} from '../referenceTranslations';

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

type ModRow = { id: number; name: string; abs_path: string | null; vortex_plugin: string | null };

/** Records every statement; the origin lookup (`FROM mods`) answers with `mods`. */
const makeDb = (mods: ModRow[] = []) => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql: compactSql(sql), params });
      const rows = /FROM mods m/.test(sql) ? mods.map((mod) => ({ ...mod, game: 'fo4' })) : [];
      return { rows, rowCount: 3 };
    },
  } as unknown as Tx;
  return { db, calls };
};

describe('referenceListWhere', () => {
  it('always scopes to the game storage key', () => {
    const where = referenceListWhere({ game: 'fo4' });
    expect(where.sql).toBe('game = $1');
    expect(where.values).toEqual(['fo4']);
  });

  it('folds an edition onto its shared key, like the glossary', () => {
    // Skyrim LE reads Skyrim SE's glossary and therefore its reference base.
    const where = referenceListWhere({ game: 'sle' });
    expect(where.values[0]).toBe('sse');
  });

  it('adds language and search filters with one bound parameter per value', () => {
    const where = referenceListWhere({ game: 'fo4', srcLang: 'en', tgtLang: 'uk', q: ' Vault ' });
    expect(where.sql).toBe(
      'game = $1 AND src_lang = $2 AND tgt_lang = $3 AND (source_text ILIKE $4 OR translation ILIKE $4 OR edid ILIKE $4)',
    );
    expect(where.values).toEqual(['fo4', 'en', 'uk', '%Vault%']);
  });

  it('ignores a blank search string', () => {
    const where = referenceListWhere({ game: 'fo4', q: '   ' });
    expect(where.sql).toBe('game = $1');
  });
});

describe('promoteTranslationsToReference', () => {
  it('defaults to reviewed and human, the statuses the RAG index trusts', () => {
    expect(REFERENCE_PROMOTE_STATUSES).toEqual(['reviewed', 'human']);
  });

  it('writes nothing for an empty scope', async () => {
    const { db, calls } = makeDb();
    await expect(
      promoteTranslationsToReference(db, { modIds: [], origin: 'promote' }),
    ).resolves.toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('writes nothing when no mod stands behind the scope', async () => {
    const { db, calls } = makeDb();
    await expect(
      promoteTranslationsToReference(db, { modIds: [404], origin: 'promote' }),
    ).resolves.toBe(0);
    expect(calls.map((call) => call.sql).join(' ')).not.toContain('INSERT INTO');
  });

  const mods: ModRow[] = [
    { id: 7, name: 'Fallout4', abs_path: '/mods/base/Fallout4.esm', vortex_plugin: null },
    { id: 9, name: 'UFO4P-4598-2-1-6', abs_path: null, vortex_plugin: 'unofficial fallout 4 patch.esp' },
  ];
  const insertOf = (calls: { sql: string; params?: unknown[] }[]) =>
    calls.filter((call) => call.sql.startsWith('INSERT INTO reference_translations')).at(-1)!;

  it('scopes by mod or by string and never overwrites a hand-edited row', async () => {
    const { db, calls } = makeDb(mods);
    await promoteTranslationsToReference(db, {
      modIds: [7, 7, 9],
      targetLang: 'uk',
      origin: 'delete_snapshot',
    });
    const byMod = insertOf(calls);
    expect(byMod.sql).toContain('r.mod_id = ANY($1::int[])');
    expect(byMod.sql).toContain("WHERE reference_translations.origin <> 'manual'");
    expect(byMod.params?.slice(0, 4)).toEqual([
      [7, 7, 9],
      'uk',
      ['reviewed', 'human'],
      'delete_snapshot',
    ]);

    await promoteTranslationsToReference(db, {
      stringIds: [1, 2],
      statuses: ['reviewed'],
      origin: 'promote',
    });
    const byString = insertOf(calls);
    expect(byString.sql).toContain('s.id = ANY($1::int[])');
    expect(byString.params?.[2]).toEqual(['reviewed']);
  });

  it('writes every mod into the layer of its plugin', async () => {
    const { db, calls } = makeDb(mods);
    await promoteTranslationsToReference(db, { modIds: [7, 9], origin: 'promote' });

    const insert = insertOf(calls);
    expect(insert.sql).toContain(
      'ON CONFLICT (game, src_lang, tgt_lang, formid_hex, path, md5(source_text), origin_key)',
    );
    expect(insert.params?.slice(4)).toEqual([
      [7, 9],
      ['fallout4.esm', 'unofficial fallout 4 patch.esp'],
    ]);
  });
});

describe('updateReferenceTranslation', () => {
  it('recomputes text_norm only when the source text changes', async () => {
    const { db, calls } = makeDb();
    await updateReferenceTranslation(db, 5, { translation: 'Сховище 111' });
    expect(calls[0]!.params).toEqual([5, null, null, 'Сховище 111', null, false]);

    await updateReferenceTranslation(db, 5, { sourceText: 'Vault  111', note: 'x' });
    expect(calls[1]!.params).toEqual([5, 'Vault  111', 'vault ¤num¤', null, 'x', true]);
    expect(calls[1]!.sql).toContain("origin = 'manual'");
  });
});
