import { describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import { serializePexStoredContext } from '../../../formats/pex';
import { insertMod, insertString, insertTranslation, useTestDb } from '../../../testing/testDb';
import { getPexTranslationOverlays } from '../exportPex';
import { getTranslationOverlaysByType } from '../translationOverlay';

/**
 * A string marked skip (`is_ignored`) exports its source text even when a
 * stale translation row still hangs on it — TM and carry-over can leave one.
 */
describe('export of skipped strings', () => {
  const db = useTestDb();

  const line = async (
    modId: number,
    text: string,
    translation: string,
    at: { signature: string; path: string; formid?: string },
    opts: { skipped?: boolean; lstringId?: number; context?: string } = {},
  ) => {
    const stringId = await insertString(db(), { modId, text, ...at });
    await insertTranslation(db(), { stringId, text: translation, status: 'reviewed' });
    await db().query(
      `UPDATE strings SET is_ignored = $2, lstring_id = $3, context = $4 WHERE id = $1`,
      [stringId, opts.skipped ?? false, opts.lstringId ?? null, opts.context ?? null],
    );
    return stringId;
  };

  it('keeps the source for skipped localized strings', async () => {
    const modId = await insertMod(db(), { name: 'Skip Overlay', game: 'fo4' });
    const at = { signature: 'NPC_', path: 'NPC_\\FULL' };
    await line(modId, 'Raider', 'Рейдер', { ...at, formid: '00000A01' }, { lstringId: 1 });
    await line(
      modId,
      'LeftFoot',
      'Тулуб',
      { ...at, formid: '00000A02' },
      {
        skipped: true,
        lstringId: 2,
      },
    );

    const overlays = await getTranslationOverlaysByType(db() as unknown as Tx, modId, 'en', 'uk');
    const texts = new Map([...overlays.values()].flatMap((table) => [...table]));
    expect(texts.get(1)).toBe('Рейдер');
    expect(texts.get(2)).toBe('LeftFoot');
  });

  it('keeps the source for a skipped PEX literal shown in a message box', async () => {
    const modId = await insertMod(db(), { name: 'Skip Pex', game: 'fo4' });
    const context = (literal: string) =>
      serializePexStoredContext({
        scriptLabel: 'Q.psc',
        headerSourceFile: 'Q.psc',
        matchLineNumbers: [3],
        contextLines: [
          { lineNumber: 3, text: `  Debug.MessageBox("${literal}")`, highlight: true },
        ],
      });
    const at = { signature: 'PEX', path: 'PEX\\Q' };
    await line(modId, 'Saved', 'Збережено', { ...at, formid: '1' }, { context: context('Saved') });
    await line(
      modId,
      'Debug on',
      'Налагодження',
      { ...at, formid: '2' },
      {
        skipped: true,
        context: context('Debug on'),
      },
    );

    const overlays = await getPexTranslationOverlays(db() as unknown as Tx, modId, 'en', 'uk');
    expect(overlays.get('q')?.get('Saved')).toBe('Збережено');
    expect(overlays.get('q')?.get('Debug on')).toBe('Debug on');
  });
});
