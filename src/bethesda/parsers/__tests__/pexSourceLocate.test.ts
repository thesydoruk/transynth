import { describe, it, expect } from '@jest/globals';
import { pexScriptKeyFromSourceFile, normalizePexScriptKey } from '../pexParser';
import {
  findPexLiteralLineNumbers,
  locatePexLiteralInPsc,
  pexScriptKeyFromRecordPath,
} from '../pexSourceLocate';

describe('pexScriptKeyFromSourceFile', () => {
  it('uses basename when header stores an absolute dev path', () => {
    const source =
      'E:\\BuildAgent\\work\\b34a7b76c86438c9\\scripts\\_workspace\\Art\\Raw\\CC\\OTMFO4001\\Source\\Scripts\\ccOTMFO4001\\ccOTMFO4001_QuestScript.psc';
    expect(pexScriptKeyFromSourceFile(source)).toBe('ccOTMFO4001_QuestScript');
  });

  it('strips .psc from a simple file name', () => {
    expect(pexScriptKeyFromSourceFile('WorkshopScript.psc')).toBe('WorkshopScript');
  });
});

describe('normalizePexScriptKey', () => {
  it('normalizes legacy record suffix paths', () => {
    const key =
      'E:\\BuildAgent\\work\\b34a7b76c86438c9\\scripts\\_workspace\\Art\\Raw\\CC\\OTMFO4001\\Source\\Scripts\\ccOTMFO4001\\ccOTMFO4001_QuestScript';
    expect(normalizePexScriptKey(key)).toBe('ccOTMFO4001_QuestScript');
  });
});

describe('pexScriptKeyFromRecordPath', () => {
  it('strips the PEX prefix', () => {
    expect(pexScriptKeyFromRecordPath('PEX\\DLC06E01Script')).toBe('dlc06e01script');
  });

  it('normalizes absolute dev paths from legacy imports', () => {
    expect(
      pexScriptKeyFromRecordPath(
        'PEX\\E:\\BuildAgent\\work\\scripts\\ccOTMFO4001\\ccOTMFO4001_QuestScript',
      ),
    ).toBe('ccotmfo4001_questscript');
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
