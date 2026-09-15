import { describe, expect, it } from '@jest/globals';
import { allGameIds, gamePlugin, isGameId, resolveGameId } from '../registry';
import { glossaryGameKey, qaRuleGameKey } from '../glossaryKey';

describe('resolveGameId', () => {
  it('keeps a registered id and falls back for anything else', () => {
    expect(resolveGameId('sse')).toBe('sse');
    expect(resolveGameId('SSE')).toBe('sse');
    expect(resolveGameId(undefined)).toBe('fo4');
    expect(resolveGameId('nope')).toBe('fo4');
  });

  it('recognises only registered ids', () => {
    expect(isGameId('disco')).toBe(true);
    expect(isGameId('nope')).toBe(false);
  });
});

describe('registered plugins', () => {
  it('registers every shipped game exactly once', () => {
    const ids = allGameIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle', 'disco']),
    );
  });

  it('gives every plugin the adapters the pipeline calls unconditionally', () => {
    for (const id of allGameIds()) {
      const plugin = gamePlugin(id);
      expect(plugin.id).toBe(id);
      expect(plugin.catalogue.id).toBe(id);
      expect(typeof plugin.import.ingest).toBe('function');
      expect(typeof plugin.export.collectLangpackEntries).toBe('function');
      expect(plugin.prompts.label.length).toBeGreaterThan(0);
      expect(plugin.editor.modes.length).toBeGreaterThan(0);
    }
  });

  it('leaves deployment unset for a game no mod manager deploys', () => {
    expect(gamePlugin('disco').deployment).toBeUndefined();
    expect(gamePlugin('fo4').deployment?.vortexId).toBe('fallout4');
  });
});

describe('storage keys', () => {
  it('stores Skyrim LE under the SSE glossary', () => {
    expect(glossaryGameKey('sle')).toBe('sse');
    expect(glossaryGameKey('sse')).toBe('sse');
  });

  it('keeps other games distinct', () => {
    expect(glossaryGameKey('fo4')).toBe('fo4');
    expect(glossaryGameKey('fo3')).toBe('fo3');
    expect(glossaryGameKey('disco')).toBe('disco');
  });

  it('shares the Fallout 4 QA rules with Fallout 76', () => {
    expect(qaRuleGameKey('fo76')).toBe('fo4');
    expect(qaRuleGameKey('fo4')).toBe('fo4');
  });
});
