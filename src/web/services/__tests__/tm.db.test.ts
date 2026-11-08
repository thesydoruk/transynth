import { describe, expect, it } from '@jest/globals';
import type pg from 'pg';
import { applyTMToMod } from '../tm';
import { normalizeForHash } from '../../../utils/textNorm';
import {
  insertMod,
  insertSiblingString,
  insertString,
  insertTranslation,
  translationOf,
  useTestDb,
} from '../../../testing/testDb';

type ReferenceFixture = {
  game?: string;
  formid?: string;
  path?: string;
  edid?: string;
  source: string;
  translation: string;
  origin?: string;
};

const insertReference = async (db: pg.Pool, ref: ReferenceFixture): Promise<void> => {
  await db.query(
    `INSERT INTO reference_translations(
       game, src_lang, tgt_lang, formid_hex, path, edid, source_text, text_norm, translation, origin
     ) VALUES ($1, 'en', 'uk', $2, $3, $4, $5, $6, $7, $8)`,
    [
      ref.game ?? 'fo4',
      ref.formid ?? '',
      ref.path ?? '',
      ref.edid ?? '',
      ref.source,
      normalizeForHash(ref.source),
      ref.translation,
      ref.origin ?? 'promote',
    ],
  );
};

describe('applyTMToMod', () => {
  const db = useTestDb();

  /** A donor mod with one translated string, and a target mod sharing its anchor. */
  const donorAndTarget = async (opts: { donorText?: string; donorStatus?: string } = {}) => {
    const donorMod = await insertMod(db(), { name: 'Donor' });
    const donor = await insertString(db(), {
      modId: donorMod,
      text: 'Sturges',
      formid: '0001F00A',
      edid: 'SturgesREF',
    });
    await insertTranslation(db(), {
      stringId: donor,
      text: opts.donorText ?? 'Стерджес',
      status: opts.donorStatus ?? 'reviewed',
    });
    const targetMod = await insertMod(db(), { name: 'Target' });
    const target = await insertString(db(), {
      modId: targetMod,
      text: 'Sturges',
      formid: '0001F00A',
      edid: 'SturgesREF',
    });
    return { targetMod, target };
  };

  it('copies a live translation on the same FormID and path, as tm', async () => {
    const { targetMod, target } = await donorAndTarget();

    const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

    expect(result).toMatchObject({ applied: 1, approved: 0, byMethod: { anchor: 1 } });
    expect(await translationOf(db(), target)).toEqual({
      text: 'Стерджес',
      status: 'tm',
      provenance: 'tm_auto_anchor',
    });
  });

  it('prefers the reference base over a live mod on the same anchor, approved at once', async () => {
    const { targetMod, target } = await donorAndTarget({ donorText: 'Стьорджес' });
    await insertReference(db(), {
      formid: '0001F00A',
      path: 'NPC_\\FULL',
      source: 'Sturges',
      translation: 'Стерджес',
    });

    const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

    expect(result).toMatchObject({ applied: 1, approved: 1 });
    expect(await translationOf(db(), target)).toEqual({
      text: 'Стерджес',
      status: 'reviewed',
      provenance: 'tm_reference_anchor',
    });
  });

  it('lets a live mod with the identical source beat a reference row matched only by normalised text', async () => {
    const donorMod = await insertMod(db(), { name: 'Donor' });
    const donor = await insertString(db(), { modId: donorMod, text: 'Take 5 caps.', formid: 'A1' });
    await insertTranslation(db(), { stringId: donor, text: 'Візьми 5 кришечок.' });
    await insertReference(db(), { source: 'Take 10 caps.', translation: 'Візьми 10 кришок.' });
    const targetMod = await insertMod(db(), { name: 'Target' });
    const target = await insertString(db(), {
      modId: targetMod,
      text: 'Take 5 caps.',
      formid: 'B2',
    });

    await applyTMToMod(db(), targetMod, 'uk', 'en');

    expect(await translationOf(db(), target)).toEqual({
      text: 'Візьми 5 кришечок.',
      status: 'tm',
      provenance: 'tm_auto_text_norm',
    });
  });

  it('transplants numbers from a reference row but leaves the result for review', async () => {
    await insertReference(db(), { source: 'Take 10 caps.', translation: 'Візьми 10 кришок.' });
    const targetMod = await insertMod(db());
    const target = await insertString(db(), { modId: targetMod, text: 'Take 5 caps.' });

    const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

    expect(result).toMatchObject({ applied: 1, approved: 0, byMethod: { numeric: 1 } });
    expect(await translationOf(db(), target)).toEqual({
      text: 'Візьми 5 кришок.',
      status: 'tm',
      provenance: 'tm_reference_numeric',
    });
  });

  it('shares one reference base between Skyrim LE and SE', async () => {
    await insertReference(db(), { game: 'sse', source: 'Whiterun', translation: 'Вайтран' });
    const legendary = await insertMod(db(), { game: 'sle' });
    const target = await insertString(db(), { modId: legendary, text: 'Whiterun' });

    await applyTMToMod(db(), legendary, 'uk', 'en');

    expect((await translationOf(db(), target))?.text).toBe('Вайтран');
  });

  it('does not read another game’s reference base', async () => {
    await insertReference(db(), { game: 'sse', source: 'Sturges', translation: 'Стерджес' });
    const fallout = await insertMod(db(), { game: 'fo4' });
    const target = await insertString(db(), { modId: fallout, text: 'Sturges' });

    const result = await applyTMToMod(db(), fallout, 'uk', 'en');

    expect(result.applied).toBe(0);
    expect(await translationOf(db(), target)).toBeNull();
  });

  it('leaves translated, skipped and other-language strings alone', async () => {
    await insertReference(db(), { source: 'Sturges', translation: 'Стерджес' });
    const modId = await insertMod(db());
    const translated = await insertString(db(), { modId, text: 'Sturges', formid: '01' });
    await insertTranslation(db(), { stringId: translated, text: 'Вже є', status: 'draft' });
    const skipped = await insertString(db(), { modId, text: 'Sturges', formid: '02' });
    await db().query(`UPDATE strings SET is_ignored = TRUE WHERE id = $1`, [skipped]);
    const german = await insertString(db(), { modId, text: 'Sturges', formid: '03', lang: 'de' });

    const result = await applyTMToMod(db(), modId, 'uk', 'en');

    expect(result.applied).toBe(0);
    expect(await translationOf(db(), translated)).toMatchObject({ text: 'Вже є', status: 'draft' });
    expect(await translationOf(db(), skipped)).toBeNull();
    expect(await translationOf(db(), german)).toBeNull();
  });

  describe('a record repeating one subrecord (BPTD BPTN, INFO NAM1)', () => {
    /** The reference knows two body parts on the anchor, neither is the target's. */
    const bodyPartSiblings = async (targetText: string) => {
      for (const [source, translation] of [
        ['Torso', 'Тулуб'],
        ['Head', 'Голова'],
      ]) {
        await insertReference(db(), {
          formid: '0003BPTD',
          path: 'BPTD\\BPTN',
          source: source!,
          translation: translation!,
        });
      }
      const targetMod = await insertMod(db(), { name: 'DLC' });
      const target = await insertString(db(), {
        modId: targetMod,
        text: targetText,
        formid: '0003BPTD',
        signature: 'BPTD',
        path: 'BPTD\\BPTN',
      });
      return { targetMod, target };
    };

    it('lets an exact text match from elsewhere beat a sibling on the anchor', async () => {
      await insertReference(db(), { source: 'LeftFoot', translation: 'Ліва стопа' });
      const { targetMod, target } = await bodyPartSiblings('LeftFoot');

      const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

      expect(result).toMatchObject({ applied: 1, approved: 1, byMethod: { text_norm: 1 } });
      expect(await translationOf(db(), target)).toEqual({
        text: 'Ліва стопа',
        status: 'reviewed',
        provenance: 'tm_reference_text_norm',
      });
    });

    it('copies nothing from an anchor with several sibling texts when none is exact', async () => {
      const { targetMod, target } = await bodyPartSiblings('RightFoot');

      const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

      expect(result.applied).toBe(0);
      expect(await translationOf(db(), target)).toBeNull();
    });

    it('skips a live donor record with several sibling texts the same way', async () => {
      const donorMod = await insertMod(db(), { name: 'Donor' });
      const torso = await insertString(db(), {
        modId: donorMod,
        text: 'Torso',
        formid: '0003BPTD',
        signature: 'BPTD',
        path: 'BPTD\\BPTN',
      });
      const head = await insertSiblingString(db(), torso, 'Head');
      await insertTranslation(db(), { stringId: torso, text: 'Тулуб' });
      await insertTranslation(db(), { stringId: head, text: 'Голова' });
      const targetMod = await insertMod(db(), { name: 'DLC' });
      const target = await insertString(db(), {
        modId: targetMod,
        text: 'LeftFoot',
        formid: '0003BPTD',
        signature: 'BPTD',
        path: 'BPTD\\BPTN',
      });

      await applyTMToMod(db(), targetMod, 'uk', 'en');

      expect(await translationOf(db(), target)).toBeNull();
    });
  });

  it('still falls back to a lone anchor row whose wording changed, as tm', async () => {
    await insertReference(db(), {
      formid: '0001F00A',
      path: 'NPC_\\FULL',
      source: 'Sturges',
      translation: 'Стерджес',
    });
    const targetMod = await insertMod(db());
    const target = await insertString(db(), {
      modId: targetMod,
      text: 'Sturges the Mechanic',
      formid: '0001F00A',
    });

    const result = await applyTMToMod(db(), targetMod, 'uk', 'en');

    expect(result).toMatchObject({ applied: 1, approved: 0, byMethod: { anchor: 1 } });
    expect(await translationOf(db(), target)).toMatchObject({
      status: 'tm',
      provenance: 'tm_reference_anchor',
    });
  });

  it('records a revision for every string it fills', async () => {
    const { targetMod, target } = await donorAndTarget();

    await applyTMToMod(db(), targetMod, 'uk', 'en');

    const { rows } = await db().query(
      `SELECT text, status, provenance FROM translation_revisions WHERE src_string_id = $1`,
      [target],
    );
    expect(rows).toEqual([{ text: 'Стерджес', status: 'tm', provenance: 'tm_auto_anchor' }]);
  });
});
