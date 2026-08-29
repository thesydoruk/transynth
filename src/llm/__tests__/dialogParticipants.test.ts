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

  it('drops unknown genders and empty names', () => {
    expect(
      participantPayloadFields({
        speaker: 'Raider',
        speaker_gender: 'unknown',
        addressee: null,
        addressee_gender: 'unknown',
      }),
    ).toEqual({ speaker: 'Raider' });
  });
});

describe('buildLlmParticipantPayload', () => {
  it('maps resolved participants into the LLM payload', () => {
    expect(
      buildLlmParticipantPayload({
        speakerName: 'Piper',
        speakerGender: 'female',
        addresseeName: 'Player',
        addresseeGender: 'any',
      }),
    ).toEqual({
      speaker: 'Piper',
      speaker_gender: 'female',
      addressee: 'Player',
      addressee_gender: 'any',
    });
  });
});

describe('dialogParticipantsFromRow', () => {
  it('flips RNAM to the player speaking to the topic NPC', () => {
    expect(
      dialogParticipantsFromRow(
        {
          speaker_name: 'Preston',
          speaker_gender: 'male',
          addressee_kind: 'player',
        },
        'RNAM',
      ),
    ).toEqual({
      speakerName: 'Player',
      speakerGender: 'any',
      addresseeName: 'Preston',
      addresseeGender: 'male',
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
      ),
    ).toEqual({
      speakerName: 'Preston',
      speakerGender: 'male',
      addresseeName: 'Player',
      addresseeGender: 'any',
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
