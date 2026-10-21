import {
  matchReusableVoiceLines,
  type ReuseVoiceDestLine,
  type ReuseVoiceSourceLine,
} from '../reuseSynthesizedVoiceMatch';

const dest = (overrides: Partial<ReuseVoiceDestLine> = {}): ReuseVoiceDestLine => ({
  speakerKey: 'MaleBoston',
  originPlugin: 'mod.esp',
  sourceText: 'Hello there.',
  translation: 'Привіт.',
  destRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
  sourceAbsPath: '/old/00011111_1.fuz',
  sourceRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
  hasLocalized: false,
  lineKey: '011111',
  variant: 1,
  ...overrides,
});

const source = (overrides: Partial<ReuseVoiceSourceLine> = {}): ReuseVoiceSourceLine => ({
  speakerKey: 'MaleBoston',
  originPlugin: 'mod.esp',
  sourceText: 'Hello there.',
  translation: 'Привіт.',
  localizedAbsPath: '/src/_localize/Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
  sourceAbsPath: '/src/00011111_1.fuz',
  sourceRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
  lineKey: '011111',
  variant: 1,
  ttsTextVersion: 'v1',
  voiceSimilarity: 0.9,
  ...overrides,
});

describe('matchReusableVoiceLines', () => {
  it('pairs a dest line with a donor that has the same speaker, source, and translation', () => {
    const matches = matchReusableVoiceLines([dest()], [source()]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source.localizedAbsPath).toContain('00011111_1.fuz');
  });

  it('treats speaker folder case as insignificant', () => {
    const matches = matchReusableVoiceLines(
      [dest({ speakerKey: 'maleboston' })],
      [source({ speakerKey: 'MaleBoston' })],
    );
    expect(matches).toHaveLength(1);
  });

  it('does not pair Nate and Nora takes of the same INFO text', () => {
    const matches = matchReusableVoiceLines(
      [dest({ speakerKey: 'PlayerVoiceFemale01' })],
      [source({ speakerKey: 'PlayerVoiceMale01' })],
    );
    expect(matches).toHaveLength(0);
  });

  it('skips dest lines that already have a localized take', () => {
    expect(matchReusableVoiceLines([dest({ hasLocalized: true })], [source()])).toEqual([]);
  });

  it('skips when the spoken line text is not an exact match', () => {
    expect(matchReusableVoiceLines([dest({ sourceText: 'Hello there!' })], [source()])).toEqual([]);
    expect(matchReusableVoiceLines([dest({ translation: 'Добрий день.' })], [source()])).toEqual(
      [],
    );
  });

  it('skips empty translation or source', () => {
    expect(matchReusableVoiceLines([dest({ translation: '   ' })], [source()])).toEqual([]);
    expect(matchReusableVoiceLines([dest()], [source({ sourceText: '' })])).toEqual([]);
  });

  it('still matches when FormID changed between versions', () => {
    const matches = matchReusableVoiceLines(
      [
        dest({
          lineKey: '0ABCDE',
          destRelPath: 'Sound/Voice/Mod.esp/MaleBoston/000ABCDE_1.fuz',
        }),
      ],
      [source({ lineKey: '011111' })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.dest.lineKey).toBe('0ABCDE');
  });
});

describe('matchReusableVoiceLines donor staleness', () => {
  const expected = (line: { translation: string }) => `v:${line.translation}`;

  it('uses a donor whose stamp matches the version of its current text', () => {
    const matches = matchReusableVoiceLines(
      [dest()],
      [source({ ttsTextVersion: 'v:Привіт.' })],
      expected,
    );
    expect(matches).toHaveLength(1);
  });

  it('skips a donor whose take was made from an older translation', () => {
    const matches = matchReusableVoiceLines(
      [dest()],
      [source({ ttsTextVersion: 'v:Вітаю.' }), source({ ttsTextVersion: null })],
      expected,
    );
    expect(matches).toHaveLength(0);
  });

  it('keeps the old behaviour when no version check is given', () => {
    expect(
      matchReusableVoiceLines([dest()], [source({ ttsTextVersion: 'whatever' })]),
    ).toHaveLength(1);
  });
});
