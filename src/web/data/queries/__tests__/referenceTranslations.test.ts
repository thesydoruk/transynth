import type { Tx } from '../../../../db';
import {
  promoteTranslationsToReference,
  REFERENCE_PROMOTE_STATUSES,
  referenceListWhere,
  updateReferenceTranslation,
} from '../referenceTranslations';

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const makeDb = () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql: compactSql(sql), params });
      return { rows: [], rowCount: 3 };
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

  it('scopes by mod or by string and never overwrites a hand-edited row', async () => {
    const { db, calls } = makeDb();
    await promoteTranslationsToReference(db, {
      modIds: [7, 7, 9],
      targetLang: 'uk',
      origin: 'delete_snapshot',
    });
    expect(calls[0]!.sql).toContain('r.mod_id = ANY($1::int[])');
    expect(calls[0]!.sql).toContain("WHERE reference_translations.origin <> 'manual'");
    expect(calls[0]!.params).toEqual([[7, 7, 9], 'uk', ['reviewed', 'human'], 'delete_snapshot']);

    await promoteTranslationsToReference(db, {
      stringIds: [1, 2],
      statuses: ['reviewed'],
      origin: 'promote',
    });
    expect(calls[1]!.sql).toContain('s.id = ANY($1::int[])');
    expect(calls[1]!.params?.[2]).toEqual(['reviewed']);
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
