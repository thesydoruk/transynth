import { describe, expect, it } from '@jest/globals';
import { focusUnits, isFocusTarget } from '../focus';
import type { ReviewLine, ReviewUnit } from '../types';

const line = (id: number, work: boolean): ReviewLine => ({
  id,
  kind: 'response',
  src: `line ${id}`,
  tr: work ? '' : `рядок ${id}`,
  ...(work ? {} : { context_only: true as const }),
});

const unit = (lines: ReviewLine[]): ReviewUnit => ({ unit_id: 'u', kind: 'topic', lines });

describe('isFocusTarget', () => {
  const row = (translation: string | null, provenance: string | null = null, source = 'Hi') => ({
    translation,
    provenance,
    source,
  });

  it('takes every line without a focus', () => {
    expect(isFocusTarget(undefined, row('Привіт'))).toBe(true);
    expect(isFocusTarget({ untranslated: false, provenances: new Set() }, row('Привіт'))).toBe(
      true,
    );
  });

  it('takes untranslated lines with letters in an untranslated run', () => {
    const focus = { untranslated: true };
    expect(isFocusTarget(focus, row(null))).toBe(true);
    expect(isFocusTarget(focus, row(''))).toBe(true);
    expect(isFocusTarget(focus, row('Привіт'))).toBe(false);
    expect(isFocusTarget(focus, row(null, null, '100%'))).toBe(false);
  });

  it('takes only the named provenances in a provenance run', () => {
    const focus = { provenances: new Set(['agent_translate']) };
    expect(isFocusTarget(focus, row('Привіт', 'agent_translate'))).toBe(true);
    expect(isFocusTarget(focus, row('Привіт', 'tm'))).toBe(false);
    expect(isFocusTarget(focus, row(null, null))).toBe(false);
  });
});

describe('focusUnits', () => {
  it('drops units with no work and trims context to the neighbours of work lines', () => {
    const ctx = Array.from({ length: 20 }, (_, i) => line(i + 1, false));
    const scene = unit([...ctx.slice(0, 10), line(100, true), ...ctx.slice(10)]);
    const [trimmed, ...rest] = focusUnits([unit(ctx), scene]);

    expect(rest).toEqual([]);
    expect(trimmed!.lines.map((l) => l.id)).toEqual([7, 8, 9, 10, 100, 11, 12, 13, 14]);
  });
});
