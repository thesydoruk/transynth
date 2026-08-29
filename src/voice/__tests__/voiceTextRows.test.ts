import { expandSharedResponseAliases, voiceTranslationMapKey } from '../voiceTextRows';

describe('expandSharedResponseAliases', () => {
  it('copies shared INFO text onto the borrowing FormID so its own fuz can match', () => {
    const map = new Map([[voiceTranslationMapKey('1AC372', 1), { source: 'I do.' }]]);
    expandSharedResponseAliases(map, new Map([['22B5CD', '1AC372']]));

    expect(map.get(voiceTranslationMapKey('22B5CD', 1))).toEqual({ source: 'I do.' });
    expect(map.get(voiceTranslationMapKey('1AC372', 1))).toEqual({ source: 'I do.' });
  });

  it('does not overwrite a record that already has its own response', () => {
    const map = new Map([
      [voiceTranslationMapKey('22B5CD', 1), { source: 'own' }],
      [voiceTranslationMapKey('1AC372', 1), { source: 'shared' }],
    ]);
    expandSharedResponseAliases(map, new Map([['22B5CD', '1AC372']]));

    expect(map.get(voiceTranslationMapKey('22B5CD', 1))).toEqual({ source: 'own' });
  });
});
