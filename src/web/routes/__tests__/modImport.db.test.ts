import { describe, expect, it, jest } from '@jest/globals';

// Whether a job sits in the BullMQ queue is Redis's business; here nothing is queued
// unless a test says so.
const isImportQueued = jest.fn(async () => false);
jest.unstable_mockModule('../../../../worker/src/api/importJobs', () => ({
  isImportQueued,
  listQueuedImportIds: async () => new Set<number>(),
  cancelQueuedImport: async () => false,
  pauseQueuedImport: async () => false,
}));

const { modImportRoutes } = await import('../modImport');
const { insertMod, insertString, insertTranslation, useTestDb } =
  await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

describe('DELETE /api/mod-import/:id', () => {
  const db = useTestDb();
  const app = useTestApp(db, modImportRoutes);

  const count = async (table: string) =>
    (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

  /** An import job pointing at a mod with one reviewed and one draft line. */
  const importedMod = async () => {
    const modId = await insertMod(db(), { name: 'Imported' });
    const reviewed = await insertString(db(), { modId, text: 'Sturges', formid: '01' });
    await insertTranslation(db(), { stringId: reviewed, text: 'Стерджес', status: 'reviewed' });
    const draft = await insertString(db(), { modId, text: 'Preston', formid: '02' });
    await insertTranslation(db(), { stringId: draft, text: 'Престон', status: 'draft' });
    const { rows } = await db().query<{ id: number }>(
      `INSERT INTO mod_imports(file_name, file_hash, mod_id, status)
       VALUES ('Imported.7z', 'hash-1', $1, 'done') RETURNING id`,
      [modId],
    );
    return { modId, jobId: rows[0]!.id };
  };

  const remove = (jobId: number | string, query = '') =>
    app().inject({ method: 'DELETE', url: `/api/mod-import/${jobId}${query}` });

  it('deletes the job and its mod by default, keeping reviewed lines', async () => {
    const { jobId } = await importedMod();

    expect((await remove(jobId)).json()).toEqual({ ok: true });

    expect(await count('mod_imports')).toBe(0);
    expect(await count('mods')).toBe(0);
    expect(await count('reference_translations')).toBe(1);
  });

  it('keeps nothing with keepReference=false', async () => {
    const { jobId } = await importedMod();

    await remove(jobId, '?keepReference=false');

    expect(await count('reference_translations')).toBe(0);
  });

  it('with deleteData=rows empties the mod but keeps it, and drops the job', async () => {
    const { jobId } = await importedMod();

    await remove(jobId, '?deleteData=rows');

    expect(await count('mods')).toBe(1);
    expect(await count('records')).toBe(0);
    expect(await count('mod_imports')).toBe(0);
    expect(await count('reference_translations')).toBe(1);
  });

  it('with deleteData=job drops only the job', async () => {
    const { jobId } = await importedMod();

    await remove(jobId, '?deleteData=job');

    expect(await count('mod_imports')).toBe(0);
    expect(await count('records')).toBe(2);
    expect(await count('reference_translations')).toBe(0);
  });

  it('refuses to delete a job that is still queued', async () => {
    const { jobId } = await importedMod();
    isImportQueued.mockResolvedValueOnce(true);

    expect((await remove(jobId)).statusCode).toBe(409);
    expect(await count('mods')).toBe(1);
  });

  it('answers 404 for a missing job, 400 for a bad mode or id', async () => {
    expect((await remove(999)).statusCode).toBe(404);
    expect((await remove(1, '?deleteData=everything')).statusCode).toBe(400);
    expect((await remove('abc')).statusCode).toBe(400);
  });
});
