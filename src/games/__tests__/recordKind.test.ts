/**
 * What each game calls the handful of record kinds shared code cares about.
 *
 * These were Bethesda record signatures written into modules that run for every
 * game — `grup === 'TERM'`, `signature === 'PEX'`, `ctx.grup !== 'RACE'`. None
 * of them is true of a `.po` catalogue, so Disco silently took the other branch
 * every time.
 */
import { describe, expect, it } from '@jest/globals';
import { allGamePlugins, gamePlugin } from '../registry';

const kind = (game: string, grup: string | null, field?: string | null) =>
  gamePlugin(game).text.recordKind(grup, field);

describe('Creation Engine record kinds', () => {
  it('names the kinds shared checks used to spell out as signatures', () => {
    expect(kind('fo4', 'SCPT')).toBe('script_source');
    expect(kind('fo4', 'INFO', 'SCTX')).toBe('script_source');
    expect(kind('fo4', 'PEX')).toBe('compiled_script');
    expect(kind('fo4', 'MCM')).toBe('settings_menu');
    expect(kind('fo4', 'RACE', 'FMRN')).toBe('face_morph');
    expect(kind('fo4', 'TERM')).toBe('prose');
  });

  it('counts notes and books as unspoken narration too', () => {
    expect(kind('fo4', 'BOOK')).toBe('prose');
    expect(kind('fo4', 'NOTE')).toBe('prose');
  });

  it('leaves a RACE record that is not a morph slider alone', () => {
    // Only the morph subrecords are excused from the glossary; the race's own
    // name is a term like any other.
    expect(kind('fo4', 'RACE', 'FULL')).toBe('other');
    expect(kind('fo4', 'RACE')).toBe('other');
  });

  it('is one vocabulary for every title, not a Fallout 4 table', () => {
    for (const game of ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle']) {
      expect(kind(game, 'TERM')).toBe('prose');
      expect(kind(game, 'PEX')).toBe('compiled_script');
    }
  });

  it('reads a signature however it is cased or padded', () => {
    expect(kind('fo4', ' term ')).toBe('prose');
    expect(kind('fo4', 'pex')).toBe('compiled_script');
  });

  it('says nothing about a record it does not recognise', () => {
    expect(kind('fo4', 'WEAP')).toBe('other');
    expect(kind('fo4', null)).toBe('other');
  });
});

describe('Disco Elysium record kinds', () => {
  it('has none of them — a .po catalogue is text and nothing else', () => {
    for (const grup of ['PO', 'DLG', 'GEN', 'FX', 'TERM', 'PEX', 'MCM']) {
      expect(kind('disco', grup)).toBe('other');
    }
  });
});

describe('every game', () => {
  it('answers, so shared code never has to guess', () => {
    for (const plugin of allGamePlugins()) {
      expect(typeof plugin.text.recordKind).toBe('function');
      expect(plugin.text.recordKind(null)).toBe('other');
    }
  });
});
