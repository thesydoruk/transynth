import { buildLlmParticipantPayload, participantPayloadFields } from '../dialogParticipants';
import { dialogParticipantsFromRow } from '../../web/data/queries/dialogs/participants';
import { playerSpeakerGenderFromVoiceKey } from '../../dialog';

describe('participantPayloadFields', () => {
  it('includes player addressee name and any gender for NPC lines to the player', () => {
    expect(
      participantPayloadFields({
        speaker: 'Preston',
        speaker_gender: 'male',
        addressee: 'Player',
        addressee_gender: 'any',
      }),
    ).toEqual({
      speaker: 'Preston',
      speaker_gender: 'male',
      addressee: 'Player',
      addressee_gender: 'any',
    });
  });

  it('carries an explicit unknown through and drops only empty names', () => {
    expect(
      participantPayloadFields({
        speaker: 'Raider',
        speaker_gender: 'unknown',
        addressee: null,
        addressee_gender: 'unknown',
      }),
    ).toEqual({ speaker: 'Raider', speaker_gender: 'unknown', addressee_gender: 'unknown' });
  });
});

describe('buildLlmParticipantPayload', () => {
  it('maps resolved participants into the LLM payload', () => {
    expect(
      buildLlmParticipantPayload(
        {
          speakerName: 'Piper',
          speakerGender: 'female',
          addresseeName: 'Player',
          addresseeGender: 'any',
        },
        { isDialogueLine: true },
      ),
    ).toEqual({
      speaker: 'Piper',
      speaker_gender: 'female',
      addressee: 'Player',
      addressee_gender: 'any',
    });
  });

  it('says "unknown" out loud on a dialog line rather than staying silent', () => {
    expect(
      buildLlmParticipantPayload(
        {
          speakerName: null,
          speakerGender: 'unknown',
          addresseeName: null,
          addresseeGender: 'unknown',
        },
        { isDialogueLine: true },
      ),
    ).toEqual({ speaker_gender: 'unknown', addressee_gender: 'unknown' });
  });

  it('sends no participants at all for text that is not dialog', () => {
    expect(
      buildLlmParticipantPayload(
        {
          speakerName: null,
          speakerGender: 'unknown',
          addresseeName: null,
          addresseeGender: 'unknown',
        },
        { isDialogueLine: false },
      ),
    ).toEqual({});
  });

  it('keeps a resolved narrator gender off a dialog line', () => {
    expect(
      buildLlmParticipantPayload(
        {
          speakerName: null,
          speakerGender: 'female',
          addresseeName: null,
          addresseeGender: 'unknown',
        },
        { isDialogueLine: false },
      ),
    ).toEqual({ speaker_gender: 'female' });
  });
});

describe('dialogParticipantsFromRow', () => {
  it('keeps a written protagonist definite instead of hedging', () => {
    // Same row, two games: the Bethesda player is `any` because the player
    // picks; Disco's Harry is male because the writers did.
    const row = { speaker_name: 'Kim', speaker_gender: 'male', addressee_kind: 'player' };
    expect(dialogParticipantsFromRow(row, 'NAM1', 'disco').addresseeGender).toBe('male');
    expect(dialogParticipantsFromRow(row, 'NAM1', 'fo4').addresseeGender).toBe('any');
  });

  it('flips RNAM to the player speaking to the topic NPC', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_name: 'Preston',
          speaker_gender: 'male',
          addressee_kind: 'player',
        },
        'RNAM',
        'fo4',
      ),
    ).toEqual({
      speakerName: 'Player',
      speakerGender: 'any',
      addresseeName: 'Preston',
      addresseeGender: 'male',
    });
  });

  it('marks an NPC NAM1 with no named addressee as spoken to the player', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_name: 'Ada',
          speaker_gender: 'female',
          addressee_kind: null,
        },
        'NAM1',
        'fo4',
      ),
    ).toEqual({
      speakerName: 'Ada',
      speakerGender: 'female',
      addresseeName: 'Player',
      addresseeGender: 'any',
    });
  });

  it('marks NAM1 to the player when addressee_kind is player', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_name: 'Preston',
          speaker_gender: 'male',
          addressee_kind: 'player',
        },
        'NAM1',
        'fo4',
      ),
    ).toEqual({
      speakerName: 'Preston',
      speakerGender: 'male',
      addresseeName: 'Player',
      addresseeGender: 'any',
    });
  });

  it('does not invent a player addressee when the player is speaking', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_name: 'Player',
          speaker_gender: 'any',
          speaker_is_player: true,
          addressee_kind: null,
        },
        'NAM1',
        'fo4',
      ),
    ).toEqual({
      speakerName: 'Player',
      speakerGender: 'any',
      addresseeName: null,
      addresseeGender: 'unknown',
    });
  });

  it('uses a MalePlayer voice folder for gender-specific player prompts', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_key: 'voice:MalePlayer',
          speaker_name: 'Preston',
          speaker_gender: 'male',
          addressee_kind: 'player',
        },
        'RNAM',
        'fo4',
      ),
    ).toEqual({
      speakerName: 'Player',
      speakerGender: 'male',
      addresseeName: 'Preston',
      addresseeGender: 'male',
    });
  });
});

describe('playerSpeakerGenderFromVoiceKey', () => {
  it('detects gender-specific player voice folders', () => {
    expect(playerSpeakerGenderFromVoiceKey('voice:FemalePlayer')).toBe('female');
    expect(playerSpeakerGenderFromVoiceKey('voice:MalePlayer')).toBe('male');
    expect(playerSpeakerGenderFromVoiceKey('voice:PlayerVoiceMale01')).toBeNull();
  });
});
