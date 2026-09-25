import { describe, it, expect, jest } from '@jest/globals';
import '../../../../../../src/games/registerForTests';
import type { LlmVerifyItem } from '../../../../../../src/llm/verifyTranslate';
import { keepPersistedPreRepairs, preRepairGenderLeaks } from '../preRepairGenderLeaks';
import type { VerifyStringRow } from '../types';

const row = (over: Partial<VerifyStringRow> = {}): VerifyStringRow => ({
  string_id: 1,
  source: 'Are you ready?',
  translation: 'Ти готовий?',
  text_norm: null,
  text_norm_nopunct: null,
  signature: 'INFO',
  path: 'INFO\\NAM1',
  edid: 'TestLine',
  context: null,
  narrator_gender: null,
  narrator_gender_source: null,
  narrator_gender_override: null,
  rewrite_count: 0,
  prior_texts: [],
  speaker_key: 'npc:00000001',
  speaker_name: 'Piper',
  speaker_gender: 'female',
  speaker_is_player: false,
  addressee_kind: 'player',
  addressee_name: null,
  addressee_gender: 'any',
  ...over,
});

const item = (over: Partial<LlmVerifyItem> = {}): LlmVerifyItem => ({
  id: 1,
  source: 'Are you ready?',
  translation: 'Ти готовий?',
  grup: 'INFO',
  edid: 'TestLine',
  field: 'NAM1',
  context: null,
  speaker: 'Piper',
  speaker_gender: 'female',
  addressee: 'Player',
  addressee_gender: 'any',
  ...over,
});

const opts = { model: 'test-model', srcLang: 'en', targetLang: 'uk', game: 'fo4' };

const repairWith = (answers: Record<number, string>) =>
  jest.fn(async (rows: VerifyStringRow[]) => {
    const out = new Map<number, string>();
    for (const r of rows) if (answers[r.string_id]) out.set(r.string_id, answers[r.string_id]!);
    return out;
  });

describe('preRepairGenderLeaks', () => {
  it('sends a proven leak to the pass and audits the repaired wording', async () => {
    const repair = repairWith({ 1: 'Ну що, рушаємо?' });
    const outcome = await preRepairGenderLeaks([row()], [item()], opts, { repair });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(outcome.attempted).toEqual(new Set([1]));
    expect(outcome.repaired).toEqual([{ stringId: 1, text: 'Ну що, рушаємо?', row: row() }]);
    expect(outcome.rows[0]).toMatchObject({
      translation: 'Ну що, рушаємо?',
      rewrite_count: 1,
      prior_texts: ['Ти готовий?'],
    });
  });

  it('leaves a clean line alone without calling the pass', async () => {
    const repair = repairWith({});
    const clean = row({ translation: 'Ну що, рушаємо?' });
    const outcome = await preRepairGenderLeaks(
      [clean],
      [item({ translation: 'Ну що, рушаємо?' })],
      opts,
      { repair },
    );
    expect(repair).not.toHaveBeenCalled();
    expect(outcome.rows).toEqual([clean]);
    expect(outcome.attempted.size).toBe(0);
  });

  it('remembers a line the pass could not fix, and audits it as it is', async () => {
    const outcome = await preRepairGenderLeaks([row()], [item()], opts, {
      repair: repairWith({}),
    });
    expect(outcome.repaired).toEqual([]);
    expect(outcome.attempted).toEqual(new Set([1]));
    expect(outcome.rows[0]?.translation).toBe('Ти готовий?');
  });

  it('does not touch narration whose gender was only guessed', async () => {
    const repair = repairWith({ 1: 'Аналіз завершено.' });
    const narration = row({
      signature: 'TERM',
      path: 'TERM\\UNAM',
      translation: 'Я завершив аналіз.',
      narrator_gender: 'female',
      narrator_gender_source: 'heuristic',
      speaker_key: null,
      speaker_name: null,
      speaker_gender: null,
      addressee_kind: null,
      addressee_gender: null,
    });
    const outcome = await preRepairGenderLeaks(
      [narration],
      [
        item({
          grup: 'TERM',
          field: 'UNAM',
          translation: 'Я завершив аналіз.',
          speaker_gender: 'female',
          addressee: undefined,
          addressee_gender: undefined,
        }),
      ],
      opts,
      { repair },
    );
    expect(repair).not.toHaveBeenCalled();
    expect(outcome.attempted.size).toBe(0);
  });

  it('does nothing for a language the detector does not read', async () => {
    const repair = repairWith({ 1: 'x' });
    const outcome = await preRepairGenderLeaks(
      [row()],
      [item()],
      { ...opts, targetLang: 'de' },
      {
        repair,
      },
    );
    expect(repair).not.toHaveBeenCalled();
    expect(outcome.rows[0]?.translation).toBe('Ти готовий?');
  });
});

describe('keepPersistedPreRepairs', () => {
  it('restores the original wording for a repair that was not written', async () => {
    const outcome = await preRepairGenderLeaks(
      [row(), row({ string_id: 2 })],
      [item(), item({ id: 2 })],
      opts,
      { repair: repairWith({ 1: 'Ну що, рушаємо?', 2: 'Готово?' }) },
    );
    const kept = keepPersistedPreRepairs(outcome, new Set([2]));
    expect(kept.rows.map((r) => r.translation)).toEqual(['Ти готовий?', 'Готово?']);
    expect(kept.repaired.map((fix) => fix.stringId)).toEqual([2]);
    expect(kept.attempted).toEqual(new Set([1, 2]));
  });
});
