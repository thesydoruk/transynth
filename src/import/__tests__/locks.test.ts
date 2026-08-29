import type { Tx } from '../../db';
import {
  MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY,
  isPgDeadlockError,
  withModImportWriteLock,
  withPinnedModImportWriteLock,
} from '../locks';

describe('isPgDeadlockError', () => {
  it('detects SQLSTATE 40P01', () => {
    expect(isPgDeadlockError(Object.assign(new Error('deadlock'), { code: '40P01' }))).toBe(true);
  });

  it('detects message substring', () => {
    expect(isPgDeadlockError(new Error('deadlock detected'))).toBe(true);
  });
});

describe('withModImportWriteLock', () => {
  it('acquires and releases the write advisory lock', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        expect(params?.[0]).toBe(MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY);
        return { rows: [] };
      },
    };

    const value = await withModImportWriteLock(db as unknown as Tx, async () => 42);
    expect(value).toBe(42);
    expect(queries.filter((q) => q.includes('pg_advisory_lock'))).toHaveLength(1);
    expect(queries.filter((q) => q.includes('pg_advisory_unlock'))).toHaveLength(1);
  });

  it('releases the lock when fn throws', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    };

    await expect(
      withModImportWriteLock(db as unknown as Tx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
  });
});

describe('withPinnedModImportWriteLock', () => {
  it('runs fn on the same client that holds the lock', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    };

    const value = await withPinnedModImportWriteLock(db as unknown as Tx, async (client) => {
      expect(client).toBe(db);
      return 7;
    });

    expect(value).toBe(7);
    expect(queries.some((q) => q.includes('pg_advisory_lock'))).toBe(true);
    expect(queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
    expect(queries.some((q) => q.includes('INDEX'))).toBe(false);
  });
});
