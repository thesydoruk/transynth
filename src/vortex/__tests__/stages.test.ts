import { describe, expect, it } from '@jest/globals';
import {
  needsVortexFileInventory,
  resolveStageRange,
  serverStagesIn,
  splitVortexPipeline,
  vortexFanOutStagesIn,
  vortexRangeCrossesFanOut,
  vortexWorkerStages,
} from '../stages';

describe('vortex stages', () => {
  it('defaults to plan..export', () => {
    expect(resolveStageRange()).toEqual([
      'plan',
      'upload',
      'import',
      'carry',
      'tm',
      'llm',
      'verify',
      'skip',
      'gender',
      'voice',
      'export',
    ]);
  });

  it('accepts a single stage', () => {
    expect(resolveStageRange(undefined, undefined, 'tm')).toEqual(['tm']);
  });

  it('cuts a contiguous range', () => {
    expect(resolveStageRange('import', 'tm')).toEqual(['import', 'carry', 'tm']);
  });

  it('rejects a backward range and the retired install stage', () => {
    expect(() => resolveStageRange('llm', 'import')).toThrow(/empty/);
    expect(() => resolveStageRange(undefined, 'install')).toThrow(/Unknown/);
  });

  it('filters server stages', () => {
    expect(serverStagesIn(['plan', 'upload', 'import', 'export'])).toEqual(['import', 'export']);
  });

  it('does not hash the tree for TM-only', () => {
    expect(needsVortexFileInventory(['tm'])).toBe(false);
    expect(needsVortexFileInventory(['carry', 'tm'])).toBe(false);
    expect(needsVortexFileInventory(['import', 'tm'])).toBe(true);
  });

  it('keeps only in-process stages for one vortex-sync job', () => {
    expect(vortexWorkerStages(['import', 'carry', 'tm', 'llm', 'export'])).toEqual([
      'import',
      'carry',
      'export',
    ]);
    expect(vortexWorkerStages(['tm'])).toEqual([]);
    expect(vortexFanOutStagesIn(['carry', 'tm', 'verify', 'export'])).toEqual(['tm', 'verify']);
  });

  it('splits the CLI pipeline into before-TM, fan-out and export', () => {
    expect(splitVortexPipeline(['tm'])).toEqual({
      beforeTm: [],
      fanOut: ['tm'],
      wantsExport: false,
    });
    expect(splitVortexPipeline(resolveStageRange('import', 'export'))).toEqual({
      beforeTm: ['import', 'carry'],
      fanOut: ['tm', 'llm', 'verify', 'skip', 'gender', 'voice'],
      wantsExport: true,
    });
  });

  it('refuses a vortex-sync range that straddles the fan-out stages', () => {
    expect(vortexRangeCrossesFanOut(resolveStageRange('import', 'export'))).toBe(true);
    expect(vortexRangeCrossesFanOut(['import', 'carry'])).toBe(false);
    expect(vortexRangeCrossesFanOut(['export'])).toBe(false);
    expect(vortexRangeCrossesFanOut(['tm', 'llm'])).toBe(false);
  });
});
