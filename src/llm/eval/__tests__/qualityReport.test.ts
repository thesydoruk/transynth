import { describe, expect, it } from '@jest/globals';
import {
  bucketOf,
  buildEvalReport,
  findLineDefects,
  formatEvalReport,
  type EvalLine,
} from '../qualityReport';

const line = (over: Partial<EvalLine> = {}): EvalLine => ({
  id: 1,
  source: 'I took care of them.',
  translation: 'Про них подбали.',
  grup: 'INFO',
  speakerGender: 'any',
  addresseeGender: 'male',
  ...over,
});

describe('bucketOf', () => {
  it('separates the cases that behave differently', () => {
    expect(bucketOf(line({ speakerGender: 'any' }))).toBe('player_speaks');
    expect(bucketOf(line({ speakerGender: 'male', addresseeGender: 'any' }))).toBe(
      'player_addressed',
    );
    expect(bucketOf(line({ speakerGender: 'male', addresseeGender: 'female' }))).toBe(
      'known_gender',
    );
    expect(bucketOf(line({ speakerGender: 'unknown', addresseeGender: 'unknown' }))).toBe(
      'unknown_gender',
    );
  });

  it('reads the spoken signatures of the game, not just INFO', () => {
    // Disco has no INFO records at all; the old check filed every line here.
    expect(bucketOf(line({ game: 'disco', grup: 'DLG', speakerGender: 'male' }))).toBe(
      'known_gender',
    );
    expect(bucketOf(line({ game: 'disco', grup: 'GEN' }))).toBe('not_dialogue');
  });

  it('puts anything that is not a dialog record aside', () => {
    expect(bucketOf(line({ grup: 'TERM' }))).toBe('not_dialogue');
    expect(bucketOf(line({ grup: null }))).toBe('not_dialogue');
  });

  it('reads the player as speaking even when the addressee is known', () => {
    expect(bucketOf(line({ speakerGender: 'any', addresseeGender: 'female' }))).toBe(
      'player_speaks',
    );
  });
});

describe('findLineDefects', () => {
  it('finds nothing wrong with a clean line', () => {
    expect(findLineDefects(line())).toEqual([]);
  });

  it('reports a gender the metadata rules out', () => {
    const defects = findLineDefects(line({ translation: 'Я подбав про них.' }));
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({ kind: 'gender' });
    expect(defects[0]!.detail).toContain('подбав');
  });

  it('reports a surviving English construction', () => {
    const defects = findLineDefects(
      line({ source: "It's dangerous, isn't it?", translation: 'Це небезпечно, чи не так?' }),
    );
    expect(defects.map((defect) => defect.kind)).toEqual(['calque']);
  });

  it('reports a placeholder that did not survive', () => {
    const defects = findLineDefects(
      line({ source: 'Hello, <Alias=Player>.', translation: 'Привіт.' }),
    );
    expect(defects.map((defect) => defect.kind)).toContain('placeholder');
  });

  it('reports every defect of a line, not just the first', () => {
    const defects = findLineDefects(
      line({ source: "I did it, didn't I?", translation: 'Я зробив це, чи не так?' }),
    );
    expect(new Set(defects.map((defect) => defect.kind))).toEqual(new Set(['gender', 'calque']));
  });
});

describe('buildEvalReport', () => {
  it('counts defects by kind and lines by bucket', () => {
    const report = buildEvalReport([
      line({ id: 1 }),
      line({ id: 2, translation: 'Я подбав про них.' }),
      line({ id: 3, grup: 'TERM', translation: 'Це небезпечно, чи не так?' }),
    ]);

    expect(report.lines).toBe(3);
    expect(report.byKind).toEqual({ gender: 1, calque: 1, placeholder: 0 });
    expect(report.byBucket.player_speaks).toEqual({ lines: 2, defects: 1, rate: 0.5 });
    expect(report.byBucket.not_dialogue).toEqual({ lines: 1, defects: 1, rate: 1 });
  });

  it('counts a line with several defects once towards the rate', () => {
    const report = buildEvalReport([
      line({ source: "I did it, didn't I?", translation: 'Я зробив це, чи не так?' }),
    ]);
    expect(report.defects.length).toBe(2);
    expect(report.byBucket.player_speaks).toEqual({ lines: 1, defects: 1, rate: 1 });
  });

  it('leaves an empty bucket at zero rather than dividing by zero', () => {
    const report = buildEvalReport([]);
    expect(report.lines).toBe(0);
    expect(report.byBucket.known_gender.rate).toBe(0);
  });
});

describe('formatEvalReport', () => {
  it('shows the movement against a baseline, with its sign', () => {
    const before = buildEvalReport([line({ translation: 'Я подбав про них.' })]);
    const after = buildEvalReport([line()]);

    expect(formatEvalReport(after, before)).toContain('-100.00pp');
    expect(formatEvalReport(before, after)).toContain('+100.00pp');
  });

  it('omits the delta column when there is nothing to compare against', () => {
    expect(formatEvalReport(buildEvalReport([line()]))).not.toContain('pp');
  });
});
