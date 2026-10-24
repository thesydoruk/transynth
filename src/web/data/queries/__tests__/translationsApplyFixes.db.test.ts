import { describe, expect, it } from '@jest/globals';
import { applyTranslationFixes, type ApplyFixesOptions } from '../translationsApplyFixes';
import { insertMod, insertString, insertTranslation, translationOf, useTestDb } from '../../../../testing/testDb';

describe('applyTranslationFixes', () => {
  const db = useTestDb();

  const opts: ApplyFixesOptions = {
    targetLang: 'uk',
    status: 'reviewed',
    provenance: 'agent_review',
    model: 'claude-opus-5-5',
  };

  const line = async (source: string, translation?: string) => {
    const modId = await insertMod(db());
    const stringId = await insertString(db(), { modId, text: source, signature: 'INFO', path: 'INFO\\NAM1' });
    if (translation !== undefined) {
      await insertTranslation(db(), { stringId, text: translation, status: 'auto', provenance: 'auto_generated' });
    }
    return stringId;
  };

  const revisions = async (stringId: number) =>
    (
      await db().query(
        `SELECT text, status, provenance, model, note FROM translation_revisions
          WHERE src_string_id = $1 ORDER BY id`,
        [stringId],
      )
    ).rows;

  it('writes a line whose stored text is still the one the reviewer read, and keeps the history', async () => {
    const id = await line('Are you ready?', 'Ти готовий?');

    const result = await applyTranslationFixes(
      db(),
      [{ id, old: 'Ти готовий?', new: 'Ну що, рушаємо?', note: 'gender' }],
      opts,
    );

    expect(result).toEqual({ applied: [id], unchanged: [], stale: [], rejected: [] });
    expect(await translationOf(db(), id)).toEqual({
      text: 'Ну що, рушаємо?',
      status: 'reviewed',
      provenance: 'agent_review',
    });
    expect(await revisions(id)).toEqual([
      { text: 'Ну що, рушаємо?', status: 'reviewed', provenance: 'agent_review', model: 'claude-opus-5-5', note: 'gender' },
    ]);
  });

  it('leaves a line alone when it changed after it was read', async () => {
    const id = await line('Are you ready?', 'Готові?');

    const result = await applyTranslationFixes(db(), [{ id, old: 'Ти готовий?', new: 'Ну що, рушаємо?' }], opts);

    expect(result.stale).toEqual([{ id, current: 'Готові?' }]);
    expect(result.applied).toEqual([]);
    expect((await translationOf(db(), id))?.text).toBe('Готові?');
  });

  it('adds a translation to an untranslated line when old is empty', async () => {
    const id = await line('Sturges');

    const result = await applyTranslationFixes(db(), [{ id, old: '', new: 'Стерджес' }], opts);

    expect(result.applied).toEqual([id]);
    expect((await translationOf(db(), id))?.text).toBe('Стерджес');
  });

  it('folds guillemets like every editor save, and skips edits that end up identical', async () => {
    const quoted = await line('Read "Grognak".', 'Прочитай Грогнака.');
    const same = await line('Hello "there"', 'Привіт "там"');

    const result = await applyTranslationFixes(
      db(),
      [
        { id: quoted, old: 'Прочитай Грогнака.', new: 'Прочитай «Грогнака».' },
        { id: same, old: 'Привіт "там"', new: 'Привіт «там»' },
      ],
      opts,
    );

    expect(result.applied).toEqual([quoted]);
    expect(result.unchanged).toEqual([same]);
    expect((await translationOf(db(), quoted))?.text).toBe('Прочитай "Грогнака".');
  });

  it('rejects unknown and skipped strings, empty text and repeated ids', async () => {
    const skipped = await line('EDITOR_ID', 'EDITOR_ID');
    await db().query(`UPDATE strings SET is_ignored = TRUE WHERE id = $1`, [skipped]);
    const blank = await line('Hello', 'Привіт');

    const result = await applyTranslationFixes(
      db(),
      [
        { id: 999_999, old: '', new: 'х' },
        { id: skipped, old: 'EDITOR_ID', new: 'Х' },
        { id: blank, old: 'Привіт', new: '  ' },
        { id: blank, old: 'Привіт', new: 'Вітаю' },
      ],
      opts,
    );

    expect(result.rejected).toEqual([
      { id: blank, why: 'duplicate id in input' },
      { id: 999_999, why: 'no such string' },
      { id: skipped, why: 'string is marked skip' },
      { id: blank, why: 'empty translation' },
    ]);
    expect((await translationOf(db(), blank))?.text).toBe('Привіт');
  });

  it('writes nothing in a dry run but says what it would write', async () => {
    const id = await line('Are you ready?', 'Ти готовий?');

    const result = await applyTranslationFixes(
      db(),
      [{ id, old: 'Ти готовий?', new: 'Ну що, рушаємо?' }],
      { ...opts, dryRun: true },
    );

    expect(result.applied).toEqual([id]);
    expect((await translationOf(db(), id))?.text).toBe('Ти готовий?');
    expect(await revisions(id)).toEqual([]);
  });
});
