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

describe('expandSharedResponseAliases with origins', () => {
  const key = (formid: string, variant: number, origin: string) =>
    voiceTranslationMapKey(formid, variant, origin);

  it('aliases within the same origin using origin-qualified sharedFrom', () => {
    const map = new Map([
      [key('1AC372', 1, 'fallout4.esm'), { source: 'I do.' }],
      [key('1AC372', 2, 'fallout4.esm'), { source: 'Yes.' }],
    ]);
    expandSharedResponseAliases(map, new Map([['fallout4.esm/22B5CD', 'fallout4.esm/1AC372']]));

    expect(map.get('fallout4.esm/22B5CD:1')).toEqual({ source: 'I do.' });
    expect(map.get('fallout4.esm/22B5CD:2')).toEqual({ source: 'Yes.' });
  });

  it('does not borrow from the same FormID under another origin', () => {
    const map = new Map([[key('1AC372', 1, 'dlcrobot.esm'), { source: 'robot' }]]);
    expandSharedResponseAliases(map, new Map([['fallout4.esm/22B5CD', 'fallout4.esm/1AC372']]));

    expect(map.has('fallout4.esm/22B5CD:1')).toBe(false);
  });

  it('follows a pointer into another origin', () => {
    const map = new Map([[key('1AC372', 1, 'fallout4.esm'), { source: 'I do.' }]]);
    expandSharedResponseAliases(map, new Map([['patch.esp/000001', 'fallout4.esm/1AC372']]));

    expect(map.get('patch.esp/000001:1')).toEqual({ source: 'I do.' });
  });
});
