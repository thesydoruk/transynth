import { describe, it, expect } from '@jest/globals';
import type { PexStringUsage } from '../pexUsage';
import {
  classifyPscQuotedLine,
  extractQuotedStringLiteralsFromPsc,
  findQuotedPscLinesForLiteral,
  isNaturalLanguagePexLiteral,
  isPexLiteralTranslatable,
  refineUnknownPscLine,
  resolvePexTranslatability,
} from '../pexTranslatableFilter';

const usage = (hint: string | null): PexStringUsage => ({
  objectName: 'TestScript',
  stateName: '',
  functionName: 'OnInit',
  kind: 'function',
  opcode: 'callstatic',
  usageHint: hint,
  lineNumber: 1,
});

describe('findQuotedPscLinesForLiteral', () => {
  it('finds quoted literals and ignores comments', () => {
    const psc = [
      'Function OnInit()',
      '  Debug.Trace("hello world") ; player text in comment only',
      '  string msg = "hello world"',
      'EndFunction',
    ].join('\n');

    const lines = findQuotedPscLinesForLiteral(psc, 'hello world');
    expect(lines.map((l) => l.lineNumber)).toEqual([2, 3]);
  });

  it('ignores unquoted identifier references', () => {
    const psc = 'string eventName = hello_world\n; hello world fallback';
    expect(findQuotedPscLinesForLiteral(psc, 'hello world')).toEqual([]);
  });
});

describe('extractQuotedStringLiteralsFromPsc', () => {
  it('collects quoted literals from PSC source', () => {
    const psc = [
      'Function Show()',
      '  MessageBox.Show("Continue")',
      '  Debug.Trace("internal only")',
      'EndFunction',
    ].join('\n');
    expect(extractQuotedStringLiteralsFromPsc(psc)).toEqual(['Continue', 'internal only']);
  });
});

describe('classifyPscQuotedLine', () => {
  it('marks Debug.Trace as debug', () => {
    expect(classifyPscQuotedLine('  Debug.Trace("state changed")')).toBe('debug');
  });

  it('marks MessageBox as player-facing', () => {
    expect(classifyPscQuotedLine('  MessageBox.Show("Pick a perk")')).toBe('player-facing');
  });

  it('marks RegisterForAnimationEvent as technical', () => {
    expect(classifyPscQuotedLine('  RegisterForAnimationEvent(self, "OpenDoor")')).toBe(
      'technical',
    );
  });
});

describe('refineUnknownPscLine', () => {
  it('downgrades comma-separated identifier lists to technical', () => {
    expect(
      refineUnknownPscLine(
        '  packages = "PackageA, PackageB, PackageC"',
        'PackageA, PackageB, PackageC',
      ),
    ).toBe('technical');
  });

  it('downgrades debug prefix concatenation to debug', () => {
    expect(refineUnknownPscLine('  string msg = "State: " + akActor', 'State: ')).toBe('debug');
  });
});

describe('isNaturalLanguagePexLiteral', () => {
  it('accepts short UI labels', () => {
    expect(isNaturalLanguagePexLiteral('Continue')).toBe(true);
  });
});

describe('isPexLiteralTranslatable', () => {
  it('excludes debug-only quoted literals in PSC', () => {
    const psc = 'Function OnInit()\n  Debug.Trace("internal state dump")\nEndFunction';
    expect(isPexLiteralTranslatable('internal state dump', [], psc)).toBe(false);
  });

  it('includes MessageBox literals in PSC', () => {
    const psc = 'Function Show()\n  MessageBox.Show("Choose your reward")\nEndFunction';
    expect(isPexLiteralTranslatable('Choose your reward', [], psc)).toBe(true);
  });

  it('includes single-word UI literals when quoted in player-facing calls', () => {
    const psc = 'Function Show()\n  MessageBox.Show("Continue")\nEndFunction';
    expect(isPexLiteralTranslatable('Continue', [], psc)).toBe(true);
  });

  it('includes Debug.Notification (mods use it for HUD text)', () => {
    const psc = 'Function OnInit()\n  Debug.Notification("Workshop ready")\nEndFunction';
    expect(isPexLiteralTranslatable('Workshop ready', [], psc)).toBe(true);
  });

  it('excludes literals with no quoted PSC match', () => {
    const psc = 'Scriptname Foo extends Quest\n; orphan table noise';
    expect(isPexLiteralTranslatable('orphan table noise', [], psc)).toBe(false);
  });

  it('includes unknown natural-language assignments in PSC', () => {
    const psc = 'string Property MyLabel auto\n  MyLabel = "Built workshop ready!"';
    expect(isPexLiteralTranslatable('Built workshop ready!', [], psc)).toBe(true);
  });

  it('excludes technical animation event names', () => {
    const psc = 'Function Init()\n  RegisterForAnimationEvent(self, "OpenDoor")\nEndFunction';
    expect(isPexLiteralTranslatable('OpenDoor', [], psc)).toBe(false);
  });

  it('falls back to bytecode and excludes debug-only usage', () => {
    expect(
      isPexLiteralTranslatable('trace me', [usage('Debug.Trace'), usage('Debug.TraceStack')], null),
    ).toBe(false);
  });

  it('falls back to bytecode and keeps non-debug usage', () => {
    expect(isPexLiteralTranslatable('Built workshop ready!', [usage(null)], null)).toBe(true);
  });

  it('rejects bytecode fallback when there are no usages', () => {
    expect(isPexLiteralTranslatable('Built workshop ready!', [], null)).toBe(false);
  });
});

describe('resolvePexTranslatability', () => {
  it('returns a reason for excluded literals', () => {
    const psc = 'Function Init()\n  packages = "PackageA, PackageB"\nEndFunction';
    const verdict = resolvePexTranslatability('PackageA, PackageB', [], psc);
    expect(verdict.include).toBe(false);
    expect(verdict.reason).toContain('technical');
  });
});
