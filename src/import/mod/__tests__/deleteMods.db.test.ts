import { describe, expect, it } from '@jest/globals';
import { deleteModsCompletely } from '../deleteMods';
import { applyTMToMod } from '../../../web/services/tm';
import {
  insertMod,
  insertString,
  insertTranslation,
  translationOf,
  useTestDb,
} from '../../../testing/testDb';

describe('deleteModsCompletely', () => {
  const db = useTestDb();

  const count = async (table: string): Promise<number> => {
    const { rows } = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0]!.n;
  };

  const referenceRows = async () =>
    (
      await db().query(
        `SELECT source_text, translation, origin, origin_status, origin_mod_name
           FROM reference_translations ORDER BY source_text`,
      )
    ).rows;

  /** A mod with one string per status, all on their own FormIDs. */
  const modWithStatuses = async (name = 'Sim Settlements 2') => {
    const modId = await insertMod(db(), { name, versionHash: 'abc123' });
    const ids: Record<string, number> = {};
    for (const [i, status] of ['reviewed', 'human', 'draft', 'tm', 'rejected'].entries()) {
      ids[status] = await insertString(db(), {
        modId,
        text: `Line ${status}`,
        formid: `0000000${i}`,
      });
      await insertTranslation(db(), {
        stringId: ids[status]!,
        text: `Рядок ${status}`,
        status,
      });
    }
    return { modId, ids };
  };

  it('removes the mod and everything imported from it', async () => {
    const { modId } = await modWithStatuses();
    const other = await insertMod(db(), { name: 'Unrelated' });
    await insertString(db(), { modId: other, text: 'Keep me' });

    const result = await deleteModsCompletely(db(), [modId], { keepReference: false });

    expect(result).toEqual({ deletedMods: 1, deletedRecords: 5, referencePromoted: 0 });
    expect(await count('mods')).toBe(1);
    expect(await count('records')).toBe(1);
    expect(await count('strings')).toBe(1);
    expect(await count('translations')).toBe(0);
  });

  it('keeps reviewed and human translations in the reference base by default', async () => {
    const { modId } = await modWithStatuses();

    const result = await deleteModsCompletely(db(), [modId]);

    expect(result.referencePromoted).toBe(2);
    expect(await referenceRows()).toEqual([
      {
        source_text: 'Line human',
        translation: 'Рядок human',
        origin: 'delete_snapshot',
        origin_status: 'human',
        origin_mod_name: 'Sim Settlements 2',
      },
      {
        source_text: 'Line reviewed',
        translation: 'Рядок reviewed',
        origin: 'delete_snapshot',
        origin_status: 'reviewed',
        origin_mod_name: 'Sim Settlements 2',
      },
    ]);
  });

  it('keeps nothing when asked not to', async () => {
    const { modId } = await modWithStatuses();

    await deleteModsCompletely(db(), [modId], { keepReference: false });

    expect(await count('reference_translations')).toBe(0);
  });

  it('never overwrites a reference row someone edited by hand', async () => {
    const { modId } = await modWithStatuses();
    await db().query(
      `INSERT INTO reference_translations(
         game, src_lang, tgt_lang, formid_hex, path, source_text, text_norm, translation, origin
       ) VALUES ('fo4', 'en', 'uk', '00000000', 'NPC_\\FULL', 'Line reviewed', 'line reviewed',
                 'Виправлено вручну', 'manual')`,
    );

    await deleteModsCompletely(db(), [modId]);

    const { rows } = await db().query(
      `SELECT translation, origin FROM reference_translations WHERE source_text = 'Line reviewed'`,
    );
    expect(rows).toEqual([{ translation: 'Виправлено вручну', origin: 'manual' }]);
  });

  it('ignores ids that do not exist', async () => {
    expect(await deleteModsCompletely(db(), [999, -1, 0])).toEqual({
      deletedMods: 0,
      deletedRecords: 0,
      referencePromoted: 0,
    });
  });

  // The point of the reference base: a translation outlives the mod it came from.
  it('lets the next version of the mod reuse what the deleted one taught', async () => {
    const { modId } = await modWithStatuses();
    await deleteModsCompletely(db(), [modId]);

    const nextVersion = await insertMod(db(), { name: 'Sim Settlements 2', versionHash: 'def456' });
    const reviewed = await insertString(db(), {
      modId: nextVersion,
      text: 'Line reviewed',
      formid: '00000000',
    });
    const draft = await insertString(db(), {
      modId: nextVersion,
      text: 'Line draft',
      formid: '00000002',
    });
    await applyTMToMod(db(), nextVersion, 'uk', 'en');

    expect(await translationOf(db(), reviewed)).toEqual({
      text: 'Рядок reviewed',
      status: 'reviewed',
      provenance: 'tm_reference_anchor',
    });
    // A draft was never approved, so it was not kept and is not reused.
    expect(await translationOf(db(), draft)).toBeNull();
  });
});
