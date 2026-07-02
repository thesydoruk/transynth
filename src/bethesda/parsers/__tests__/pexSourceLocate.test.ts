import { describe, it, expect } from '@jest/globals';
import {
  findPexLiteralLineNumbers,
  locatePexLiteralInPsc,
  pexScriptKeyFromRecordPath,
} from '../pexSourceLocate';

describe('pexScriptKeyFromRecordPath', () => {
  it('strips the PEX prefix', () => {
    expect(pexScriptKeyFromRecordPath('PEX\\DLC06E01Script')).toBe('dlc06e01script');
  });
});

describe('findPexLiteralLineNumbers', () => {
  it('finds a quoted literal in PSC source', () => {
    const psc = [
      'Scriptname WorkshopScript extends ObjectReference',
      '',
      'Function OnInit()',
      '  string msg = "filled in when turned off by explosion"',
      'EndFunction',
    ].join('\n');

    expect(findPexLiteralLineNumbers(psc, 'filled in when turned off by explosion')).toEqual([4]);
  });
});

describe('locatePexLiteralInPsc', () => {
  it('returns a highlighted context window', () => {
    const psc = [
      'Event OnInit()',
      '  Debug.Trace("filled in when turned off by explosion")',
      'EndEvent',
    ].join('\n');

    const result = locatePexLiteralInPsc(psc, 'filled in when turned off by explosion', {
      scriptLabel: 'DLC06E01Script.psc',
    });

    expect(result).not.toBeNull();
    expect(result!.matchLineNumbers).toEqual([2]);
    expect(result!.contextLines.some((line) => line.highlight && line.lineNumber === 2)).toBe(true);
  });
});
