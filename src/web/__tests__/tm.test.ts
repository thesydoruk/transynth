/**
 * Unit tests for the TM auto-apply module (tm.ts).
 *
 * The batch TM system uses findBestMatch() internally (not exported),
 * so we test through applyTMToMod() with a stubbed DB.
 */
import { beforeAll, describe, it, expect, jest } from '@jest/globals';
import type { Tx } from '../../db';

type QueryCb = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
const makeTxStub = (cb: QueryCb): Tx => {
  const lastTranslationId = 999;
  let lastTranslationText = '';

  const runQuery = async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] };
    }

    if (sql.includes('DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, updated_at)')) {
      lastTranslationText = String(params?.[2] ?? '');
      return { rows: [{ id: lastTranslationId }] };
    }

    if (sql.includes('INSERT INTO translation_revisions(')) {
      return { rows: [] };
    }

    if (sql.includes('SELECT s.text_raw AS source, t.id AS translation_id, t.text AS translation,')) {
      return {
        rows: [{
          source: 'stub source text',
          translation_id: lastTranslationId,
          translation: lastTranslationText,
          signature: 'WEAP',
          path: 'FULL',
          game: 'fo4',
        }],
      };
    }

    if (sql.includes('DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2')) {
      return { rows: [] };
    }

    if (sql.includes('SELECT term, translation FROM glossary')) {
      return { rows: [] };
    }

    if (sql.includes('SELECT DISTINCT t2.text')) {
      return { rows: [] };
    }

    return cb(sql, params);
  };

  const client = {
    query: runQuery,
    release: () => undefined,
  };

  return {
    query: runQuery,
    connect: async () => client,
  } as unknown as Tx;
};

jest.unstable_mockModule('../queries.js', async () => {
  return {
    upsertTranslation: jest.fn(async () => ({ id: 999, text: '', status: 'fuzzy' })),
  };
});

let applyTMToMod: typeof import('../tm.js').applyTMToMod;

beforeAll(async () => {
  ({ applyTMToMod } = await import('../tm.js'));
});

describe('applyTMToMod — phrase segmentation (method 6)', () => {
  it('applies phrase match when ALL segments have translations', async () => {
    const db = makeTxStub(async (sql, params) => {
      if (sql.includes('NOT EXISTS')) {
        return {
          rows: [{
            id: 1,
            text_raw: 'Hello world. How are you?',
            text_norm: 'hello world. how are you?',
            text_norm_nopunct: 'hello world how are you',
            formid_hex: '00012345',
            path: 'FULL',
            edid: 'SomeEdid',
          }],
        };
      }

      if (sql.includes('formid_hex') && sql.includes('r.path')) {
        return { rows: [] };
      }

      if (sql.includes('r.edid') && !sql.includes('text_norm')) {
        return { rows: [] };
      }

      if (sql.includes('s.text_norm = $2') && sql.includes('s.text_raw') && !sql.includes('s.text_norm_nopunct')) {
        if (params?.[1] === 'hello world. how are you?') return { rows: [] };
        if (params?.[1] === 'hello world.') {
          return { rows: [{ text: 'Привіт світ.' }] };
        }
        if (params?.[1] === 'how are you?') {
          return { rows: [{ text: 'Як справи?' }] };
        }
        return { rows: [] };
      }

      if (sql.includes('text_norm_nopunct')) {
        return { rows: [] };
      }

      if (sql.includes('similarity')) {
        return { rows: [] };
      }

      if (sql.includes('s.text_norm = $2') && !sql.includes('s.text_raw')) {
        if (params?.[1] === 'hello world.') {
          return { rows: [{ text: 'Привіт світ.' }] };
        }
        if (params?.[1] === 'how are you?') {
          return { rows: [{ text: 'Як справи?' }] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    });

    const result = await applyTMToMod(db, 99, 'uk');
    expect(result.applied).toBe(1);
    expect(result.byMethod.phrase).toBe(1);
  });

  it('skips phrase match when ANY segment is missing a translation', async () => {
    const db = makeTxStub(async (sql, params) => {
      if (sql.includes('NOT EXISTS')) {
        return {
          rows: [{
            id: 2,
            text_raw: 'Hello world. Unknown fragment?',
            text_norm: 'hello world. unknown fragment?',
            text_norm_nopunct: 'hello world unknown fragment',
            formid_hex: null,
            path: 'FULL',
            edid: null,
          }],
        };
      }

      if (sql.includes('s.text_norm = $2') && sql.includes('s.text_raw')) {
        return { rows: [] };
      }

      if (sql.includes('text_norm_nopunct')) {
        return { rows: [] };
      }

      if (sql.includes('similarity')) {
        return { rows: [] };
      }

      if (sql.includes('s.text_norm = $2') && !sql.includes('s.text_raw')) {
        if (params?.[1] === 'hello world.') {
          return { rows: [{ text: 'Привіт світ.' }] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    });

    const result = await applyTMToMod(db, 99, 'uk');
    expect(result.applied).toBe(0);
    expect(result.byMethod.phrase).toBe(0);
  });

  it('does not try phrase segmentation for single-clause text', async () => {
    const queryCalls: string[] = [];
    const db = makeTxStub(async (sql) => {
      queryCalls.push(sql.slice(0, 50));

      if (sql.includes('NOT EXISTS')) {
        return {
          rows: [{
            id: 3,
            text_raw: 'Short text',
            text_norm: 'short text',
            text_norm_nopunct: 'short text',
            formid_hex: null,
            path: 'FULL',
            edid: null,
          }],
        };
      }

      return { rows: [] };
    });

    const result = await applyTMToMod(db, 99, 'uk');
    expect(result.applied).toBe(0);
    expect(queryCalls.filter((q) => q.includes('text_norm')).length).toBeLessThanOrEqual(3);
  });
});