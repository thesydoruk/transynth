import { restoreDiscoCensoredSpeech } from '../discoCensorship';
import { prepareVoiceTtsText, stripVoiceNonSpeechBlocks } from '../../../voice/prepareVoiceTtsText';

describe('restoreDiscoCensoredSpeech', () => {
  it('restores the lockit slur and jacket tag with case', () => {
    expect(restoreDiscoCensoredSpeech("I'm not dying here, f****t.")).toBe(
      "I'm not dying here, faggot.",
    );
    expect(restoreDiscoCensoredSpeech('Puts the fear back in the f****ts.')).toBe(
      'Puts the fear back in the faggots.',
    );
    expect(restoreDiscoCensoredSpeech("jacket has 'PISSF****T' written on it")).toBe(
      "jacket has 'PISSFAGGOT' written on it",
    );
    expect(restoreDiscoCensoredSpeech('Pissf****t. Singular.')).toBe('Pissfaggot. Singular.');
  });

  it('leaves italics and unknown star-tokens alone', () => {
    expect(restoreDiscoCensoredSpeech('You *belong* here.')).toBe('You *belong* here.');
    expect(restoreDiscoCensoredSpeech('*Fucking* understand that.')).toBe(
      '*Fucking* understand that.',
    );
    expect(restoreDiscoCensoredSpeech('a**hole')).toBe('a**hole');
  });

  it('is idempotent', () => {
    const once = restoreDiscoCensoredSpeech('Hey, f****t!');
    expect(restoreDiscoCensoredSpeech(once)).toBe('Hey, faggot!');
  });
});

describe('TTS after restore', () => {
  it('does not collapse f****t to ft when unwrapping disco italics', () => {
    expect(stripVoiceNonSpeechBlocks("I'm not dying here, f****t. You *belong*.", 'disco')).toBe(
      "I'm not dying here, faggot. You belong.",
    );
  });

  it('sends the restored slur to synthesis', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: "I'm not dying here, f****t.",
        translation: 'Я тут не здохну, підаре.',
        speakerSource: "I'm not dying here, f****t.",
        markup: 'disco',
      }),
    ).toEqual({
      action: 'synthesize',
      text: 'Я тут не здохну, підаре.',
      speakerText: "I'm not dying here, faggot.",
    });
  });
});
