import { describe, expect, it, jest } from '@jest/globals';

// The RAG index needs an embedding server; nothing here is about it.
jest.unstable_mockModule('../../../services/ragHooks', () => ({ scheduleRagSync: () => {} }));

const { carryOverTranslations, diffMods } = await import('../importDiff');
const { insertMod, insertSiblingString, insertString, insertTranslation, translationOf, useTestDb } =
  await import('../../../../testing/testDb');

describe('carryOverTranslations', () => {
  const db = useTestDb();

  /**
   * One INFO record with two NAM1 responses in each version, the second
   * version listing them the other way round — the 2026-11-07 Fallout4
   * re-import, where every sibling received the last old sibling's translation.
   */
  const infoWithSwappedResponses = async () => {
    const oldMod = await insertMod(db(), { name: 'Fallout4', versionHash: 'v1' });
    const oldYes = await insertString(db(), {
      modId: oldMod,
      text: 'Yes, please.',
      formid: '0001A2B3',
      signature: 'INFO',
      path: 'INFO\\NAM1',
    });
    const oldNo = await insertSiblingString(db(), oldYes, 'No, thanks.');
    await insertTranslation(db(), { stringId: oldYes, text: 'Так, будь ласка.' });
    await insertTranslation(db(), { stringId: oldNo, text: 'Ні, дякую.' });

    const newMod = await insertMod(db(), { name: 'Fallout4', versionHash: 'v2' });
    const newNo = await insertString(db(), {
      modId: newMod,
      text: 'No, thanks.',
      formid: '0001A2B3',
      signature: 'INFO',
      path: 'INFO\\NAM1',
    });
    const newYes = await insertSiblingString(db(), newNo, 'Yes, please.');
    return { oldMod, newMod, newNo, newYes };
  };

  it('gives each INFO response its own translation when the order changed', async () => {
    const { oldMod, newMod, newNo, newYes } = await infoWithSwappedResponses();

    const result = await carryOverTranslations(db(), newMod, oldMod, 'uk', 'en');

    expect(result).toEqual({ carried: 2, needsReview: 0, skipped: 0 });
    expect(await translationOf(db(), newNo)).toMatchObject({ text: 'Ні, дякую.', status: 'reviewed' });
    expect(await translationOf(db(), newYes)).toMatchObject({
      text: 'Так, будь ласка.',
      status: 'reviewed',
    });
  });

  it('carries a changed sibling as draft only when it is the one left in its record', async () => {
    const oldMod = await insertMod(db(), { name: 'Mod', versionHash: 'v1' });
    const oldA = await insertString(db(), {
      modId: oldMod,
      text: 'Torso',
      formid: '0002',
      signature: 'BPTD',
      path: 'BPTD\\BPTN',
    });
    const oldB = await insertSiblingString(db(), oldA, 'Left Foot');
    await insertTranslation(db(), { stringId: oldA, text: 'Тулуб' });
    await insertTranslation(db(), { stringId: oldB, text: 'Ліва стопа' });

    const newMod = await insertMod(db(), { name: 'Mod', versionHash: 'v2' });
    const newA = await insertString(db(), {
      modId: newMod,
      text: 'Torso',
      formid: '0002',
      signature: 'BPTD',
      path: 'BPTD\\BPTN',
    });
    const newB = await insertSiblingString(db(), newA, 'Left Leg');

    const result = await carryOverTranslations(db(), newMod, oldMod, 'uk', 'en');

    expect(result).toEqual({ carried: 1, needsReview: 1, skipped: 0 });
    expect(await translationOf(db(), newA)).toMatchObject({ text: 'Тулуб', status: 'reviewed' });
    expect(await translationOf(db(), newB)).toMatchObject({ text: 'Ліва стопа', status: 'draft' });
  });

  it('leaves several rewritten siblings and added siblings untranslated', async () => {
    const oldMod = await insertMod(db(), { name: 'Mod', versionHash: 'v1' });
    const oldA = await insertString(db(), {
      modId: oldMod,
      text: 'Torso',
      formid: '0002',
      signature: 'BPTD',
      path: 'BPTD\\BPTN',
    });
    await insertTranslation(db(), { stringId: oldA, text: 'Тулуб' });

    const newMod = await insertMod(db(), { name: 'Mod', versionHash: 'v2' });
    const newA = await insertString(db(), {
      modId: newMod,
      text: 'Body',
      formid: '0002',
      signature: 'BPTD',
      path: 'BPTD\\BPTN',
    });
    const newB = await insertSiblingString(db(), newA, 'Left Foot');

    const result = await carryOverTranslations(db(), newMod, oldMod, 'uk', 'en');

    expect(result).toEqual({ carried: 0, needsReview: 0, skipped: 0 });
    expect(await translationOf(db(), newA)).toBeNull();
    expect(await translationOf(db(), newB)).toBeNull();
  });

  it('diffs siblings by text, not by their position in the record', async () => {
    const { oldMod, newMod } = await infoWithSwappedResponses();

    const diff = await diffMods(db(), newMod, oldMod, 'uk', 'en');

    expect(diff).toMatchObject({ added: [], removed: [], changed: [], unchanged: 2 });
  });
});
