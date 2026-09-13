import { describe, expect, it } from '@jest/globals';
import {
  buildMcmContexts,
  formatMcmStoredContext,
  groupMcmPairsForTranslate,
  mcmKeyFromRecordPath,
  parseMcmPairKey,
  resolveMcmLlmContext,
  truncateMcmContextValue,
} from '../mcmContext';

describe('parseMcmPairKey', () => {
  it('detects help suffixes', () => {
    expect(parseMcmPairKey('$SettingDifficulty_help')).toEqual({
      base: '$SettingDifficulty',
      role: 'help',
    });
    expect(parseMcmPairKey('$Range_desc')).toEqual({ base: '$Range', role: 'help' });
  });

  it('treats other keys as labels', () => {
    expect(parseMcmPairKey('$SettingDifficulty')).toEqual({
      base: '$SettingDifficulty',
      role: 'label',
    });
  });
});

describe('buildMcmContexts', () => {
  it('pairs label and help from the translation map', () => {
    const contexts = buildMcmContexts(
      new Map([
        ['$Range', 'Range'],
        ['$Range_help', 'Scan radius in meters.'],
      ]),
    );

    expect(contexts.get('$Range')).toBe('help=Scan radius in meters.');
    expect(contexts.get('$Range_help')).toBe('label=Range');
  });

  it('resolves $placeholder pairs from the translation map', () => {
    const contexts = buildMcmContexts(
      new Map([
        ['$EnableLabel', 'Enable'],
        ['$EnableHelp', 'Turn the mod on.'],
      ]),
      new Map([
        ['$EnableLabel', { type: 'switcher', help: '$EnableHelp' }],
        ['$EnableHelp', { type: 'switcher', label: '$EnableLabel' }],
      ]),
    );

    expect(contexts.get('$EnableLabel')).toBe('type=switcher; help=Turn the mod on.');
    expect(contexts.get('$EnableHelp')).toBe('type=switcher; label=Enable');
  });

  it('adds page title and config type without dumping unrelated strings', () => {
    const texts = new Map([
      ['$Page0_DisplayName', 'Advanced'],
      ['$Page0_slider_1', 'Value'],
      ['$Page0_slider_1_help', 'Adjust value.'],
      ['$Unrelated', 'Enable'],
    ]);
    const contexts = buildMcmContexts(
      texts,
      new Map([
        ['$Page0_slider_1', { page: 'Advanced', type: 'slider', help: 'Adjust value.' }],
        ['$Page0_slider_1_help', { page: 'Advanced', type: 'slider', label: 'Value' }],
      ]),
    );

    expect(contexts.get('$Page0_slider_1')).toBe('page=Advanced; type=slider; help=Adjust value.');
    expect(contexts.get('$Page0_slider_1_help')).toBe('page=Advanced; type=slider; label=Value');
    expect(contexts.get('$Unrelated')).toBeUndefined();
    expect(contexts.get('$Page0_DisplayName')).toBeUndefined();
  });
});

describe('resolveMcmLlmContext', () => {
  it('keeps stored import context', () => {
    expect(
      resolveMcmLlmContext(
        'page=Combat; type=switcher',
        '$Enable',
        new Map([['$Enable_help', 'On']]),
      ),
    ).toBe('page=Combat; type=switcher');
  });

  it('fills empty context from siblings', () => {
    expect(
      resolveMcmLlmContext(null, '$Enable', new Map([['$Enable_help', 'Turn the mod on.']])),
    ).toBe('help=Turn the mod on.');
  });
});

describe('groupMcmPairsForTranslate', () => {
  it('pulls a later help string next to its label', () => {
    const items = [
      { grup: 'MCM' as string | null, field: '$Range', stringId: 1 },
      { grup: 'INFO' as string | null, field: 'NAM1', stringId: 2 },
      { grup: 'MCM' as string | null, field: '$Other', stringId: 3 },
      { grup: 'MCM' as string | null, field: '$Range_help', stringId: 4 },
    ];

    expect(groupMcmPairsForTranslate(items).map((item) => item.stringId)).toEqual([1, 4, 2, 3]);
  });
});

describe('mcmKeyFromRecordPath', () => {
  it('reads the $key from an MCM record path', () => {
    expect(mcmKeyFromRecordPath('MCM\\$SettingDifficulty')).toBe('$SettingDifficulty');
    expect(mcmKeyFromRecordPath('INFO\\NAM1')).toBeNull();
  });
});

describe('truncateMcmContextValue', () => {
  it('ellipsis-truncates long help', () => {
    expect(truncateMcmContextValue('a'.repeat(200)).endsWith('…')).toBe(true);
    expect(truncateMcmContextValue('short')).toBe('short');
  });
});

describe('formatMcmStoredContext', () => {
  it('returns null when empty', () => {
    expect(formatMcmStoredContext({})).toBeNull();
  });
});
