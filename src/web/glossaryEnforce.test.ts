/**
 * Unit tests for glossary enforcement helpers: escapeRegExp and termWordBoundaryRe.
 *
 * These pure-function tests validate that glossary term matching uses proper
 * word boundaries (\b) so that e.g. "iron" doesn't match inside "environment",
 * while still correctly matching standalone occurrences and multi-word terms.
 */
import { describe, it, expect } from 'vitest';
import { escapeRegExp, termWordBoundaryRe } from './queries.js';

// ── escapeRegExp ─────────────────────────────────────────────────────────────

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('foo.bar')).toBe('foo\\.bar');
    expect(escapeRegExp('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegExp('(test)')).toBe('\\(test\\)');
    expect(escapeRegExp('[0-9]')).toBe('\\[0-9\\]');
    expect(escapeRegExp('$100')).toBe('\\$100');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeRegExp('synth')).toBe('synth');
    expect(escapeRegExp('Brotherhood of Steel')).toBe('Brotherhood of Steel');
  });
});

// ── termWordBoundaryRe ───────────────────────────────────────────────────────

describe('termWordBoundaryRe', () => {
  it('matches the term as a standalone word', () => {
    const re = termWordBoundaryRe('iron');
    expect(re.test('Find the iron ingot.')).toBe(true);
    expect(re.test('Iron is heavy.')).toBe(true);  // case-insensitive
    expect(re.test('pure iron')).toBe(true);
  });

  it('does NOT match the term inside another word', () => {
    const re = termWordBoundaryRe('iron');
    expect(re.test('The environment is harsh.')).toBe(false);
    expect(re.test('He ironed his shirt.')).toBe(false);
    expect(re.test('This is ironic.')).toBe(false);
  });

  it('matches multi-word terms', () => {
    const re = termWordBoundaryRe('Brotherhood of Steel');
    expect(re.test('Join the Brotherhood of Steel today.')).toBe(true);
    expect(re.test('brotherhood of steel')).toBe(true);  // case-insensitive
  });

  it('does NOT match partial multi-word terms', () => {
    const re = termWordBoundaryRe('Brotherhood of Steel');
    expect(re.test('Brotherhood of the Steel heart.')).toBe(false);
    expect(re.test('Brotherhood')).toBe(false);
  });

  it('handles terms with regex metacharacters', () => {
    const re = termWordBoundaryRe('Pip-Boy');
    expect(re.test('Use the Pip-Boy to navigate.')).toBe(true);
    expect(re.test('pip-boy')).toBe(true);  // case-insensitive
  });

  it('matches at start and end of string', () => {
    const re = termWordBoundaryRe('Vault');
    expect(re.test('Vault 111')).toBe(true);
    expect(re.test('hidden Vault')).toBe(true);
    expect(re.test('Vault')).toBe(true);
  });

  it('does not match substring that spans a word boundary', () => {
    const re = termWordBoundaryRe('cap');
    expect(re.test('escape')).toBe(false);
    expect(re.test('capital')).toBe(false);
    expect(re.test('Grab a cap.')).toBe(true);
  });
});
