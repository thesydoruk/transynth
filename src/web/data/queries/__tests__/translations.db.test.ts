import { describe, expect, it, jest } from '@jest/globals';

// The RAG index needs an embedding server; nothing here is about it.
jest.unstable_mockModule('../../../services/ragHooks', () => ({ scheduleRagSync: () => {} }));

const { upsertTranslation } = await import('../translationsUpsert');
const { approveVerifiedTranslations, setTranslationsStatus } =
  await import('../translationsStatus');
const { setProjectSetting } = await import('../../../services/projectSettings');
const { insertMod, insertString, insertTranslation, translationOf, useTestDb, waitFor } =
  await import('../../../../testing/testDb');

describe('translation writes', () => {
  const db = useTestDb();

  const oneString = async (text = 'Sturges') => {
    const modId = await insertMod(db());
    return insertString(db(), { modId, text, formid: '0001F00A' });
  };

  const revisions = async (stringId: number) =>
    (
      await db().query(
        `SELECT text, status, note FROM translation_revisions
          WHERE src_string_id = $1 ORDER BY id`,
        [stringId],
      )
    ).rows;

  const referenceCount = async () =>
    (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM reference_translations`))
      .rows[0]!.n;

  // Fire-and-forget hooks get this long to show they did nothing.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  describe('upsertTranslation', () => {
    it('replaces the translation instead of adding a second one, and keeps the history', async () => {
      const stringId = await oneString();

      await upsertTranslation(db(), stringId, 'Стьорджес', 'draft', 'uk');
      await upsertTranslation(db(), stringId, 'Стерджес', 'reviewed', 'uk');

      expect(await translationOf(db(), stringId)).toEqual({
        text: 'Стерджес',
        status: 'reviewed',
        provenance: 'human_edit',
      });
      expect(await revisions(stringId)).toEqual([
        { text: 'Стьорджес', status: 'draft', note: 'save' },
        { text: 'Стерджес', status: 'reviewed', note: 'save' },
      ]);
    });

    it('turns guillemets into straight quotes, which the game fonts can draw', async () => {
      const stringId = await oneString('"Hello"');

      const saved = await upsertTranslation(db(), stringId, '«Привіт»', 'draft', 'uk');

      expect(saved.text).toBe('"Привіт"');
      expect((await translationOf(db(), stringId))?.text).toBe('"Привіт"');
    });

    it('marks the string as not for translation when saved as skip', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес' });

      await upsertTranslation(db(), stringId, '', 'skip', 'uk');

      expect(await translationOf(db(), stringId)).toBeNull();
      const { rows } = await db().query(`SELECT is_ignored FROM strings WHERE id = $1`, [stringId]);
      expect(rows).toEqual([{ is_ignored: true }]);
    });

    it('promotes a reviewed save into the reference base when the setting is on', async () => {
      const stringId = await oneString();
      await setProjectSetting(db(), 'workflow.promote_reference_on_approve', true);

      await upsertTranslation(db(), stringId, 'Стерджес', 'reviewed', 'uk');

      const row = await waitFor(async () => {
        const { rows } = await db().query(
          `SELECT translation, origin FROM reference_translations`,
        );
        return rows[0];
      });
      expect(row).toEqual({ translation: 'Стерджес', origin: 'auto_approve' });
    });

    it('promotes nothing when the setting is off, or the save is only a draft', async () => {
      const first = await oneString('Sturges');
      await upsertTranslation(db(), first, 'Стерджес', 'reviewed', 'uk');

      await setProjectSetting(db(), 'workflow.promote_reference_on_approve', true);
      const second = await oneString('Preston');
      await upsertTranslation(db(), second, 'Престон', 'draft', 'uk');

      await settle();
      expect(await referenceCount()).toBe(0);
    });
  });

  describe('setTranslationsStatus', () => {
    it('changes the status of translated strings and skips the ignored ones', async () => {
      const modId = await insertMod(db());
      const live = await insertString(db(), { modId, text: 'A', formid: '01' });
      const ignored = await insertString(db(), { modId, text: 'B', formid: '02' });
      await insertTranslation(db(), { stringId: live, text: 'А', status: 'draft' });
      await insertTranslation(db(), { stringId: ignored, text: 'Б', status: 'draft' });
      await db().query(`UPDATE strings SET is_ignored = TRUE WHERE id = $1`, [ignored]);

      const changed = await setTranslationsStatus(db(), [live, ignored], 'reviewed', 'uk');

      expect(changed).toBe(1);
      expect(await translationOf(db(), live)).toMatchObject({
        status: 'reviewed',
        provenance: 'human_edit',
      });
      expect(await translationOf(db(), ignored)).toMatchObject({ status: 'draft' });
    });

    it('touches only the language it was asked for', async () => {
      const stringId = await oneString();
      await insertTranslation(db(), { stringId, text: 'Стерджес', status: 'draft' });
      await insertTranslation(db(), { stringId, text: 'Sturges', status: 'draft', targetLang: 'de' });

      await setTranslationsStatus(db(), [stringId], 'rejected', 'uk');

      expect((await translationOf(db(), stringId, 'uk'))?.status).toBe('rejected');
      expect((await translationOf(db(), stringId, 'de'))?.status).toBe('draft');
    });
  });

  describe('approveVerifiedTranslations', () => {
    it('approves machine and draft translations, never a rejected or human one', async () => {
      const modId = await insertMod(db());
      const ids: Record<string, number> = {};
      for (const [i, status] of ['draft', 'tm', 'fuzzy', 'auto', 'rejected', 'human'].entries()) {
        ids[status] = await insertString(db(), { modId, text: `S${i}`, formid: `0${i}` });
        await insertTranslation(db(), { stringId: ids[status]!, text: `T${i}`, status });
      }

      const approved = await approveVerifiedTranslations(db(), Object.values(ids), 'uk');

      expect(approved).toBe(4);
      const statuses = Object.fromEntries(
        await Promise.all(
          Object.entries(ids).map(async ([was, id]) => [was, (await translationOf(db(), id))?.status]),
        ),
      );
      expect(statuses).toEqual({
        draft: 'reviewed',
        tm: 'reviewed',
        fuzzy: 'reviewed',
        auto: 'reviewed',
        rejected: 'rejected',
        human: 'human',
      });
    });
  });
});
