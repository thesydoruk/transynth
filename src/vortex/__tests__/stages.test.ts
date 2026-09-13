import {
  needsVortexFileInventory,
  resolveStageRange,
  serverStagesIn,
  splitVortexPipeline,
  vortexRangeCrossesTm,
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
      'export',
    ]);
  });

  it('accepts a single stage', () => {
    expect(resolveStageRange(undefined, undefined, 'tm')).toEqual(['tm']);
  });

  it('cuts a contiguous range', () => {
    expect(resolveStageRange('import', 'tm')).toEqual(['import', 'carry', 'tm']);
  });

  it('rejects a backward range', () => {
    expect(() => resolveStageRange('llm', 'import')).toThrow(/empty/);
  });

  it('filters server stages', () => {
    expect(serverStagesIn(['plan', 'upload', 'import', 'export', 'install'])).toEqual([
      'import',
      'export',
    ]);
  });

  it('does not hash the tree for TM-only', () => {
    expect(needsVortexFileInventory(['tm'])).toBe(false);
    expect(needsVortexFileInventory(['carry', 'tm'])).toBe(false);
    expect(needsVortexFileInventory(['import', 'tm'])).toBe(true);
    expect(vortexWorkerStages(['import', 'carry', 'tm'])).toEqual(['import', 'carry']);
    expect(vortexWorkerStages(['tm'])).toEqual([]);
  });

  it('splits the pipeline around TM', () => {
    expect(splitVortexPipeline(['tm'])).toEqual({
      beforeTm: [],
      wantsTm: true,
      afterTm: [],
    });
    expect(splitVortexPipeline(['import', 'carry', 'tm', 'llm', 'export'])).toEqual({
      beforeTm: ['import', 'carry'],
      wantsTm: true,
      afterTm: ['llm', 'export'],
    });
    expect(splitVortexPipeline(['import', 'carry'])).toEqual({
      beforeTm: ['import', 'carry'],
      wantsTm: false,
      afterTm: [],
    });
    expect(vortexRangeCrossesTm(['import', 'carry', 'tm', 'llm'])).toBe(true);
    expect(vortexRangeCrossesTm(['import', 'tm'])).toBe(false);
    expect(vortexRangeCrossesTm(['tm', 'llm'])).toBe(false);
  });
});
