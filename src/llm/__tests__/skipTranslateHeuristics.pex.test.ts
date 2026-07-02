import { describe, it, expect } from '@jest/globals';
import { detectSkipHeuristic } from '../skipTranslateHeuristics';
import { serializePexStoredContext } from '../../formats/pex/pexStoredContext';
import { locatePexLiteralInPsc } from '../../formats/pex/pexSourceLocate';

describe('detectSkipHeuristic — PEX', () => {
  it('skips debug literals using stored PSC context', () => {
    const snippet = locatePexLiteralInPsc(
      ['Function OnInit()', '  Debug.Trace("internal state dump")', 'EndFunction'].join('\n'),
      'internal state dump',
      { scriptLabel: 'TestScript.psc' },
    );
    expect(snippet).not.toBeNull();

    const hit = detectSkipHeuristic('internal state dump', {
      signature: 'PEX',
      path: 'PEX\\TestScript',
      context: serializePexStoredContext(snippet!),
    });

    expect(hit?.method).toBe('heuristic');
    expect(hit?.reason).toMatch(/Debug|log/i);
  });

  it('keeps MessageBox literals', () => {
    const snippet = locatePexLiteralInPsc(
      ['Function Show()', '  MessageBox.Show("Choose reward")', 'EndFunction'].join('\n'),
      'Choose reward',
      { scriptLabel: 'TestScript.psc' },
    );

    const hit = detectSkipHeuristic('Choose reward', {
      signature: 'PEX',
      path: 'PEX\\TestScript',
      context: serializePexStoredContext(snippet!),
    });

    expect(hit).toBeNull();
  });
});
