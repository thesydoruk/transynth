/**
 * Unit tests for the TM auto-apply module (tm.ts).
 *
 * The batch TM system uses findBestMatch() internally (not exported),
 * so we test through applyTMToMod() with a stubbed DB. Each test stubs
 * the DB to return controlled data and verifies the method dispatches
 * correctly — especially the new phrase segmentation (method 6).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Tx } from '../db.js';

/**
 * Build a minimal Tx stub that routes queries to a callback.
 * The callback receives the SQL string and the parameters array.
 */
type QueryCb = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
const makeTxStub = (cb: QueryCb): Tx => ({ query: cb }) as unknown as Tx;

/* ─────────────────────────────────────────────────────────────────────────── */
/* We need to mock withTransaction so that applyTMToMod uses the single      */
/* stubbed client rather than opening a real PostgreSQL transaction.           */
/* ─────────────────────────────────────────────────────────────────────────── */
vi.mock('../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db.js')>();
  return {
    ...actual,
    /**
     * Stubbed withTransaction: instead of opening a real PG transaction,
     * it simply calls the callback with the pool argument itself (which is
     * our Tx stub in tests).
     */
    withTransaction: async (_pool: unknown, fn: (client: Tx) => Promise<void>) => {
      await fn(_pool as Tx);
    },
  };
});

/**
 * Mock upsertTranslation to avoid real DB side effects (revision tracking,
 * QA refresh, etc.). Returns a minimal result with a fake translation id.
 */
vi.mock('./queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries.js')>();
  return {
    ...actual,
    upsertTranslation: vi.fn(async () => ({ id: 999, text: '', status: 'fuzzy' })),
  };
});

/* Import after mocks are set up */
const { applyTMToMod } = await import('./tm.js');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyTMToMod — phrase segmentation (method 6)', () => {
  it('applies phrase match when ALL segments have translations', async () => {
    /**
     * Scenario: mod has one untranslated string "Hello world. How are you?"
     * which splits into two segments: "Hello world." and "How are you?"
     * Both segments exist as text_norm in the DB with translations.
     */
    const db = makeTxStub(async (sql, params) => {
      /* 1. Untranslated strings query */
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

      /* 2. Anchor lookup — no match */
      if (sql.includes('formid_hex') && sql.includes('r.path')) {
        return { rows: [] };
      }

      /* 3. EDID lookup — no match */
      if (sql.includes('r.edid') && !sql.includes('text_norm')) {
        return { rows: [] };
      }

      /* 4. text_norm exact match — no match */
      if (sql.includes('s.text_norm = $2') && sql.includes('s.text_raw') && !sql.includes('s.text_norm_nopunct')) {
        if (params?.[1] === 'hello world. how are you?') return { rows: [] };
        /* Segment lookups: */
        if (params?.[1] === 'hello world.') {
          return { rows: [{ text: 'Привіт світ.' }] };
        }
        if (params?.[1] === 'how are you?') {
          return { rows: [{ text: 'Як справи?' }] };
        }
        return { rows: [] };
      }

      /* 5. Punctuation-normalized match — no match */
      if (sql.includes('text_norm_nopunct')) {
        return { rows: [] };
      }

      /* 6. Fuzzy trigram — no match */
      if (sql.includes('similarity')) {
        return { rows: [] };
      }

      /* 7. Phrase segment lookups — text_norm = $2 without text_raw */
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
    /**
     * Scenario: mod has "Hello world. Unknown fragment?"
     * "Hello world." has a translation, but "Unknown fragment?" does not.
     * The all-or-nothing rule should skip the entire string.
     */
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

      /* text_norm exact — no full-string match */
      if (sql.includes('s.text_norm = $2') && sql.includes('s.text_raw')) {
        return { rows: [] };
      }

      /* Punct-norm — no match */
      if (sql.includes('text_norm_nopunct')) {
        return { rows: [] };
      }

      /* Fuzzy — no match */
      if (sql.includes('similarity')) {
        return { rows: [] };
      }

      /* Phrase segment lookups */
      if (sql.includes('s.text_norm = $2') && !sql.includes('s.text_raw')) {
        if (params?.[1] === 'hello world.') {
          return { rows: [{ text: 'Привіт світ.' }] };
        }
        /* "unknown fragment?" — no translation */
        return { rows: [] };
      }

      return { rows: [] };
    });

    const result = await applyTMToMod(db, 99, 'uk');
    expect(result.applied).toBe(0);
    expect(result.byMethod.phrase).toBe(0);
  });

  it('does not try phrase segmentation for single-clause text', async () => {
    /**
     * Scenario: "Short text" has no sentence boundaries → segmentPhrases returns [].
     * No phrase match should be attempted.
     */
    const queryCalls: string[] = [];
    const db = makeTxStub(async (sql, params) => {
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
    /* Verify no segment-level queries were issued (only: untranslated, text_norm, punct_norm, fuzzy) */
    expect(queryCalls.filter(q => q.includes('text_norm')).length).toBeLessThanOrEqual(3);
  });
});
