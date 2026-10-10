import { describe, expect, it, jest } from '@jest/globals';

// The RAG index needs an embedding server; nothing here is about it.
jest.unstable_mockModule('../../../services/ragHooks', () => ({ scheduleRagSync: () => {} }));

const { stringsRoutes } = await import('..');
const { setProjectSetting } = await import('../../../services/projectSettings');
const { insertMod, insertString, insertTranslation, translationOf, useTestDb } =
  await import('../../../../testing/testDb');
const { useTestApp } = await import('../../../../testing/testApp');

describe('strings API', () => {
  const db = useTestDb();
  const app = useTestApp(db, stringsRoutes);

  const oneString = async (text = 'Sturges', modName?: string) => {
    const modId = await insertMod(db(), modName ? { name: modName } : {});
    return insertString(db(), { modId, text, formid: '0001F00A' });
  };

  const isIgnored = async (stringId: number) =>
    (await db().query(`SELECT is_ignored FROM strings WHERE id = $1`, [stringId])).rows[0]
      ?.is_ignored;

  describe('PATCH /api/strings/:id/translation', () => {
    const save = (stringId: number | string, body: object) =>
      app().inject({ method: 'PATCH', url: `/api/strings/${stringId}/translation`, payload: body });

    it('saves a draft and attributes it to the user', async () => {
      const stringId = await oneString();

      const res = await save(stringId, { text: 'Стерджес', targetLang: 'uk' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ text: 'Стерджес', status: 'draft' });
      const { rows } = await db().query(
        `SELECT status, user_id FROM translations WHERE src_string_id = $1`,
        [stringId],
      );
      expect(rows).toEqual([{ status: 'draft', user_id: 1 }]);
    });

    it('approves on save when the workflow says so', async () => {
      const stringId = await oneString();
      await setProjectSetting(db(), 'workflow.auto_approve_on_save', true);

      await save(stringId, { text: 'Стерджес', targetLang: 'uk' });

      expect((await translationOf(db(), stringId))?.status).toBe('reviewed');
    });

    it('copies the text to identical source lines in other mods, and only with the setting on', async () => {
      const edited = await oneString('Sturges', 'Edited');
      const twin = await oneString('Sturges', 'Twin');

      await save(edited, { text: 'Стерджес', targetLang: 'uk' });
      expect((await translationOf(db(), twin))?.text).toBe('Стерджес');

      await setProjectSetting(db(), 'workflow.propagate_to_identical', false);
      const third = await oneString('Sturges', 'Third');
      await save(edited, { text: 'Стьорджес', targetLang: 'uk' });
      expect(await translationOf(db(), third)).toBeNull();
    });

    it('deletes the translation when the text is cleared', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес' });

      const res = await save(stringId, { text: '   ', targetLang: 'uk' });

      expect(res.statusCode).toBe(200);
      expect(await translationOf(db(), stringId)).toBeNull();
    });

    it.each([
      ['a non-numeric id', 'abc', { text: 'x' }],
      ['a zero id', 0, { text: 'x' }],
      ['no text', 1, {}],
      ['text that is not a string', 1, { text: 42 }],
    ])('rejects %s with 400', async (_case, id, body) => {
      expect((await save(id, body)).statusCode).toBe(400);
    });

    it('rejects a status the editor does not know', async () => {
      const stringId = await oneString();

      const res = await save(stringId, { text: 'Стерджес', status: 'banana', targetLang: 'uk' });

      expect(res.statusCode).toBe(400);
      expect(await translationOf(db(), stringId)).toBeNull();
    });
  });

  describe('DELETE /api/strings/:id/translation', () => {
    it('removes only the language asked for', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес' });
      await insertTranslation(db(), { stringId, text: 'Sturges', targetLang: 'de' });

      const res = await app().inject({
        method: 'DELETE',
        url: `/api/strings/${stringId}/translation?targetLang=uk`,
      });

      expect(res.statusCode).toBe(200);
      expect(await translationOf(db(), stringId, 'uk')).toBeNull();
      expect(await translationOf(db(), stringId, 'de')).not.toBeNull();
    });
  });

  describe('PATCH /api/strings/:id/ignore', () => {
    const ignore = (stringId: number, body: object) =>
      app().inject({ method: 'PATCH', url: `/api/strings/${stringId}/ignore`, payload: body });

    it('toggles the flag both ways', async () => {
      const stringId = await oneString();

      expect((await ignore(stringId, { ignore: true })).json()).toEqual({
        id: stringId,
        is_ignored: true,
      });
      await ignore(stringId, { ignore: false });
      expect(await isIgnored(stringId)).toBe(false);
    });

    it('answers 404 for a string that does not exist, 400 without a boolean', async () => {
      expect((await ignore(999, { ignore: true })).statusCode).toBe(404);
      expect((await ignore(1, { ignore: 'yes' })).statusCode).toBe(400);
    });
  });

  describe('POST /api/strings/set-status', () => {
    const setStatus = (body: object) =>
      app().inject({ method: 'POST', url: '/api/strings/set-status', payload: body });

    it('changes the status and reports how many rows it touched', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес', status: 'draft' });

      const res = await setStatus({ stringIds: [stringId], status: 'reviewed', targetLang: 'uk' });

      expect(res.json()).toEqual({ ok: true, updated: 1 });
      expect((await translationOf(db(), stringId))?.status).toBe('reviewed');
    });

    it.each([
      ['no ids', { status: 'reviewed' }],
      ['an empty id list', { stringIds: [], status: 'reviewed' }],
      ['a bad id', { stringIds: [1, -2], status: 'reviewed' }],
      ['an unknown status', { stringIds: [1], status: 'banana' }],
      ['skip, which has its own route', { stringIds: [1], status: 'skip' }],
      ['deleted, which is not a status to set', { stringIds: [1], status: 'deleted' }],
    ])('rejects %s with 400', async (_case, body) => {
      expect((await setStatus(body)).statusCode).toBe(400);
    });
  });

  describe('POST /api/strings/mark-skip', () => {
    it('marks lines as not for translation, dropping their translations, and unmarks them', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес' });

      const marked = await app().inject({
        method: 'POST',
        url: '/api/strings/mark-skip',
        payload: { stringIds: [stringId] },
      });
      expect(marked.json()).toEqual({ ok: true, marked: 1 });
      expect(await isIgnored(stringId)).toBe(true);
      expect(await translationOf(db(), stringId)).toBeNull();

      await app().inject({
        method: 'POST',
        url: '/api/strings/mark-skip',
        payload: { stringIds: [stringId], skip: false },
      });
      expect(await isIgnored(stringId)).toBe(false);
    });
  });

  describe('POST /api/strings/clear-translations', () => {
    it('clears the listed strings in one language', async () => {
      const a = await oneString('A', 'Mod A');
      const b = await oneString('B', 'Mod B');
      await insertTranslation(db(), { stringId: a, text: 'А' });
      await insertTranslation(db(), { stringId: b, text: 'Б' });

      const res = await app().inject({
        method: 'POST',
        url: '/api/strings/clear-translations',
        payload: { stringIds: [a], targetLang: 'uk' },
      });

      expect(res.statusCode).toBe(200);
      expect(await translationOf(db(), a)).toBeNull();
      expect(await translationOf(db(), b)).not.toBeNull();
    });

    it('rejects a request with neither ids nor a mod filter', async () => {
      const res = await app().inject({
        method: 'POST',
        url: '/api/strings/clear-translations',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/strings/tm-apply', () => {
    it('fills the listed strings from the translation memory', async () => {
      const donorMod = await insertMod(db(), { name: 'Donor' });
      const donor = await insertString(db(), { modId: donorMod, text: 'Sturges', formid: 'AA' });
      await insertTranslation(db(), { stringId: donor, text: 'Стерджес' });
      const target = await oneString('Sturges', 'Target');

      const res = await app().inject({
        method: 'POST',
        url: '/api/strings/tm-apply',
        payload: { stringIds: [target], srcLang: 'en', targetLang: 'uk' },
      });

      expect(res.json()).toMatchObject({ ok: true, applied: 1 });
      expect((await translationOf(db(), target))?.text).toBe('Стерджес');
    });

    it('refuses more than 100 strings at once', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await app().inject({
        method: 'POST',
        url: '/api/strings/tm-apply',
        payload: { stringIds: ids },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
