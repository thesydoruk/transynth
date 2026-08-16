import {
  GAME_TTS_MATCH_DEFAULTS,
  gameTtsMatchFor,
  normalizeGameTtsSettings,
} from '../gameTtsSettings';

describe('normalizeGameTtsSettings', () => {
  it('returns an empty map for missing or invalid values', () => {
    expect(normalizeGameTtsSettings(undefined)).toEqual({});
    expect(normalizeGameTtsSettings(null)).toEqual({});
    expect(normalizeGameTtsSettings([])).toEqual({});
    expect(normalizeGameTtsSettings('fo4')).toEqual({});
  });

  it('keeps valid per-game flags and fills missing booleans', () => {
    expect(
      normalizeGameTtsSettings({
        fo4: { matchLoudness: false },
        disco: { matchLoudness: true, matchTiming: false },
        '': { matchLoudness: false, matchTiming: false },
        bad: 'nope',
      }),
    ).toEqual({
      fo4: { matchLoudness: false, matchTiming: true },
      disco: { matchLoudness: true, matchTiming: false },
    });
  });
});

describe('gameTtsMatchFor', () => {
  it('uses defaults when the game is missing from the map', () => {
    expect(gameTtsMatchFor({}, 'fo4')).toEqual(GAME_TTS_MATCH_DEFAULTS);
    expect(gameTtsMatchFor({ fo4: { matchLoudness: false, matchTiming: false } }, 'disco')).toEqual(
      GAME_TTS_MATCH_DEFAULTS,
    );
    expect(gameTtsMatchFor({ fo4: { matchLoudness: false, matchTiming: true } }, null)).toEqual(
      GAME_TTS_MATCH_DEFAULTS,
    );
  });

  it('returns the stored flags for that game', () => {
    expect(gameTtsMatchFor({ fo4: { matchLoudness: false, matchTiming: false } }, 'fo4')).toEqual({
      matchLoudness: false,
      matchTiming: false,
    });
  });
});
