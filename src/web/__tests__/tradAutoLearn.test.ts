/**
 * tradAutoLearn.test.ts — Unit tests for TradAuto rule learning (pattern discovery).
 *
 * Tests the prefix/suffix helpers and the core `discoverPatterns()` function
 * using mock DB results.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { commonPrefix, commonSuffix, discoverPatterns } from '../tradAutoLearn.js';

describe('commonPrefix', () => {
  it('returns common prefix trimmed to word boundary', () => {
    expect(commonPrefix('Iron Sword', 'Iron Dagger')).toBe('Iron ');
  });

  it('returns empty string when no common whole word', () => {
    expect(commonPrefix('Abc', 'Axyz')).toBe('');
  });

  it('handles multi-word prefix', () => {
    expect(commonPrefix('The Iron Sword', 'The Iron Dagger')).toBe('The Iron ');
  });

  it('returns empty for completely different strings', () => {
    expect(commonPrefix('Sword', 'Dagger')).toBe('');
  });

  it('returns empty when first char differs', () => {
    expect(commonPrefix('Alpha', 'Beta')).toBe('');
  });

  it('trims partial word matches', () => {
    expect(commonPrefix('Improved Iron', 'Improvised Steel')).toBe('');
  });
});

describe('commonSuffix', () => {
  it('returns common suffix trimmed to word boundary', () => {
    expect(commonSuffix('Iron Ingot', 'Steel Ingot')).toBe(' Ingot');
  });

  it('returns empty when no common suffix', () => {
    expect(commonSuffix('Sword', 'Dagger')).toBe('');
  });

  it('returns empty for partial word suffix', () => {
    expect(commonSuffix('Lord', 'Word')).toBe('');
  });

  it('handles multi-word suffix', () => {
    expect(commonSuffix('Great Iron Ingot', 'Rare Iron Ingot')).toBe(' Iron Ingot');
  });

  it('returns empty for no overlap at all', () => {
    expect(commonSuffix('Alpha', 'Beta')).toBe('');
  });
});

const mockDb = (
  pairs: Array<{ source: string; target: string; signature: string | null; path: string | null }>,
  existingRules: Array<{ pattern: string; replacement: string; signature: string | null; path: string | null }> = [],
) => ({
  query: ((sql: string) => {
    if (sql.includes('tradauto_rules')) {
      return { rows: existingRules };
    }
    return { rows: pairs };
  }) as unknown,
});

describe('discoverPatterns', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('discovers prefix pattern from translation pairs', async () => {
    const db = mockDb([
      { source: 'Iron Sword', target: 'Залізний Меч', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Dagger', target: 'Залізний Кинджал', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Mace', target: 'Залізний Булава', signature: 'WEAP', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 2 });

    expect(result.length).toBeGreaterThan(0);
    const candidate = result.find((c) => c.pattern === 'Iron %VAR1%');
    expect(candidate).toBeDefined();
    expect(candidate!.replacement).toBe('Залізний %VAR1%');
    expect(candidate!.signature).toBe('WEAP');
    expect(candidate!.path).toBe('FULL');
    expect(candidate!.occurrences).toBe(3);
  });

  it('discovers prefix+suffix pattern', async () => {
    const db = mockDb([
      { source: 'Refined Iron Ingot', target: 'Зливок очищеного заліза', signature: 'MISC', path: 'FULL' },
      { source: 'Refined Steel Ingot', target: 'Зливок очищеної сталі', signature: 'MISC', path: 'FULL' },
      { source: 'Refined Gold Ingot', target: 'Зливок очищеного золота', signature: 'MISC', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 2 });

    const candidate = result.find((c) => c.pattern === 'Refined %VAR1% Ingot');
    expect(candidate).toBeDefined();
    expect(candidate!.replacement).toBe('Зливок %VAR1%');
    expect(candidate!.occurrences).toBe(3);
  });

  it('filters out candidates below minOccurrences threshold', async () => {
    const db = mockDb([
      { source: 'Iron Sword', target: 'Залізний Меч', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Dagger', target: 'Залізний Кинджал', signature: 'WEAP', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 3 });
    expect(result).toHaveLength(0);
  });

  it('skips candidates that already exist as active rules', async () => {
    const db = mockDb(
      [
        { source: 'Iron Sword', target: 'Залізний Меч', signature: 'WEAP', path: 'FULL' },
        { source: 'Iron Dagger', target: 'Залізний Кинджал', signature: 'WEAP', path: 'FULL' },
        { source: 'Iron Mace', target: 'Залізний Булава', signature: 'WEAP', path: 'FULL' },
      ],
      [{ pattern: 'Iron %VAR1%', replacement: 'Залізний %VAR1%', signature: 'WEAP', path: 'FULL' }],
    );

    const result = await discoverPatterns(db as never, { minOccurrences: 2 });

    const candidate = result.find((c) => c.pattern === 'Iron %VAR1%');
    expect(candidate).toBeUndefined();
  });

  it('skips groups below minOccurrences', async () => {
    const db = mockDb([
      { source: 'Iron Sword', target: 'Залізний Меч', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Dagger', target: 'Залізний Кинджал', signature: 'WEAP', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 3 });
    expect(result).toHaveLength(0);
  });

  it('provides example pairs with candidates', async () => {
    const db = mockDb([
      { source: 'Iron Sword', target: 'Залізний Меч', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Dagger', target: 'Залізний Кинджал', signature: 'WEAP', path: 'FULL' },
      { source: 'Iron Mace', target: 'Залізний Булава', signature: 'WEAP', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 2 });
    const candidate = result.find((c) => c.pattern === 'Iron %VAR1%');

    expect(candidate).toBeDefined();
    expect(candidate!.examples.length).toBeGreaterThanOrEqual(2);
    expect(candidate!.examples[0]).toHaveProperty('source');
    expect(candidate!.examples[0]).toHaveProperty('target');
  });

  it('returns empty array when DB has no translation pairs', async () => {
    const db = mockDb([]);

    const result = await discoverPatterns(db as never);
    expect(result).toHaveLength(0);
  });

  it('rejects trivially short fixed portions', async () => {
    const db = mockDb([
      { source: 'A Sword', target: 'X Меч', signature: 'WEAP', path: 'FULL' },
      { source: 'A Dagger', target: 'X Кинджал', signature: 'WEAP', path: 'FULL' },
      { source: 'A Mace', target: 'X Булава', signature: 'WEAP', path: 'FULL' },
    ]);

    const result = await discoverPatterns(db as never, { minOccurrences: 2 });
    const trivial = result.find((c) => c.pattern === 'A %VAR1%');
    expect(trivial).toBeUndefined();
  });

  it('respects the limit option', async () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      source: `Iron Weapon${i}`,
      target: `Залізна Зброя${i}`,
      signature: 'WEAP',
      path: 'FULL',
    }));
    const db = mockDb(pairs);

    const result = await discoverPatterns(db as never, { minOccurrences: 2, limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });
});