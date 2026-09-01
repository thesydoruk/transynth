import { describe, expect, it } from '@jest/globals';
import { decideDiscoSpokenFromAsr } from '../discoSpokenAsr';
import { resolveDiscoSpokenRowFromAsr } from '../discoSpokenText';

const ACELE = 'She gathers herself for a moment, then says, "Okay."';
const SCRIBBLE =
  'Someone has scribbled: "S, I can\'t believe the off-site copy is still here! ' +
  'The illiterate ginger kid keeps stealing stuff from the studio, so I had to hide it somewhere safe."';
const CARD =
  'The library card is folded into two and still slightly wet to the touch. ' +
  'The front side reads: "Central Jamrock Public Library Card. Issued to ' +
  'Billie Méjean, expires July \'53."';
const CHICA =
  '"Really?" She appears to believe you. "You seem pretty upset about this *chica*... are you sure you don\'t remember anything about her?"';
const CHICA_QUOTES =
  "Really? You seem pretty upset about this *chica*... are you sure you don't remember anything about her?";

describe('decideDiscoSpokenFromAsr', () => {
  it('keeps quote-free lines as full', () => {
    expect(decideDiscoSpokenFromAsr('Punch the door.', 'Punch the door.')).toEqual({
      mode: 'full',
      spokenSource: 'Punch the door.',
    });
  });

  it('keeps mixed text as full when ASR is empty', () => {
    expect(decideDiscoSpokenFromAsr(ACELE, '')).toEqual({
      mode: 'full',
      spokenSource: ACELE,
    });
    expect(decideDiscoSpokenFromAsr(ACELE, null)).toEqual({
      mode: 'full',
      spokenSource: ACELE,
    });
  });

  it('drops interstitial narration between two quotes when ASR is empty', () => {
    expect(decideDiscoSpokenFromAsr(CHICA, '')).toEqual({
      mode: 'quoted',
      spokenSource: CHICA_QUOTES,
      quoteIndexes: [0, 1],
    });
    expect(decideDiscoSpokenFromAsr(CHICA, null)).toEqual({
      mode: 'quoted',
      spokenSource: CHICA_QUOTES,
      quoteIndexes: [0, 1],
    });
  });

  it('cuts to the quote when ASR is only that speech (Acele / Okay.)', () => {
    expect(decideDiscoSpokenFromAsr(ACELE, 'Okay.')).toEqual({
      mode: 'quoted',
      spokenSource: 'Okay.',
      quoteIndexes: [0],
    });
  });

  it('keeps the scribble line full when ASR includes the prefix', () => {
    const asr =
      "Someone has scribbled: S, I can't believe the off-site copy is still here! " +
      'The illiterate ginger kid keeps stealing stuff from the studio, so I had to hide it somewhere safe.';
    const decided = decideDiscoSpokenFromAsr(SCRIBBLE, asr);
    expect(decided.mode).toBe('full');
    expect(decided.spokenSource).toBe(SCRIBBLE);
  });

  it('cuts the scribble prefix when no narration word is transcribed', () => {
    const asr =
      "S, I can't believe the off-site copy is still here! The illiterate ginger kid " +
      'keeps stealing stuff from the studio, so I had to hide it somewhere safe.';
    expect(decideDiscoSpokenFromAsr(SCRIBBLE, asr).mode).toBe('quoted');
  });

  it('keeps scribble full when ASR mangles the prefix (scribble/scribbled)', () => {
    const asr =
      'Someone has scribble S I cant believe the off-site copy is still here! ' +
      'The illiterate ginger kid keeps stealing stuff from the studio so I had to hide it somewhere safe';
    expect(decideDiscoSpokenFromAsr(SCRIBBLE, asr).mode).toBe('full');
  });

  it('treats OK / oh kay as Okay for a short character take', () => {
    expect(decideDiscoSpokenFromAsr(ACELE, 'OK').mode).toBe('quoted');
    expect(decideDiscoSpokenFromAsr(ACELE, 'Oh kay.').mode).toBe('quoted');
  });

  it('cuts a one-word stage direction off a long quote (Rene / He sighs.)', () => {
    const source =
      '"Instead, all that is just, holy, and beautiful in the world was wiped away and now ' +
      'it\'s neon signs with toothpaste ads everywhere." He sighs.';
    const asr =
      'Instead, all that is just, holy, and beautiful in the world was wiped away, and now ' +
      "it's neon signs with toothpaste ads everywhere.";
    expect(decideDiscoSpokenFromAsr(source, asr, { confidence: 0.836 })).toMatchObject({
      mode: 'quoted',
      quoteIndexes: [0],
    });
  });

  it('speaks only the grunt when a working service transcribed nothing', () => {
    const source = '"Uh..." She doesn\'t know what to say.';
    expect(decideDiscoSpokenFromAsr(source, '', { confidence: 0, transcribed: true })).toEqual({
      mode: 'quoted',
      spokenSource: 'Uh...',
      quoteIndexes: [0],
    });
    expect(decideDiscoSpokenFromAsr(source, '', { confidence: 0 }).mode).toBe('full');
  });

  it('cuts to the quotes when a low-confidence take transcribed no prose', () => {
    expect(decideDiscoSpokenFromAsr(ACELE, 'Okay.', { confidence: 0.2 })).toEqual({
      mode: 'quoted',
      spokenSource: 'Okay.',
      quoteIndexes: [0],
    });
  });

  it('keeps every quote at low confidence, even when one fits the take alone', () => {
    const source = '"Hello," she whispers loudly, "goodbye."';
    expect(decideDiscoSpokenFromAsr(source, 'Hello.', { confidence: 0.2 })).toMatchObject({
      mode: 'quoted',
      quoteIndexes: [0, 1],
    });
  });

  it('keeps mixed text full when a low-confidence take still carries narration', () => {
    const asr =
      "Someone has scribbled: S, I can't believe the off-site copy is still here! " +
      'The illiterate ginger kid keeps stealing stuff from the studio, so I had to hide it somewhere safe.';
    expect(decideDiscoSpokenFromAsr(SCRIBBLE, asr, { confidence: 0.2 }).mode).toBe('full');
  });

  it('keeps mixed text full at low confidence when narration has no provable word', () => {
    const source = '"Have you seen Evrart around here?" He ran.';
    expect(decideDiscoSpokenFromAsr(source, 'Uh', { confidence: 0.2 }).mode).toBe('full');
  });

  it('cuts to one quote when ASR matches only that span (custom)', () => {
    const source = '"Hello," she whispers, "goodbye."';
    expect(decideDiscoSpokenFromAsr(source, 'Hello.')).toEqual({
      mode: 'custom',
      spokenSource: 'Hello,',
      quoteIndexes: [0],
    });
    expect(decideDiscoSpokenFromAsr(source, 'Goodbye.')).toEqual({
      mode: 'custom',
      spokenSource: 'goodbye.',
      quoteIndexes: [1],
    });
  });

  it('keeps a stretched yeah quote when Whisper drops or normalizes it', () => {
    const source = '"Yeaaahhhh..." She really draws out the word. "Have you seen Evrart?"';
    const both = {
      mode: 'quoted' as const,
      spokenSource: 'Yeaaahhhh... Have you seen Evrart?',
      quoteIndexes: [0, 1],
    };
    expect(decideDiscoSpokenFromAsr(source, 'Have you seen Evrart?')).toEqual(both);
    expect(decideDiscoSpokenFromAsr(source, 'Yeah have you seen Evrart?')).toEqual(both);
    expect(decideDiscoSpokenFromAsr(source, 'Yeaaahhhh have you seen Evrart?')).toEqual(both);
  });

  it('keeps both quotes when ASR covers them and skips narration', () => {
    const source = '"Hello," she whispers, "goodbye."';
    expect(decideDiscoSpokenFromAsr(source, 'Hello goodbye.')).toMatchObject({
      mode: 'quoted',
      quoteIndexes: [0, 1],
    });
  });

  it('keeps a two-quote line full when ASR includes the narration', () => {
    const source = '"Hello," she whispers, "goodbye."';
    expect(decideDiscoSpokenFromAsr(source, 'Hello she whispers goodbye.').mode).toBe('full');
  });

  it('keeps a narrator card when ASR covers the description', () => {
    const asr =
      'The library card is folded into two and still slightly wet to the touch. ' +
      'The front side reads Central Jamrock Public Library Card issued to Billie Mejean expires July 53';
    expect(decideDiscoSpokenFromAsr(CARD, asr).mode).toBe('full');
  });
});

describe('resolveDiscoSpokenRowFromAsr', () => {
  it('reduces source and translation to quoted speech when ASR is the quote', () => {
    expect(
      resolveDiscoSpokenRowFromAsr(
        {
          source: ACELE,
          translation: 'Вона збирається з думками, а тоді каже: «Гаразд».',
        },
        'Okay.',
      ),
    ).toMatchObject({ source: 'Okay.', translation: 'Гаразд' });
  });

  it('keeps the full translation when it has no recognizable quotes', () => {
    expect(
      resolveDiscoSpokenRowFromAsr({ source: ACELE, translation: 'Гаразд, хай так.' }, 'Okay.'),
    ).toMatchObject({ source: 'Okay.', translation: 'Гаразд, хай так.' });
  });

  it('returns rows unchanged for fully quoted lines', () => {
    const row = {
      source: '"Right, I should go pay my debts."',
      translation: '«Так, спершу треба сплатити борги».',
    };
    expect(resolveDiscoSpokenRowFromAsr(row, 'anything')).toMatchObject(row);
  });

  it('strips interstitial Ukrainian narration between two quotes', () => {
    expect(
      resolveDiscoSpokenRowFromAsr(
        {
          source: CHICA,
          translation:
            '"Справді?" Схоже, вона тобі вірить. "Ти виглядаєш досить засмученим через цю *chica*... ти впевнений, що зовсім нічого про неї не пам\'ятаєш?"',
        },
        null,
      ),
    ).toMatchObject({
      source: CHICA_QUOTES,
      translation:
        "Справді? Ти виглядаєш досить засмученим через цю *chica*... ти впевнений, що зовсім нічого про неї не пам'ятаєш?",
    });
  });

  it('keeps both Ukrainian quotes when Whisper misses the stretched yeah', () => {
    expect(
      resolveDiscoSpokenRowFromAsr(
        {
          source: '"Yeaaahhhh..." She really draws out the word. "Have you seen Evrart?"',
          translation: '"Є-е-е-е-е..." Вона справді розтягує це слово. "Ти бачив Еврара?"',
        },
        'Have you seen Evrart?',
      ),
    ).toMatchObject({
      source: 'Yeaaahhhh... Have you seen Evrart?',
      translation: 'Є-е-е-е-е... Ти бачив Еврара?',
    });
  });

  it('maps a custom quote index onto the matching Ukrainian span', () => {
    expect(
      resolveDiscoSpokenRowFromAsr(
        {
          source: '"Hello," she whispers, "goodbye."',
          translation: '«Привіт,» вона шепоче, «бувай».',
        },
        'Goodbye.',
      ),
    ).toMatchObject({ source: 'goodbye.', translation: 'бувай' });
  });

  it('keeps both sides full when custom has no matching Ukrainian quotes', () => {
    const row = {
      source: '"Hello," she whispers, "goodbye."',
      translation: 'Вона лише шепоче бувай.',
    };
    expect(resolveDiscoSpokenRowFromAsr(row, 'Hello.')).toMatchObject({
      source: row.source,
      translation: row.translation,
    });
  });

  it('keeps mixed text full when ASR is missing (no duration cut)', () => {
    expect(
      resolveDiscoSpokenRowFromAsr({ source: ACELE, translation: '«Гаразд»' }, null),
    ).toMatchObject({
      source: ACELE,
      translation: '«Гаразд»',
    });
  });
});
