import { describe, expect, it } from '@jest/globals';
import { fixProblems, validateFixes } from '../validate';
import type { ReviewBatch, ReviewLine } from '../types';

const line = (over: Partial<ReviewLine> = {}): ReviewLine => ({
  id: 1,
  kind: 'response',
  src: 'Are you ready to go, <Alias=Player>?',
  tr: 'Ти готовий іти, <Alias=Player>?',
  ...over,
});

const problems = (next: string, over: Partial<ReviewLine> = {}, old?: string) => {
  const l = line(over);
  return fixProblems(l, { id: l.id, old: old ?? l.tr, new: next }, 'fo4');
};

describe('fixProblems', () => {
  it('accepts a fix that keeps tags and meaning', () => {
    expect(problems('Ну що, рушаємо, <Alias=Player>?')).toEqual([]);
  });

  it('rejects a fix whose old text is not the current translation', () => {
    expect(problems('Ну що, рушаємо, <Alias=Player>?', {}, 'Інший текст')).toContain(
      'old does not match the current translation',
    );
  });

  it('rejects lost tags, slash gender forms and stray English', () => {
    expect(problems('Ну що, рушаємо?')).toContain('tags or placeholders changed');
    expect(problems('Ти готовий/а іти, <Alias=Player>?')).toContain('slash gender form');
    expect(problems('Ну що, rush, <Alias=Player>?')).toEqual(['unexpected Latin: rush']);
  });

  it('does not take units such as об/хв for a gender form', () => {
    expect(problems('2000 об/хв', { src: '2000 RPM', tr: '2000 обертів' })).not.toContain(
      'slash gender form',
    );
  });

  it('keeps the brackets of a tone remark and the question mark of a short question', () => {
    expect(problems('Сарказм', { src: 'Sarcastic', tr: '[Сарказм]' })).toContain(
      'the remark keeps its brackets',
    );
    expect(problems('Рушаймо, <Alias=Player>')).toContain('question mark lost');
  });

  it('never applies to context lines or unknown ids', () => {
    expect(problems('Ну що, рушаємо, <Alias=Player>?', { context_only: true })).toContain(
      'context_only line',
    );
    expect(fixProblems(undefined, { id: 9, old: '', new: 'х' }, 'fo4')).toEqual(['unknown id']);
  });
});

describe('validateFixes', () => {
  it('splits a fix file into ok and rejected, and rejects a repeated id', () => {
    const batch: ReviewBatch = {
      batch_id: 'fo4-dialog-001',
      mod: 'Fallout4.esm',
      mod_id: 33,
      game: 'fo4',
      family: 'dialog',
      names: {},
      units: [{ unit_id: 'u', kind: 'conversation', lines: [line()] }],
    };
    const fix = { id: 1, old: line().tr, new: 'Ну що, рушаємо, <Alias=Player>?' };

    const checked = validateFixes(
      batch,
      { batch_id: batch.batch_id, fixes: [fix, fix], notes: ['n'] },
      'fo4',
    );

    expect(checked.ok).toEqual([fix]);
    expect(checked.rejected).toEqual([{ fix, why: ['duplicate id'] }]);
    expect(checked.notes).toEqual(['n']);
  });
});

describe('fixProblems — Disco lockit markup', () => {
  const disco = (over: Partial<ReviewLine> = {}): ReviewLine => ({
    id: 7,
    kind: 'response',
    src: '"The big deal?" The lieutenant rolls his eyes. "I guess we *really* differ -- a lot."',
    tr: '"Велика справа?" Лейтенант закочує очі. "Мабуть, ми *справді* різні -- дуже."',
    ...over,
  });
  const check = (next: string) => {
    const l = disco();
    return fixProblems(l, { id: l.id, old: l.tr, new: next }, 'disco');
  };

  it('accepts a fix that keeps quotes, italics and the em dash', () => {
    expect(
      check('"Велика річ?" Лейтенант закочує очі. "Схоже, ми *справді* різні -- дуже."'),
    ).toEqual([]);
  });

  it('rejects a fix that loses a quote pair', () => {
    expect(
      check('Велика річ? Лейтенант закочує очі. "Схоже, ми *справді* різні -- дуже."').join(' '),
    ).toMatch(/quotes/);
  });

  it('folds guillemets and a typographic dash into the lockit shape before checking', () => {
    const l = disco();
    const checked = validateFixes(
      {
        batch_id: 'b',
        mod: 'm',
        mod_id: 1,
        game: 'disco',
        family: 'dialog',
        names: {},
        units: [{ unit_id: 'u', kind: 'loose', lines: [l] }],
      },
      {
        batch_id: 'b',
        fixes: [
          {
            id: 7,
            old: l.tr,
            new: '«Велика річ?» Лейтенант закочує очі. «Схоже, ми *справді* різні — дуже.»',
          },
        ],
      },
      'disco',
    );
    expect(checked.rejected).toEqual([]);
    expect(checked.ok[0]!.new).toBe(
      '"Велика річ?" Лейтенант закочує очі. "Схоже, ми *справді* різні -- дуже."',
    );
  });
});
