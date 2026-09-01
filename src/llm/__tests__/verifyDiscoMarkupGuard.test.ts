import { describe, expect, it } from '@jest/globals';
import { applyDiscoMarkupGuardToVerifyResult } from '../verifyDiscoMarkupGuard';

describe('applyDiscoMarkupGuardToVerifyResult', () => {
  const item = {
    id: 1,
    source: 'Someone has scribbled: "The copy is still here."',
    translation: 'Хтось надряпав, що копія все ще тут.',
    grup: 'INFO',
    field: 'NAM1',
    edid: null,
    context: null,
  };

  it('upgrades ok to incorrect when quotes are dropped', () => {
    const guarded = applyDiscoMarkupGuardToVerifyResult(
      item,
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.8, suggestion: null },
      'disco',
    );
    expect(guarded.verdict).toBe('incorrect');
    expect(guarded.reason).toContain('Disco markup mismatch');
    expect(guarded.reason).toContain('quotes');
  });

  it('upgrades ok to suspicious when italics are dropped', () => {
    const guarded = applyDiscoMarkupGuardToVerifyResult(
      { ...item, source: 'You *belong* here.', translation: 'Ти належиш сюди.' },
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.8, suggestion: null },
      'disco',
    );
    expect(guarded.verdict).toBe('suspicious');
    expect(guarded.reason).toContain('italics');
  });

  it('does nothing for other games', () => {
    const guarded = applyDiscoMarkupGuardToVerifyResult(
      item,
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.8, suggestion: null },
      'fo4',
    );
    expect(guarded.verdict).toBe('ok');
  });

  it('upgrades ok to incorrect when nested singles become inner doubles', () => {
    const guarded = applyDiscoMarkupGuardToVerifyResult(
      {
        ...item,
        source: `"If by 'fun stuff,' you mean alcohol."`,
        translation: `"Якщо під "розвагами" ви маєте на увазі алкоголь."`,
      },
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.8, suggestion: null },
      'disco',
    );
    expect(guarded.verdict).toBe('incorrect');
    expect(guarded.reason).toContain('titleSingles');
  });

  it('allows "…" → «…» without upgrading', () => {
    const guarded = applyDiscoMarkupGuardToVerifyResult(
      {
        ...item,
        translation: 'Хтось надряпав: «Копія все ще тут».',
      },
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.8, suggestion: null },
      'disco',
    );
    expect(guarded.verdict).toBe('ok');
  });
});
