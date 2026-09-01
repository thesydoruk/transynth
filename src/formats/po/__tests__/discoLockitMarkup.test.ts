import {
  discoMarkupMismatchSeverity,
  discoMarkupMismatches,
  discoMarkupShape,
  extractDiscoItalicSpans,
  extractDiscoQuotedSpeech,
  joinDiscoQuoteSpans,
  extractDiscoQuoteSpans,
  extractDiscoTitleSingleSpans,
  hasDiscoNarrationOutsideQuotes,
  restoreDiscoEmDashes,
  restoreDiscoItalics,
  restoreDiscoMarkupShape,
  restoreDiscoTitleSingles,
  unwrapExtraDiscoQuotes,
} from '../discoLockitMarkup';

describe('extractDiscoQuotedSpeech', () => {
  it('extracts mixed narration + ASCII quotes (real lockit)', () => {
    expect(
      extractDiscoQuotedSpeech('He nods. "Yes, we both need to get proper rest tonight."'),
    ).toBe('Yes, we both need to get proper rest tonight.');
  });

  it('extracts the scribble-note quote', () => {
    const line =
      'Someone has scribbled: "S, I can\'t believe the off-site copy is still here! The illiterate ginger kid keeps stealing stuff from the studio, so I had to hide it somewhere safe."';
    expect(extractDiscoQuotedSpeech(line)?.startsWith("S, I can't believe")).toBe(true);
    expect(hasDiscoNarrationOutsideQuotes(line)).toBe(true);
  });

  it('keeps guillemets as the Ukrainian quote pair', () => {
    expect(extractDiscoQuotedSpeech('Хтось надряпав: «Сховок у студії».')).toBe('Сховок у студії');
    expect(extractDiscoQuoteSpans('Хтось надряпав: «Сховок у студії»')[0]?.kind).toBe('guillemet');
  });

  it('joins selected quote indexes for EN→UK mapping', () => {
    expect(joinDiscoQuoteSpans('"Foo," he says, "bar."', [1])).toBe('bar.');
    expect(joinDiscoQuoteSpans('Вона каже: «Раз». Потім: «Два».', [0])).toBe('Раз');
    expect(joinDiscoQuoteSpans('"Foo," he says, "bar."', [0, 2])).toBeNull();
  });
});

describe('italics and dashes', () => {
  it('finds *italic* spans that stay spoken', () => {
    expect(
      extractDiscoItalicSpans('This feels right. You *belong* here.').map((s) => s.content),
    ).toEqual(['belong']);
  });

  it('does not treat f****ts censorship as italic or **bold** wrappers', () => {
    expect(extractDiscoItalicSpans('those guys were all f****ts.')).toEqual([]);
  });

  it('counts -- as em-dashes, not --emphasis-- wrappers', () => {
    const line =
      "I know you're in a hurry, sir -- off to work really hard, as always -- I just need *one* moment.";
    expect(discoMarkupShape(line)).toEqual({
      quotes: 0,
      italics: 1,
      titleSingles: 0,
      emDashes: 2,
      uiBrackets: 0,
    });
  });
});

describe('title singles and UI brackets', () => {
  it('keeps nickname/title singles', () => {
    expect(
      extractDiscoTitleSingleSpans("Ask 'Scab Leader' about tattoos").map((s) => s.content),
    ).toEqual(['Scab Leader']);
  });

  it('does not treat contractions as quotes', () => {
    expect(hasDiscoNarrationOutsideQuotes("It's easy. You were taught it at school.")).toBe(false);
    expect(extractDiscoQuotedSpeech("It's easy. You were taught it at school.")).toBeNull();
    expect(extractDiscoTitleSingleSpans("It's easy. You were taught it at school.")).toEqual([]);
    expect(extractDiscoTitleSingleSpans("ім'я на вишивці. Здоров'я відновиться.")).toEqual([]);
  });

  it('treats nested scare-quotes as title singles, not speech spans', () => {
    const source = `"If by 'fun stuff,' you mean alcohol."`;
    expect(extractDiscoTitleSingleSpans(source).map((s) => s.content)).toEqual(['fun stuff,']);
    expect(extractDiscoQuoteSpans(source)).toHaveLength(1);
  });

  it('counts a one-letter title single', () => {
    expect(extractDiscoTitleSingleSpans(`"'And'?"`).map((s) => s.content)).toEqual(['And']);
    expect(extractDiscoTitleSingleSpans(`"'І'?"`).map((s) => s.content)).toEqual(['І']);
  });

  it('keeps wrapping singles when the span has English contractions', () => {
    expect(
      extractDiscoTitleSingleSpans("thought -- 'I'll take the boring one.'").map((s) => s.content),
    ).toEqual(["I'll take the boring one."]);
    expect(
      extractDiscoTitleSingleSpans("'C'mere, Luc. Over here now, please,'").map((s) => s.content),
    ).toEqual(["C'mere, Luc. Over here now, please,"]);
  });
});

describe('restoreDiscoTitleSingles', () => {
  it('turns inner doubles back into singles inside an outer speech quote', () => {
    expect(
      restoreDiscoTitleSingles(
        `"If by 'fun stuff,' you mean alcohol."`,
        `"Якщо під "розвагами" ви маєте на увазі алкоголь."`,
      ),
    ).toBe(`"Якщо під 'розвагами' ви маєте на увазі алкоголь."`);
  });

  it('turns a standalone title double back into singles', () => {
    expect(
      restoreDiscoTitleSingles(
        "Ask 'Scab Leader' about tattoos",
        'Запитай "Лідера Скебів" про тату',
      ),
    ).toBe("Запитай 'Лідера Скебів' про тату");
  });

  it('leaves contractions and matching singles alone', () => {
    expect(restoreDiscoTitleSingles("It's easy.", 'Це легко.')).toBe('Це легко.');
    expect(
      restoreDiscoTitleSingles(
        `"If by 'fun stuff,' you mean alcohol."`,
        `"Якщо під 'розвагами' ви маєте на увазі алкоголь."`,
      ),
    ).toBe(`"Якщо під 'розвагами' ви маєте на увазі алкоголь."`);
  });

  it('does not rewrite two separate speech quotes', () => {
    expect(restoreDiscoTitleSingles(`"Foo," he says, "bar."`, `"Раз," каже він, "два."`)).toBe(
      `"Раз," каже він, "два."`,
    );
  });

  it('restores singles around contracted speech the model wrapped in doubles', () => {
    expect(
      restoreDiscoTitleSingles(
        "thought -- 'I'll take the boring one.'",
        'подумав: -- "Візьму-но нудну."',
      ),
    ).toBe("подумав: -- 'Візьму-но нудну.'");
  });
});

describe('restoreDiscoEmDashes', () => {
  it('turns a typographic em dash into lockit --', () => {
    expect(restoreDiscoEmDashes('dignity -- to die', 'гідністю — і померти')).toBe(
      'гідністю -- і померти',
    );
  });

  it('fills a shortfall from a spaced hyphen when there is no typographic dash', () => {
    expect(restoreDiscoEmDashes('dignity -- to die', 'гідністю - і померти')).toBe(
      'гідністю -- і померти',
    );
  });

  it('converts only as many em dashes as the source needs', () => {
    expect(
      restoreDiscoEmDashes(
        'live with dignity -- to die',
        'хотів, — це жити з гідністю — і померти з честю',
      ),
    ).toBe('хотів, -- це жити з гідністю — і померти з честю');
  });

  it('is a no-op when the source has no --', () => {
    expect(restoreDiscoEmDashes('Hello there', 'Привіт — там')).toBe('Привіт — там');
  });
});

describe('restoreDiscoItalics', () => {
  it('re-wraps a Latin token the model dropped stars from', () => {
    expect(restoreDiscoItalics('You know *Prefect*', 'термін Prefect використовують')).toBe(
      'термін *Prefect* використовують',
    );
  });

  it('does not invent stars around paraphrased Ukrainian', () => {
    expect(restoreDiscoItalics('This whole thing is very *me*.', 'дуже в моєму дусі.')).toBe(
      'дуже в моєму дусі.',
    );
    expect(restoreDiscoItalics('Shut the *fuck* up', 'Заткнися, блядь, Глен!')).toBe(
      'Заткнися, блядь, Глен!',
    );
  });
});

describe('unwrapExtraDiscoQuotes', () => {
  it('unwraps an inner name the model quoted', () => {
    expect(
      unwrapExtraDiscoQuotes(
        '"Why do I need to go through Archer to speak to the Committee?"',
        '"Навіщо мені проходити через "Лучника", щоб поговорити з Комітетом?"',
      ),
    ).toBe('"Навіщо мені проходити через Лучника, щоб поговорити з Комітетом?"');
  });

  it('unwraps a title quote when the source is unquoted', () => {
    expect(
      unwrapExtraDiscoQuotes(
        'Most officers do the Jamrock Shuffle.',
        'Більшість офіцерів займаються "Джемрокським shuffle".',
      ),
    ).toBe('Більшість офіцерів займаються Джемрокським shuffle.');
  });
});

describe('restoreDiscoMarkupShape', () => {
  it('counts same-side curly quotes as a source span and keeps the UK pair', () => {
    const source = 'every time you say “I am the law“ -- and you say it';
    const uk = 'щоразу, коли ти кажеш "Я і є закон" -- а кажеш ти це';
    expect(extractDiscoQuoteSpans(source)).toHaveLength(1);
    expect(restoreDiscoMarkupShape(source, uk)).toBe(uk);
    expect(discoMarkupMismatches(source, restoreDiscoMarkupShape(source, uk))).toEqual([]);
  });

  it('does not invent -- from a Ukrainian adverb', () => {
    expect(
      restoreDiscoMarkupShape(
        'The lieutenant watches you beat yourself in the head -- again.',
        "Лейтенант спостерігає, як ти знову б'єш себе по голові.",
      ),
    ).toBe("Лейтенант спостерігає, як ти знову б'єш себе по голові.");
  });

  it('turns a mid-clause ellipsis back into --', () => {
    expect(
      restoreDiscoMarkupShape(
        "I haven't -- but don't worry, I can take it.",
        'Я не... але не хвилюйся, я з цим впораюся.',
      ),
    ).toBe('Я не -- але не хвилюйся, я з цим впораюся.');
  });
});

describe('discoMarkupMismatches', () => {
  it('allows "…" → «…» when the quote count matches', () => {
    expect(
      discoMarkupMismatches(
        'Someone has scribbled: "The copy is still here."',
        'Хтось надряпав: «Копія все ще тут».',
      ),
    ).toEqual([]);
  });

  it('flags a translation that eats the quotes', () => {
    const mismatches = discoMarkupMismatches(
      'Someone has scribbled: "The copy is still here."',
      'Хтось надряпав, що копія все ще тут.',
    );
    expect(mismatches).toEqual([{ field: 'quotes', source: 1, translation: 0 }]);
  });

  it('flags dropped italics', () => {
    expect(discoMarkupMismatches('You *belong* here.', 'Ти належиш сюди.')).toEqual([
      { field: 'italics', source: 1, translation: 0 },
    ]);
  });

  it('flags nested singles rewritten as inner doubles', () => {
    expect(
      discoMarkupMismatches(
        `"If by 'fun stuff,' you mean alcohol."`,
        `"Якщо під "розвагами" ви маєте на увазі алкоголь."`,
      ),
    ).toEqual([
      { field: 'quotes', source: 1, translation: 2 },
      { field: 'titleSingles', source: 1, translation: 0 },
    ]);
  });

  it('treats quote loss as incorrect and italics as suspicious', () => {
    expect(discoMarkupMismatchSeverity([{ field: 'quotes', source: 1, translation: 0 }])).toBe(
      'incorrect',
    );
    expect(discoMarkupMismatchSeverity([{ field: 'italics', source: 1, translation: 0 }])).toBe(
      'suspicious',
    );
  });
});
