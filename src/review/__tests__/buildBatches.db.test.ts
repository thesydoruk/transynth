import { describe, expect, it } from '@jest/globals';
import { buildModBatches } from '../buildBatches';
import { insertMod, insertString, insertTranslation, useTestDb } from '../../testing/testDb';

describe('buildModBatches', () => {
  const db = useTestDb();

  const line = async (
    modId: number,
    text: string,
    translation: string,
    at: { signature: string; path: string; formid: string; edid?: string },
    over: { status?: string; provenance?: string } = {},
  ) => {
    const stringId = await insertString(db(), { modId, text, ...at });
    await insertTranslation(db(), {
      stringId,
      text: translation,
      status: over.status ?? 'auto',
      provenance: over.provenance ?? 'auto_generated',
    });
    return stringId;
  };

  const fixture = async () => {
    const modId = await insertMod(db(), { name: 'Test Mod', game: 'fo4' });
    const { rows } = await db().query<{ id: number }>(
      `INSERT INTO dialog_topics(mod_id, formid_hex, edid) VALUES ($1, '0001A000', 'MQ_Hancock') RETURNING id`,
      [modId],
    );
    await db().query(
      `INSERT INTO dialog_nodes(topic_id, info_formid_hex) VALUES ($1, '0001A001')`,
      [rows[0]!.id],
    );
    const ids = {
      prompt: await line(modId, 'Who are you?', 'Хто ти?', {
        signature: 'INFO',
        path: 'INFO\\RNAM',
        formid: '0001A001',
      }),
      reply: await line(modId, "Hancock's the name.", 'Я Генкок.', {
        signature: 'INFO',
        path: 'INFO\\NAM1',
        formid: '0001A001',
      }),
      loose: await line(modId, 'Get lost.', 'Відвали.', {
        signature: 'INFO',
        path: 'INFO\\NAM1',
        formid: '0001B000',
        edid: 'Bark01',
      }),
      book: await line(modId, 'Dear diary…', 'Любий щоденнику…', {
        signature: 'BOOK',
        path: 'BOOK\\DESC',
        formid: '0001C000',
      }),
      armor: await line(modId, 'Combat Armor', 'Бойова броня', {
        signature: 'ARMO',
        path: 'ARMO\\FULL',
        formid: '0001D000',
        edid: 'CombatArmor',
      }),
      canon: await line(
        modId,
        'Leather Armor',
        'Шкіряна броня',
        { signature: 'ARMO', path: 'ARMO\\FULL', formid: '0001D001', edid: 'CombatArmor2' },
        { provenance: 'tm_final_review' },
      ),
      skipped: await line(
        modId,
        'Placeholder',
        'Заглушка',
        { signature: 'MISC', path: 'MISC\\FULL', formid: '0001E000' },
        { status: 'skip' },
      ),
    };
    // The importer fills path_simplified; the dialog queries match on it.
    await db().query(`UPDATE records SET path_simplified = path WHERE mod_id = $1`, [modId]);
    await db().query(
      `INSERT INTO qa_issues(src_string_id, target_lang, issue_type, severity, message)
       VALUES ($1, 'uk', 'calque', 'warning', 'Calque: x'), ($1, 'uk', 'length_delta', 'warning', 'ignored')`,
      [ids.reply],
    );
    return { modId, ids };
  };

  it('reads dialogue as conversations and the rest by family', async () => {
    const { modId, ids } = await fixture();

    const { batches } = await buildModBatches(db(), {
      modId,
      srcLang: 'en',
      targetLang: 'uk',
      contextProvenances: new Set(['tm_final_review']),
    });

    expect(batches.map((b) => b.batch_id)).toEqual([
      'testmod-dialog-001',
      'testmod-prose-001',
      'testmod-item-001',
    ]);

    const dialog = batches[0]!;
    expect(dialog.units.map((u) => u.kind)).toEqual(['topic', 'loose']);
    const [prompt, reply] = dialog.units[0]!.lines;
    expect(prompt).toMatchObject({
      id: ids.prompt,
      kind: 'prompt',
      speaker: 'Player',
      speaker_gender: 'any',
    });
    expect(reply).toMatchObject({
      id: ids.reply,
      kind: 'response',
      qa_hints: ['calque: Calque: x'],
    });
    expect(dialog.units[1]!.lines).toEqual([
      expect.objectContaining({ id: ids.loose, kind: 'response' }),
    ]);
    expect(dialog.names).toEqual({ Hancock: expect.any(String) });

    const items = batches[2]!.units.flatMap((u) => u.lines);
    expect(items.map((l) => [l.id, l.context_only ?? false])).toEqual([
      [ids.armor, false],
      [ids.canon, true],
    ]);
    expect(batches.flatMap((b) => b.units.flatMap((u) => u.lines.map((l) => l.id)))).not.toContain(
      ids.skipped,
    );
  });
});
