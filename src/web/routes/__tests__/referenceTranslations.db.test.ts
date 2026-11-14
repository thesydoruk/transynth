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
        origin_key: '',
        game: 'fo4',
      });
    });

    it('replaces the translation when the same source is added again', async () => {
      await add({ ...pair, sourceText: 'Vault', translation: 'Волт' });
      await add({ ...pair, sourceText: 'Vault', translation: 'Сховище' });

      const { rows } = await db().query(`SELECT translation FROM reference_translations`);
      expect(rows).toEqual([{ translation: 'Сховище' }]);
    });

    it('accepts a book-length source: the anchor key hashes the text', async () => {
      // A terminal entry past the ~2.7 KB btree row limit used to fail the insert
      // (and the whole mod promotion it was part of).
      const sourceText = 'The Institute report. '.repeat(400);
      const first = await add({ ...pair, sourceText, translation: 'Звіт Інституту.' });
      const again = await add({ ...pair, sourceText, translation: 'Звіт Інституту!' });

      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(201);
      const { rows } = await db().query(`SELECT translation FROM reference_translations`);
      expect(rows).toEqual([{ translation: 'Звіт Інституту!' }]);
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

    it('keeps the origin layer of the row it edits', async () => {
      const { id } = (await add({ ...pair, sourceText: 'Vault', translation: 'Волт' })).json();
      await db().query(
        `UPDATE reference_translations SET origin = 'promote', origin_key = 'fallout4.esm'
          WHERE id = $1`,
        [id],
      );

      const res = await app().inject({
        method: 'PUT',
        url: `/api/reference/${id}`,
        payload: { translation: 'Сховище' },
      });

      expect(res.json()).toMatchObject({ origin: 'manual', origin_key: 'fallout4.esm' });
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

    describe('origin layers', () => {
      const BASE = { name: 'Fallout4', absPath: '/mods/base/Fallout4.esm' };
      const PATCH = { name: 'UFO4P', absPath: '/mods/ufo4p/Unofficial Fallout 4 Patch.esp' };
      const PATCH_KEY = 'unofficial fallout 4 patch.esp';

      /** A mod holding the line the base game and the patch share. */
      const modWithLine = async (
        mod: { name: string; absPath: string; versionHash?: string },
        translation: string,
      ) => {
        const modId = await insertMod(db(), mod);
        const stringId = await insertString(db(), { modId, text: 'Sturges', formid: '0001F00A' });
        await insertTranslation(db(), { stringId, text: translation });
        return { modId, stringId };
      };

      /** The patch mod with a line of its own, nothing shared. */
      const patchWithOwnLine = async () => {
        const modId = await insertMod(db(), PATCH);
        const stringId = await insertString(db(), { modId, text: 'Preston', formid: '02' });
        await insertTranslation(db(), { stringId, text: 'Престон' });
        return { modId, stringId };
      };

      const layers = async () =>
        (
          await db().query(
            `SELECT origin_key, origin, translation FROM reference_translations
              ORDER BY origin_key, id`,
          )
        ).rows;

      /** A row as a promotion wrote it before layers existed. */
      const insertLegacy = (modName: string, translation: string, origin = 'promote') =>
        db().query(
          `INSERT INTO reference_translations(
             game, src_lang, tgt_lang, formid_hex, path, source_text, text_norm, translation,
             origin, origin_mod_name
           ) VALUES ('fo4', 'en', 'uk', '0001F00A', $4, 'Sturges', 'sturges', $2, $3, $1)`,
          [modName, translation, origin, 'NPC_\\FULL'],
        );

      it('keeps one row per plugin when two mods share an anchor and its text', async () => {
        const base = await modWithLine(BASE, 'Стерджес');
        const patch = await modWithLine(PATCH, 'Стьорджес');

        await promote({ modIds: [base.modId], targetLang: 'uk' });
        await promote({ modIds: [patch.modId], targetLang: 'uk' });
        // In one call too, and by string: neither replaces the other.
        const res = await promote({ modIds: [base.modId, patch.modId], targetLang: 'uk' });
        await promote({ stringIds: [patch.stringId], targetLang: 'uk' });

        expect(res.json()).toEqual({ ok: true, promoted: 2 });
        expect(await layers()).toEqual([
          { origin_key: 'fallout4.esm', origin: 'promote', translation: 'Стерджес' },
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Стьорджес' },
        ]);
      });

      it('writes two imports of one plugin into one layer', async () => {
        const first = await modWithLine(BASE, 'Стерджес');
        const second = await modWithLine(
          { name: 'fallout4', absPath: '/staging/game/fallout4.esm', versionHash: 'v2' },
          'Стерджес',
        );

        const res = await promote({ modIds: [first.modId, second.modId], targetLang: 'uk' });

        expect(res.json()).toEqual({ ok: true, promoted: 1 });
        expect(await layers()).toMatchObject([{ origin_key: 'fallout4.esm' }]);
      });

      it('returns the layer with the row', async () => {
        const base = await modWithLine(BASE, 'Стерджес');
        await promote({ modIds: [base.modId], targetLang: 'uk' });

        const res = await app().inject({ url: '/api/reference?game=fo4&srcLang=en&tgtLang=uk' });

        expect(res.json().rows).toMatchObject([{ origin_key: 'fallout4.esm' }]);
      });

      it('moves a row promoted before layers existed into the layer of its mod', async () => {
        // The patch overwrote the base game's row; both are promoted again.
        await insertLegacy('UFO4P', 'Стьорджес (старе)');
        const base = await modWithLine(BASE, 'Стерджес');
        const patch = await modWithLine(PATCH, 'Стьорджес');

        await promote({ modIds: [base.modId], targetLang: 'uk' });
        expect(await layers()).toEqual([
          { origin_key: '', origin: 'promote', translation: 'Стьорджес (старе)' },
          { origin_key: 'fallout4.esm', origin: 'promote', translation: 'Стерджес' },
        ]);

        await promote({ modIds: [patch.modId], targetLang: 'uk' });
        expect(await layers()).toEqual([
          { origin_key: 'fallout4.esm', origin: 'promote', translation: 'Стерджес' },
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Стьорджес' },
        ]);
      });

      it('adopts rows the promotion itself does not rewrite', async () => {
        await insertLegacy('UFO4P', 'Стьорджес (старе)');
        const patch = await patchWithOwnLine();

        await promote({ modIds: [patch.modId], targetLang: 'uk' });

        expect(await layers()).toEqual([
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Стьорджес (старе)' },
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Престон' },
        ]);
      });

      it('leaves legacy rows alone when single strings are promoted', async () => {
        await insertLegacy('UFO4P', 'Стьорджес (старе)');
        const patch = await patchWithOwnLine();

        await promote({ stringIds: [patch.stringId], targetLang: 'uk' });

        expect(await layers()).toEqual([
          { origin_key: '', origin: 'promote', translation: 'Стьорджес (старе)' },
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Престон' },
        ]);
      });

      it('drops the old row when its layer already holds the line', async () => {
        const patch = await modWithLine(PATCH, 'Стьорджес');
        await promote({ modIds: [patch.modId], targetLang: 'uk' });
        await insertLegacy('UFO4P', 'Стьорджес (старе)');

        await promote({ modIds: [patch.modId], targetLang: 'uk' });

        expect(await layers()).toEqual([
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Стьорджес' },
        ]);
      });

      it('leaves hand-edited rows and rows of other mods where they are', async () => {
        await insertLegacy('UFO4P', 'Виправлено вручну', 'manual');
        await db().query(`UPDATE reference_translations SET formid_hex = '0001F00B'`);
        await insertLegacy('Some Other Mod', 'Стерджес (інший)');
        const patch = await patchWithOwnLine();

        await promote({ modIds: [patch.modId], targetLang: 'uk' });

        expect(await layers()).toEqual([
          { origin_key: '', origin: 'manual', translation: 'Виправлено вручну' },
          { origin_key: '', origin: 'promote', translation: 'Стерджес (інший)' },
          { origin_key: PATCH_KEY, origin: 'promote', translation: 'Престон' },
        ]);
      });
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
