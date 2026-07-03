import { describe, it, expect } from '@jest/globals';
import {
  detectSkipHeuristic,
  partitionSkipAuditRows,
  stripPlaceholdersForSkipCheck,
} from '../skipTranslateHeuristics';

describe('stripPlaceholdersForSkipCheck', () => {
  it('removes game placeholders', () => {
    expect(stripPlaceholdersForSkipCheck('Hello ¤PH0¤ world')).toBe('Hello  world');
  });
});

describe('detectSkipHeuristic', () => {
  it('flags placeholder-only strings', () => {
    expect(detectSkipHeuristic('¤PH0¤')?.reason).toMatch(/placeholder/i);
  });

  it('flags numeric/symbol-only strings', () => {
    expect(detectSkipHeuristic('+15%')?.reason).toMatch(/no translatable letters/i);
    expect(detectSkipHeuristic('10/22/2077')?.reason).toMatch(/no translatable letters/i);
    expect(detectSkipHeuristic('->')?.reason).toMatch(/no translatable letters/i);
    expect(detectSkipHeuristic('=====')?.reason).toMatch(/no translatable letters/i);
  });

  it('flags markup-only strings (alias/token/img/font tags)', () => {
    expect(detectSkipHeuristic('<Alias.CurrentName=Location384>')?.reason).toMatch(/markup/i);
    expect(detectSkipHeuristic('<Token.Name=SettlementName>')?.reason).toMatch(/markup/i);
    expect(
      detectSkipHeuristic("<img src='img://Textures/SS2/Icons/x.dds' height='16' width='16'>")
        ?.reason,
    ).toMatch(/markup/i);
    expect(detectSkipHeuristic('<Alias=QuestVerb> <Alias=myLocation>')?.reason).toMatch(/markup/i);
  });

  it('flags markup wrapping only a number as no-letters', () => {
    expect(detectSkipHeuristic("<font face='$MAIN_Font' size='35'>82</font>")?.reason).toMatch(
      /no translatable letters/i,
    );
  });

  it('flags code-like source matching edid', () => {
    expect(detectSkipHeuristic('MyRecord01', { edid: 'MyRecord01' })?.reason).toMatch(/editor ID/i);
    expect(detectSkipHeuristic('CA_Event_PickLock', { edid: 'CA_Event_PickLock' })?.reason).toMatch(
      /editor ID/i,
    );
    expect(detectSkipHeuristic('BoSPSGreetings', { edid: 'BoSPSGreetings' })?.reason).toMatch(
      /editor ID/i,
    );
  });

  it('keeps plain names/words even when they equal the edid', () => {
    // Editor named the record after the visible name — still translatable.
    expect(detectSkipHeuristic('Minigun', { edid: 'Minigun' })).toBeNull();
    expect(detectSkipHeuristic('Patrick', { edid: 'Patrick', signature: 'NPC_' })).toBeNull();
    expect(detectSkipHeuristic('Caretaker', { edid: 'Caretaker', signature: 'NPC_' })).toBeNull();
  });

  it('flags short uppercase stat abbreviations', () => {
    expect(detectSkipHeuristic('AGI', { signature: 'AVIF' })?.reason).toMatch(/identifier|code/i);
  });

  it('keeps short NPC names/designations (name-bearing record)', () => {
    expect(detectSkipHeuristic('AJ', { signature: 'NPC_' })).toBeNull();
    expect(detectSkipHeuristic('TV', { signature: 'NPC_' })).toBeNull();
  });

  it('returns null for normal dialogue', () => {
    expect(detectSkipHeuristic('Hello, wanderer.')).toBeNull();
  });

  it('keeps prose that merely contains markup', () => {
    expect(detectSkipHeuristic('Help defend <Alias=myLocation>')).toBeNull();
  });

  it('keeps bracketed stage directions (player-facing tone tags)', () => {
    expect(detectSkipHeuristic('[Sarcasm]')).toBeNull();
    expect(detectSkipHeuristic('[Whispering]')).toBeNull();
  });

  it('keeps prose wrapped in angle brackets', () => {
    expect(detectSkipHeuristic('<User "Bergman" signed in>')).toBeNull();
  });

  it('flags MPS particle-system internal names', () => {
    expect(detectSkipHeuristic('MPSSmokeDustGeneric')?.reason).toMatch(/particle/i);
    expect(detectSkipHeuristic('MPSHeavyImpactSparks')?.reason).toMatch(/particle/i);
  });

  it('flags LightNode internal identifiers', () => {
    expect(detectSkipHeuristic('LightNodePrydwenSearchlight')?.reason).toMatch(/LightNode/i);
  });

  it('flags file paths', () => {
    expect(detectSkipHeuristic('Textures\\Effects\\Smoke.dds')?.reason).toMatch(/path/i);
  });

  it('flags non-player-facing record types (REFR, KYWD, ARMA, …)', () => {
    expect(detectSkipHeuristic('Some Label', { signature: 'REFR' })?.reason).toMatch(
      /not player-facing/i,
    );
    expect(detectSkipHeuristic('KeywordFoo', { signature: 'KYWD' })?.reason).toMatch(
      /not player-facing/i,
    );
    expect(detectSkipHeuristic('ArmorAddon', { signature: 'ARMA' })?.reason).toMatch(
      /not player-facing/i,
    );
    expect(detectSkipHeuristic('InheritNode', { signature: 'INNR' })?.reason).toMatch(
      /not player-facing/i,
    );
    expect(detectSkipHeuristic('ListOverride', { signature: 'LVLI' })?.reason).toMatch(
      /not player-facing/i,
    );
  });

  it('keeps real place names on ACTI even when grup is ACTI', () => {
    expect(
      detectSkipHeuristic('Somerville Place', {
        signature: 'ACTI',
        path: 'ACTI\\FULL',
        edid: 'SS2_PBP_SVSignL1',
      }),
    ).toBeNull();
  });

  it('partitionSkipAuditRows collects heuristic hits only', () => {
    const { heuristicHits } = partitionSkipAuditRows([
      { id: 1, source: 'MPSSmokeDustGeneric', signature: 'ACTI', path: 'ACTI\\FULL' },
      { id: 2, source: 'Somerville Place', signature: 'ACTI', path: 'ACTI\\FULL' },
      { id: 3, source: '+15%' },
    ]);
    expect(heuristicHits.has(1)).toBe(true);
    expect(heuristicHits.has(2)).toBe(false);
    expect(heuristicHits.has(3)).toBe(true);
  });
});
