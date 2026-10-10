import { describe, expect, it } from '@jest/globals';
import { modsRoutes } from '..';
import {
  insertMod,
  insertString,
  insertTranslation,
  translationOf,
  useTestDb,
} from '../../../../testing/testDb';
import { useTestApp } from '../../../../testing/testApp';

describe('mods API', () => {
  const db = useTestDb();
  const app = useTestApp(db, modsRoutes);

  const count = async (sql: string, params: unknown[] = []) =>
    (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0]!.n;

  /** A mod with a reviewed line and a draft line. */
  const translatedMod = async (name = 'Sim Settlements 2') => {
    const modId = await insertMod(db(), { name });
    const reviewed = await insertString(db(), { modId, text: 'Sturges', formid: '01' });
    await insertTranslation(db(), { stringId: reviewed, text: 'Стерджес', status: 'reviewed' });
    const draft = await insertString(db(), { modId, text: 'Preston', formid: '02' });
    await insertTranslation(db(), { stringId: draft, text: 'Престон', status: 'draft' });
    return modId;
  };

  describe('GET /api/mods/:id', () => {
    it('answers 404 for a missing mod and 400 for a bad id', async () => {
      expect((await app().inject({ url: '/api/mods/999' })).statusCode).toBe(404);
      expect((await app().inject({ url: '/api/mods/abc' })).statusCode).toBe(400);
    });

    it('returns the mod', async () => {
      const modId = await insertMod(db(), { name: 'Sim Settlements 2' });
      const res = await app().inject({ url: `/api/mods/${modId}` });
      expect(res.json()).toMatchObject({ id: modId, name: 'Sim Settlements 2' });
    });
  });

  describe('DELETE /api/mods/:id', () => {
    it('deletes the mod and keeps its reviewed lines in the reference base', async () => {
      const modId = await translatedMod();

      const res = await app().inject({ method: 'DELETE', url: `/api/mods/${modId}` });

      expect(res.json()).toEqual({ ok: true, deletedRecords: 2, referencePromoted: 1 });
      expect(await count('mods')).toBe(0);
      expect(await count('reference_translations')).toBe(1);
    });

    it('keeps nothing with keepReference=false', async () => {
      const modId = await translatedMod();

      await app().inject({ method: 'DELETE', url: `/api/mods/${modId}?keepReference=false` });

      expect(await count('reference_translations')).toBe(0);
    });

    it('answers 404 for a mod that does not exist', async () => {
      const res = await app().inject({ method: 'DELETE', url: '/api/mods/999' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/mods/batch-delete', () => {
    const batchDelete = (payload: object) =>
      app().inject({ method: 'POST', url: '/api/mods/batch-delete', payload });

    it('deletes several mods and leaves the rest', async () => {
      const a = await translatedMod('A');
      const b = await translatedMod('B');
      const kept = await translatedMod('Kept');

      const res = await batchDelete({ modIds: [a, b], keepReference: false });

      expect(res.json()).toMatchObject({ ok: true, deletedMods: 2, deletedRecords: 4 });
      const { rows } = await db().query(`SELECT id FROM mods`);
      expect(rows).toEqual([{ id: kept }]);
    });

    it.each([
      ['no list', {}],
      ['an empty list', { modIds: [] }],
      ['a bad id', { modIds: [1, 0] }],
      ['more than 100 mods', { modIds: Array.from({ length: 101 }, (_, i) => i + 1) }],
    ])('rejects %s with 400', async (_case, payload) => {
      expect((await batchDelete(payload)).statusCode).toBe(400);
    });
  });

  describe('DELETE /api/mods/:id/rows', () => {
    it('empties the mod but keeps its entry, snapshotting reviewed lines first', async () => {
      const modId = await translatedMod();

      const res = await app().inject({ method: 'DELETE', url: `/api/mods/${modId}/rows` });

      expect(res.json()).toEqual({ ok: true, deletedRecords: 2, referencePromoted: 1 });
      expect(await count('mods WHERE id = $1', [modId])).toBe(1);
      expect(await count('records WHERE mod_id = $1', [modId])).toBe(0);
    });

    it('snapshots nothing with keepReference=false', async () => {
      const modId = await translatedMod();

      const res = await app().inject({
        method: 'DELETE',
        url: `/api/mods/${modId}/rows?keepReference=false`,
      });

      expect(res.json()).toMatchObject({ referencePromoted: 0 });
      expect(await count('reference_translations')).toBe(0);
    });
  });

  describe('POST /api/mods/:id/clear-same-as-source', () => {
    it('removes translations that only copy the source text', async () => {
      const modId = await insertMod(db());
      const copied = await insertString(db(), { modId, text: 'Vault-Tec', formid: '01' });
      await insertTranslation(db(), { stringId: copied, text: 'Vault-Tec', status: 'draft' });
      const real = await insertString(db(), { modId, text: 'Sturges', formid: '02' });
      await insertTranslation(db(), { stringId: real, text: 'Стерджес', status: 'draft' });

      const res = await app().inject({
        method: 'POST',
        url: `/api/mods/${modId}/clear-same-as-source?srcLang=en&targetLang=uk`,
      });

      expect(res.json()).toMatchObject({ cleared: 1 });
      expect(await translationOf(db(), copied)).toBeNull();
      expect(await translationOf(db(), real)).not.toBeNull();
    });
  });
});
