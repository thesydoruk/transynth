import { describe, expect, it } from '@jest/globals';
import { referenceTranslationRoutes } from '../referenceTranslations';
import { insertMod, insertString, insertTranslation, useTestDb } from '../../../testing/testDb';
import { useTestApp } from '../../../testing/testApp';

describe('reference API', () => {
  const db = useTestDb();
  const app = useTestApp(db, referenceTranslationRoutes);

  const add = (payload: object) => app().inject({ method: 'POST', url: '/api/reference', payload });

  const pair = { game: 'fo4', srcLang: 'en', tgtLang: 'uk' };

  describe('POST /api/reference', () => {
    it('adds a pair by hand, trimmed and marked manual', async () => {
      const res = await add({ ...pair, sourceText: '  Vault  ', translation: ' Сховище ' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        source_text: 'Vault',
        translation: 'Сховище',
        origin: 'manual',
        game: 'fo4',
      });
    });

    it('replaces the translation when the same source is added again', async () => {
      await add({ ...pair, sourceText: 'Vault', translation: 'Волт' });
      await add({ ...pair, sourceText: 'Vault', translation: 'Сховище' });

      const { rows } = await db().query(`SELECT translation FROM reference_translations`);
      expect(rows).toEqual([{ translation: 'Сховище' }]);
    });

    it('stores a Skyrim LE pair in the shared Skyrim base', async () => {
      const res = await add({
        ...pair,
        game: 'sle',
        sourceText: 'Whiterun',
        translation: 'Вайтран',
      });
      expect(res.json()).toMatchObject({ game: 'sse' });
    });

    it.each([
      ['no source', { translation: 'x' }],
      ['a blank source', { sourceText: '   ', translation: 'x' }],
      ['no translation', { sourceText: 'x' }],
    ])('rejects %s with 400', async (_case, body) => {
      expect((await add({ ...pair, ...body })).statusCode).toBe(400);
    });
  });

  describe('GET /api/reference', () => {
    it('filters by game and searches source and translation', async () => {
      await add({ ...pair, sourceText: 'Vault', translation: 'Сховище' });
      await add({ ...pair, sourceText: 'Raider', translation: 'Рейдер' });
      await add({ ...pair, game: 'sse', sourceText: 'Whiterun', translation: 'Вайтран' });

      const res = await app().inject({
        url: '/api/reference?game=fo4&srcLang=en&tgtLang=uk&q=рейд',
      });

      expect(res.json()).toMatchObject({ total: 1, rows: [{ source_text: 'Raider' }] });
    });
  });

  describe('PUT /api/reference/:id', () => {
    it('edits a row and makes it manual', async () => {
      const { id } = (await add({ ...pair, sourceText: 'Vault', translation: 'Волт' })).json();
      await db().query(`UPDATE reference_translations SET origin = 'promote' WHERE id = $1`, [id]);

      const res = await app().inject({
        method: 'PUT',
        url: `/api/reference/${id}`,
        payload: { translation: 'Сховище' },
      });

      expect(res.json()).toMatchObject({ translation: 'Сховище', origin: 'manual' });
    });

    it('answers 409 when the new source collides with another row', async () => {
      await add({ ...pair, sourceText: 'Vault', translation: 'Сховище' });
      const { id } = (await add({ ...pair, sourceText: 'Vlt', translation: 'Сховище' })).json();

      const res = await app().inject({
        method: 'PUT',
        url: `/api/reference/${id}`,
        payload: { sourceText: 'Vault' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('answers 404 for a missing row, 400 for an emptied field', async () => {
      const put = (id: number | string, payload: object) =>
        app().inject({ method: 'PUT', url: `/api/reference/${id}`, payload });
      expect((await put(999, { translation: 'x' })).statusCode).toBe(404);
      expect((await put(1, { translation: '  ' })).statusCode).toBe(400);
      expect((await put('abc', { translation: 'x' })).statusCode).toBe(400);
    });
  });

  describe('deleting', () => {
    it('deletes one row, then a batch', async () => {
      const ids = [];
      for (const word of ['A', 'B', 'C']) {
        ids.push((await add({ ...pair, sourceText: word, translation: word })).json().id);
      }

      expect(
        (await app().inject({ method: 'DELETE', url: `/api/reference/${ids[0]}` })).json(),
      ).toEqual({ ok: true });
      const batch = await app().inject({
        method: 'POST',
        url: '/api/reference/batch-delete',
        payload: { ids: [ids[1], ids[2], ids[2]] },
      });
      expect(batch.json()).toEqual({ ok: true, deleted: 2 });
      expect(
        (await app().inject({ method: 'DELETE', url: `/api/reference/${ids[0]}` })).statusCode,
      ).toBe(404);
    });
  });

  describe('POST /api/reference/promote', () => {
    const promote = (payload: object) =>
      app().inject({ method: 'POST', url: '/api/reference/promote', payload });

    it('copies the reviewed lines of a mod, not its drafts', async () => {
      const modId = await insertMod(db());
      const reviewed = await insertString(db(), { modId, text: 'Sturges', formid: '01' });
      await insertTranslation(db(), { stringId: reviewed, text: 'Стерджес', status: 'reviewed' });
      const draft = await insertString(db(), { modId, text: 'Preston', formid: '02' });
      await insertTranslation(db(), { stringId: draft, text: 'Престон', status: 'draft' });

      const res = await promote({ modIds: [modId], targetLang: 'uk' });

      expect(res.json()).toEqual({ ok: true, promoted: 1 });
      const { rows } = await db().query(`SELECT source_text, origin FROM reference_translations`);
      expect(rows).toEqual([{ source_text: 'Sturges', origin: 'promote' }]);
    });

    it('takes drafts too when asked for them', async () => {
      const modId = await insertMod(db());
      const draft = await insertString(db(), { modId, text: 'Preston', formid: '02' });
      await insertTranslation(db(), { stringId: draft, text: 'Престон', status: 'draft' });

      const res = await promote({ stringIds: [draft], targetLang: 'uk', statuses: ['draft'] });

      expect(res.json()).toEqual({ ok: true, promoted: 1 });
    });

    it.each([
      ['neither list', {}],
      ['both lists', { modIds: [1], stringIds: [1] }],
      ['an empty list', { modIds: [] }],
      ['a bad id', { stringIds: [1, -1] }],
      ['an unknown status', { modIds: [1], statuses: ['banana'] }],
      ['an empty status list', { modIds: [1], statuses: [] }],
    ])('rejects %s with 400', async (_case, payload) => {
      expect((await promote(payload)).statusCode).toBe(400);
    });
  });
});
