import type { Tx } from '../../../../db';
import { deleteModDataOnClient } from '../modsDelete';

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const isControlSql = (sql: string): boolean =>
  /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)\b/i.test(sql);

type DeleteClientOptions = {
  recordPages: number[][];
  recordCount?: number;
  stringsByRecord?: Record<number, number[]>;
  translationsByString?: Record<number, number[]>;
};

const makeClient = (opts: DeleteClientOptions) => {
  let recordPage = 0;
  const calls: { sql: string; params?: unknown[] }[] = [];

  const client = {
    query: async (sql: string, params?: unknown[]) => {
      const compact = compactSql(sql);
      calls.push({ sql: compact, params });
      if (isControlSql(compact)) return { rows: [], rowCount: 0 };
      if (/SELECT count\(/.test(compact)) {
        const n = opts.recordCount ?? opts.recordPages.flat().length;
        return { rows: [{ n: String(n) }], rowCount: 1 };
      }
      if (compact.includes('SELECT id FROM records')) {
        const page = opts.recordPages[recordPage++] ?? [];
        return { rows: page.map((id) => ({ id })), rowCount: page.length };
      }
      if (compact.includes('SELECT id FROM strings')) {
        const recordIds = params?.[0] as number[];
        const ids = recordIds.flatMap((id) => opts.stringsByRecord?.[id] ?? []);
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
      }
      if (compact.includes('SELECT id FROM translations')) {
        const stringIds = params?.[0] as number[];
        const ids = stringIds.flatMap((id) => opts.translationsByString?.[id] ?? []);
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
      }
      const affected = Array.isArray(params?.[0]) ? (params[0] as number[]).length : 0;
      return { rows: [], rowCount: affected };
    },
  };

  return { client: client as unknown as Tx, calls };
};

describe('deleteModDataOnClient', () => {
  it('skips translation_examples when the batch has no translations', async () => {
    const { client, calls } = makeClient({
      recordPages: [[10, 11], []],
      stringsByRecord: { 10: [100], 11: [101] },
    });

    const result = await deleteModDataOnClient(client, [132], 'rows');

    expect(result.deletedRecords).toBe(2);
    expect(calls.some((call) => call.sql.includes('DELETE FROM translation_examples'))).toBe(false);
    expect(calls.some((call) => /DELETE FROM translations WHERE id = ANY/.test(call.sql))).toBe(
      false,
    );
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1);
  });

  it('deletes translation_examples by translation primary key when translations exist', async () => {
    const { client, calls } = makeClient({
      recordPages: [[1], []],
      stringsByRecord: { 1: [20] },
      translationsByString: { 20: [30] },
    });

    await deleteModDataOnClient(client, [5], 'rows');

    const exampleDelete = calls.find((call) => call.sql.includes('DELETE FROM translation_examples'));
    expect(exampleDelete?.params?.[0]).toEqual([30]);
    expect(exampleDelete?.sql).toContain('translation_id = ANY');
    expect(exampleDelete?.sql.includes('IN (')).toBe(false);
  });

  it('commits each record batch so a timeout cannot roll the whole purge back', async () => {
    const { client, calls } = makeClient({
      recordPages: [[1], [2], []],
      stringsByRecord: { 1: [10], 2: [11] },
    });

    const result = await deleteModDataOnClient(client, [8], 'rows');

    expect(result.deletedRecords).toBe(2);
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(2);
    expect(calls.some((call) => call.sql.includes('DELETE FROM mods'))).toBe(false);
  });

  it('drops and restores trigram GIN indexes when purging a large mod', async () => {
    const { client, calls } = makeClient({
      recordCount: 10_000,
      recordPages: [[]],
    });

    await deleteModDataOnClient(client, [132], 'rows');

    expect(calls.some((call) => call.sql.includes('DROP INDEX IF EXISTS idx_strings_trgm_text_raw'))).toBe(
      true,
    );
    expect(
      calls.some((call) => call.sql.includes('CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_raw')),
    ).toBe(true);
  });

  it('removes dialog graph and the mod row after records when scope is mod', async () => {
    const { client, calls } = makeClient({
      recordPages: [[]],
    });

    await deleteModDataOnClient(client, [9], 'mod');

    const sql = calls.map((call) => call.sql);
    expect(sql.some((line) => line.includes('DELETE FROM dialog_topics'))).toBe(true);
    expect(sql.some((line) => line.includes('DELETE FROM mods'))).toBe(true);
  });
});
