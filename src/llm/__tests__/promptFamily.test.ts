import {
  partitionByPromptFamily,
  resolveBatchPromptFamily,
  resolveFo4PromptFamily,
  resolvePromptFamily,
} from '../promptFamily';

describe('resolveFo4PromptFamily', () => {
  it('maps INFO and dialog fields to dialog', () => {
    expect(resolveFo4PromptFamily('INFO', 'NAM1')).toBe('dialog');
    expect(resolveFo4PromptFamily('INFO', 'RNAM')).toBe('dialog');
    expect(resolveFo4PromptFamily('QUST', 'NAM1')).toBe('dialog');
  });

  it('maps authored and menu grups', () => {
    expect(resolveFo4PromptFamily('BOOK')).toBe('prose');
    expect(resolveFo4PromptFamily('NOTE')).toBe('prose');
    expect(resolveFo4PromptFamily('TERM')).toBe('prose');
    expect(resolveFo4PromptFamily('QUST', 'NNAM')).toBe('quest');
    expect(resolveFo4PromptFamily('MESG')).toBe('quest');
    expect(resolveFo4PromptFamily('DIAL')).toBe('quest');
    expect(resolveFo4PromptFamily('MCM')).toBe('mcm');
    expect(resolveFo4PromptFamily('RACE')).toBe('face');
  });

  it('defaults names and UI to item', () => {
    expect(resolveFo4PromptFamily('WEAP', 'FULL')).toBe('item');
    expect(resolveFo4PromptFamily('ARMO', 'DESC')).toBe('item');
    expect(resolveFo4PromptFamily('OMOD')).toBe('item');
  });
});

describe('resolvePromptFamily', () => {
  it('returns default outside FO4', () => {
    expect(resolvePromptFamily('sse', 'INFO', 'NAM1')).toBe('default');
    expect(resolvePromptFamily('fnv', 'BOOK')).toBe('default');
  });
});

describe('resolveBatchPromptFamily', () => {
  it('honors an explicit family', () => {
    expect(resolveBatchPromptFamily('fo4', [{ grup: 'INFO' }], 'item')).toBe('item');
  });

  it('keeps a homogeneous FO4 batch', () => {
    expect(
      resolveBatchPromptFamily('fo4', [
        { grup: 'INFO', field: 'NAM1' },
        { grup: 'INFO', field: 'RNAM' },
      ]),
    ).toBe('dialog');
  });

  it('falls back to item when a FO4 batch mixes families', () => {
    expect(resolveBatchPromptFamily('fo4', [{ grup: 'INFO' }, { grup: 'WEAP' }])).toBe('item');
  });
});

describe('partitionByPromptFamily', () => {
  it('splits a mixed FO4 page', () => {
    const buckets = partitionByPromptFamily('fo4', [
      { id: 1, grup: 'INFO', field: 'NAM1' },
      { id: 2, grup: 'WEAP', field: 'FULL' },
      { id: 3, grup: 'MCM' },
    ]);
    expect([...buckets.keys()].sort()).toEqual(['dialog', 'item', 'mcm']);
    expect(buckets.get('dialog')?.map((row) => row.id)).toEqual([1]);
    expect(buckets.get('item')?.map((row) => row.id)).toEqual([2]);
    expect(buckets.get('mcm')?.map((row) => row.id)).toEqual([3]);
  });
});
