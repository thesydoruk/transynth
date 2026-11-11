import { describe, expect, it } from '@jest/globals';
import { isPexDisplayOnlyString } from '../pexDisplayUsage';
import { serializePexStoredContext } from '../pexStoredContext';

const context = (lines: Record<number, string>, matches = Object.keys(lines).map(Number)) =>
  serializePexStoredContext({
    scriptLabel: 'Test.psc',
    headerSourceFile: 'Test.psc',
    matchLineNumbers: matches,
    contextLines: Object.entries(lines).map(([n, text]) => ({
      lineNumber: Number(n),
      text,
      highlight: matches.includes(Number(n)),
    })),
  });

describe('isPexDisplayOnlyString', () => {
  it('trusts a literal shown by popups and HUD captions', () => {
    expect(isPexDisplayOnlyString('Saved!', context({ 3: '  Debug.Notification("Saved!")' }))).toBe(
      true,
    );
    expect(
      isPexDisplayOnlyString(
        ' is invalid.',
        context({ 7: '  Debug.MessageBox("Plot " + p as String + " is invalid.")' }),
      ),
    ).toBe(true);
    expect(
      isPexDisplayOnlyString(
        'Loading Settlers',
        context({ 9: '  Self.prepareSubBar("Loading Settlers", n) ; #DEBUG_LINE_NO:370' }),
      ),
    ).toBe(true);
  });

  it('rejects state, animation, stat and compared names', () => {
    for (const [literal, line] of [
      ['Done', '  Self.GoToState("Done") ; #DEBUG_LINE_NO:3'],
      ['Reset', '  Self.PlayAnimation("Reset")'],
      ['Workshops Unlocked', '  Game.IncrementStat("Workshops Unlocked", 1)'],
      ['Terminal Only', '  ElseIf lockLevel == "Terminal Only"'],
      ['MISC', '  Return "MISC" ; #DEBUG_LINE_NO:1517'],
      ['Plot ready', '  ModTraceCustom(sLogName, "Plot ready", 0, False)'],
    ]) {
      expect(isPexDisplayOnlyString(literal!, context({ 1: line! }))).toBe(false);
    }
  });

  it('rejects a literal also used outside a display call', () => {
    const both = context({
      4: '  Debug.Notification("Done")',
      9: '  Self.PlayAnimationAndWait("Play01", "Done")',
    });
    expect(isPexDisplayOnlyString('Done', both)).toBe(false);
  });

  it('rejects a match that only contains the literal as part of other text', () => {
    expect(
      isPexDisplayOnlyString('Item', context({ 2: '  Debug.MessageBox("Item not found")' })),
    ).toBe(false);
  });

  it('rejects unknown usage: no context, or a match outside the stored window', () => {
    expect(isPexDisplayOnlyString('Saved!', null)).toBe(false);
    expect(isPexDisplayOnlyString('Saved!', 'Some legacy context')).toBe(false);
    expect(
      isPexDisplayOnlyString('Saved!', context({ 3: '  Debug.Notification("Saved!")' }, [3, 400])),
    ).toBe(false);
  });

  it('matches escapes the way decompiled source spells them', () => {
    expect(
      isPexDisplayOnlyString(
        'Line one\nSay "hi"',
        context({ 5: '  Debug.MessageBox("Line one\\nSay \\"hi\\"")' }),
      ),
    ).toBe(true);
  });
});
