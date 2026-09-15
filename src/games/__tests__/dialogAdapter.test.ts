/**
 * What each game answers about who is speaking.
 *
 * These were all one hardcoded answer before: `signature === 'INFO'`, the
 * subrecord `RNAM`, and a player whose gender is always chosen. Every one of
 * them is a Bethesda fact, and Disco Elysium got the wrong answer to all three.
 */
import { describe, expect, it } from '@jest/globals';
import { allGamePlugins, gamePlugin } from '../registry';
import { dialogParticipantsLateralSql } from '../../web/data/queries/dialogs/participants';

describe('spoken lines', () => {
  it('is the INFO record for a Creation Engine title', () => {
    const dialog = gamePlugin('fo4').dialog!;
    expect(dialog.isSpokenSignature('INFO')).toBe(true);
    expect(dialog.isSpokenSignature('TERM')).toBe(false);
    expect(dialog.isSpokenSignature(null)).toBe(false);
  });

  it('is a dialogue or plain PO row for Disco, which has no INFO at all', () => {
    const dialog = gamePlugin('disco').dialog!;
    expect(dialog.isSpokenSignature('DLG')).toBe(true);
    expect(dialog.isSpokenSignature('PO')).toBe(true);
    expect(dialog.isSpokenSignature('GEN')).toBe(false);
    expect(dialog.isSpokenSignature('FX')).toBe(false);
    // The old shared check; it would have called every Disco line non-dialogue.
    expect(dialog.isSpokenSignature('INFO')).toBe(false);
  });
});

describe('the player half of an exchange', () => {
  it('is the RNAM subrecord on Creation Engine', () => {
    expect(gamePlugin('fo4').dialog!.isPlayerPromptField('RNAM')).toBe(true);
    expect(gamePlugin('fo4').dialog!.isPlayerPromptField('NAM1')).toBe(false);
  });

  it('does not exist for Disco, where each utterance is its own row', () => {
    expect(gamePlugin('disco').dialog!.isPlayerPromptField('RNAM')).toBe(false);
    expect(gamePlugin('disco').dialog!.isPlayerPromptField(null)).toBe(false);
  });
});

describe('protagonist gender', () => {
  it('is player-chosen on Creation Engine and written for Disco', () => {
    // The distinction the pipeline exists to respect: a Bethesda line must read
    // for either gender, a Harry line must read as Harry.
    expect(gamePlugin('fo4').dialog!.playerGender).toBe('any');
    expect(gamePlugin('disco').dialog!.playerGender).toBe('male');
  });
});

describe('the composed participant lookup', () => {
  const sql = dialogParticipantsLateralSql('r');

  it('gives every game with dialogue a branch guarded to its own ids', () => {
    for (const plugin of allGamePlugins()) {
      if (!plugin.dialog) continue;
      expect(sql).toContain(`'${plugin.id}'`);
    }
  });

  it('asks each game where it actually keeps the answer', () => {
    // Creation Engine walks the dialogue graph; Disco has none and joins the
    // voice clip that names the speaker.
    expect(sql).toContain('dialog_nodes');
    expect(sql).toContain('voice_clips');
  });

  it('produces the columns the row reader expects', () => {
    for (const column of [
      'speaker_key',
      'speaker_name',
      'speaker_gender',
      'speaker_is_player',
      'addressee_kind',
      'addressee_name',
      'addressee_gender',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('returns one row however many games answer', () => {
    expect(sql.trimEnd().endsWith('LIMIT 1')).toBe(true);
  });
});
