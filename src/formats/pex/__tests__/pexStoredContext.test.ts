import { describe, it, expect } from '@jest/globals';
import { locatePexLiteralInPsc } from '../pexSourceLocate';
import {
  formatPexStoredContextLabel,
  parsePexStoredContext,
  serializePexStoredContext,
} from '../pexStoredContext';

describe('pexStoredContext', () => {
  it('round-trips import-time PEX context JSON', () => {
    const snippet = locatePexLiteralInPsc(
      ['Event OnInit()', '  Debug.Trace("hello world")', 'EndEvent'].join('\n'),
      'hello world',
      { scriptLabel: 'TestScript.psc' },
    );
    expect(snippet).not.toBeNull();

    const encoded = serializePexStoredContext(snippet!);
    expect(parsePexStoredContext(encoded)).toEqual(snippet);
    expect(formatPexStoredContextLabel(snippet!)).toBe('TestScript.psc · line 2');
  });

  it('returns null for legacy plain-text context', () => {
    expect(parsePexStoredContext('WorkshopScript.psc · #1')).toBeNull();
  });
});
