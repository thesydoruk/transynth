import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { LlmTranslateResult } from '../../../../../../src/llm/translate';
import type { VerifyStringRow } from '../types';

type Pass = (opts: unknown, draft: LlmTranslateResult[]) => Promise<LlmTranslateResult[]>;

const recastDialogTranslations = jest.fn<Pass>();
const repairGenderLeaks = jest.fn<Pass>();

jest.unstable_mockModule('../../../../../../src/llm/dialogRecast', () => ({
  recastDialogTranslations,
}));
jest.unstable_mockModule('../../../../../../src/llm/genderRepair', () => ({
  repairGenderLeaks,
}));

const { editVerifyFixes, repairProvenGenderLeaks } = await import('../editVerifyFixes');

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

const opts = {
  model: 'test-model',
  srcLang: 'en',
  targetLang: 'uk',
  game: 'fo4',
  modName: 'TestMod',
};

beforeEach(() => {
  recastDialogTranslations.mockImplementation(async (_o, draft) => draft);
  repairGenderLeaks.mockImplementation(async (_o, draft) => draft);
});

describe('editVerifyFixes', () => {
  it('runs no pass and returns nothing when there are no fixes', async () => {
    const edited = await editVerifyFixes([], opts);
    expect(edited.size).toBe(0);
    expect(recastDialogTranslations).not.toHaveBeenCalled();
    expect(repairGenderLeaks).not.toHaveBeenCalled();
  });

  it('returns the edited line when a pass rewrote the fix', async () => {
    repairGenderLeaks.mockImplementation(async () => [{ id: 1, translation: 'Ну що, рушаємо?' }]);
    const edited = await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    expect(edited.get(1)).toBe('Ну що, рушаємо?');
  });

  it('feeds the recast output into the gender repair pass', async () => {
    recastDialogTranslations.mockImplementation(async () => [{ id: 1, translation: 'recast' }]);
    await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    expect(repairGenderLeaks).toHaveBeenCalledWith(expect.anything(), [
      { id: 1, translation: 'recast' },
    ]);
  });

  it('carries the speaker and addressee into the passes', async () => {
    await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    const [passedOpts] = recastDialogTranslations.mock.calls[0]!;
    expect(passedOpts).toMatchObject({
      game: 'fo4',
      targetLang: 'uk',
      items: [expect.objectContaining({ speaker: 'Piper', addressee_gender: 'any' })],
    });
  });

  it('keeps the fix when an edit drops a protected token', async () => {
    repairGenderLeaks.mockImplementation(async () => [
      { id: 1, translation: 'Мені потрібно кришок.' },
    ]);
    const edited = await editVerifyFixes(
      [
        {
          stringId: 1,
          text: 'Мені потрібно %s кришок.',
          row: row({ source: 'I need %s caps.', translation: 'Я потребую %s кришок.' }),
        },
      ],
      opts,
    );
    expect(edited.has(1)).toBe(false);
  });

  it('keeps the fix when an edit walks it back to the rejected translation', async () => {
    repairGenderLeaks.mockImplementation(async () => [{ id: 1, translation: 'Ти готовий?' }]);
    const edited = await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    expect(edited.has(1)).toBe(false);
  });

  it('reports nothing edited when a pass throws', async () => {
    recastDialogTranslations.mockImplementation(async () => {
      throw new Error('LLM down');
    });
    const edited = await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    expect(edited.size).toBe(0);
  });

  it('leaves a fix alone when the passes changed nothing', async () => {
    const edited = await editVerifyFixes([{ stringId: 1, text: 'Ви готові?', row: row() }], opts);
    expect(edited.has(1)).toBe(false);
  });
});

describe('repairProvenGenderLeaks', () => {
  // 'any' is the player's gender, so a masculine past-tense form leaks it.
  const leaking = () =>
    row({ source: 'Have you been to a Vault?', translation: 'Ти вже бував у Сховищі?' });

  it('asks nothing when there is nothing to repair', async () => {
    expect((await repairProvenGenderLeaks([], opts)).size).toBe(0);
    expect(repairGenderLeaks).not.toHaveBeenCalled();
  });

  it('runs only the gender pass, never a broad recast', async () => {
    await repairProvenGenderLeaks([leaking()], opts);
    expect(repairGenderLeaks).toHaveBeenCalled();
    expect(recastDialogTranslations).not.toHaveBeenCalled();
  });

  it('hands the line over as it stands', async () => {
    await repairProvenGenderLeaks([leaking()], opts);
    expect(repairGenderLeaks).toHaveBeenCalledWith(expect.anything(), [
      { id: 1, translation: 'Ти вже бував у Сховищі?' },
    ]);
  });

  it('takes a repair that removed the leak', async () => {
    // Present tense carries no gender, which is what the pass is asked for.
    repairGenderLeaks.mockImplementation(async () => [
      { id: 1, translation: 'Ти знаєш про Сховища?' },
    ]);
    const fixed = await repairProvenGenderLeaks([leaking()], opts);
    expect(fixed.get(1)).toBe('Ти знаєш про Сховища?');
  });

  it('drops a repair that still leaks', async () => {
    repairGenderLeaks.mockImplementation(async () => [
      { id: 1, translation: 'Ти вже ходив у Сховище?' },
    ]);
    expect((await repairProvenGenderLeaks([leaking()], opts)).size).toBe(0);
  });

  it('drops a repair that lost a protected token', async () => {
    repairGenderLeaks.mockImplementation(async () => [{ id: 1, translation: 'Тобі дали кришок.' }]);
    const fixed = await repairProvenGenderLeaks(
      [row({ source: 'You got %s caps.', translation: 'Ти отримав %s кришок.' })],
      opts,
    );
    expect(fixed.size).toBe(0);
  });

  it('leaves the row alone when the pass returned it unchanged', async () => {
    const fixed = await repairProvenGenderLeaks([leaking()], opts);
    expect(fixed.size).toBe(0);
  });

  it('leaves the row alone when the pass throws', async () => {
    repairGenderLeaks.mockImplementation(async () => {
      throw new Error('LLM down');
    });
    expect((await repairProvenGenderLeaks([leaking()], opts)).size).toBe(0);
  });
});
