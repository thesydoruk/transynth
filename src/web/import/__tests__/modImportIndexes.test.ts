import type { Tx } from '../../../db';
import {
  DEFERRED_IMPORT_INDEXES,
  MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY,
  MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY,
  deferredImportIndexDropSql,
  isPgDeadlockError,
  releaseDeferredImportIndexLock,
  restoreDeferredImportIndexes,
  tryBeginDeferredImportIndexes,
  withDeferredImportIndexes,
  withModImportWriteLock,
} from '../modImportIndexes';

describe('deferredImportIndexDropSql', () => {
  it('lists every deferred index name', () => {
    const sql = deferredImportIndexDropSql();
    expect(sql).toMatch(/^DROP INDEX IF EXISTS /);
    for (const idx of DEFERRED_IMPORT_INDEXES) {
      expect(sql).toContain(idx.name);
    }
  });
});

describe('tryBeginDeferredImportIndexes', () => {
  it('drops indexes when advisory lock is acquired', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        return { rows: [] };
      },
    };

    const deferred = await tryBeginDeferredImportIndexes(db as unknown as Tx);
    expect(deferred).toBe(true);
    expect(queries.some((q) => q.startsWith('DROP INDEX IF EXISTS'))).toBe(true);
  });

  it('skips drop when advisory lock is not acquired', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: false }] };
        return { rows: [] };
      },
    };

    const deferred = await tryBeginDeferredImportIndexes(db as unknown as Tx);
    expect(deferred).toBe(false);
    expect(queries.some((q) => q.startsWith('DROP INDEX'))).toBe(false);
  });
});

describe('restoreDeferredImportIndexes', () => {
  it('recreates each index and releases the lock', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes('pg_advisory_unlock')) {
          expect(params?.[0]).toBe(MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY);
        }
        return { rows: [] };
      },
    };

    await restoreDeferredImportIndexes(db as unknown as Tx);

    for (const idx of DEFERRED_IMPORT_INDEXES) {
      expect(queries.some((q) => q.includes(idx.name))).toBe(true);
    }
    expect(queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
  });
});

describe('withDeferredImportIndexes', () => {
  it('runs fn without touching indexes when disabled', async () => {
    const db = {
      query: async () => {
        throw new Error('should not query');
      },
    };

    const value = await withDeferredImportIndexes(db as unknown as Tx, false, async () => 42);
    expect(value).toBe(42);
  });

  it('restores indexes after fn completes', async () => {
    let phase = 'begin';
    const db = {
      query: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.startsWith('DROP INDEX')) {
          expect(phase).toBe('begin');
          return { rows: [] };
        }
        if (sql.includes('CREATE INDEX')) {
          expect(phase).toBe('done');
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_unlock')) return { rows: [] };
        return { rows: [] };
      },
    };

    const value = await withDeferredImportIndexes(db as unknown as Tx, true, async () => {
      phase = 'done';
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(phase).toBe('done');
  });

  it('restores indexes when fn throws', async () => {
    let restoreStarted = false;
    const db = {
      query: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.startsWith('CREATE INDEX')) restoreStarted = true;
        return { rows: [] };
      },
    };

    await expect(
      withDeferredImportIndexes(db as unknown as Tx, true, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(restoreStarted).toBe(true);
  });
});

describe('releaseDeferredImportIndexLock', () => {
  it('issues advisory unlock', async () => {
    let unlocked = false;
    const db = {
      query: async (sql: string) => {
        if (sql.includes('pg_advisory_unlock')) unlocked = true;
        return { rows: [] };
      },
    };
    await releaseDeferredImportIndexLock(db as unknown as Tx);
    expect(unlocked).toBe(true);
  });
});

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
});
