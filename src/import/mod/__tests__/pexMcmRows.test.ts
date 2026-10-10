import { describe, expect, it } from '@jest/globals';
import { buildPexCsvRows } from '../pexStrings';
import { buildMcmImportRows } from '../mcmLocales';
import { parsePexStoredContext } from '../../../formats/pex/pexStoredContext';

type Bundle = Parameters<typeof buildPexCsvRows>[0] extends Map<string, infer B> ? B : never;
type Usage = Bundle['literals'][number]['usages'][number];

const messageBoxUsage: Usage = {
  objectName: 'WorkshopScript',
  stateName: '',
  functionName: 'OnActivate',
  kind: 'function',
  opcode: 'callstatic',
  usageHint: 'Debug.MessageBox',
  lineNumber: 3,
};

const bundle = (sourceFile: string, literals: string[], usages: Usage[] = []): Bundle => ({
  sourceFile,
  pexFile: `${sourceFile.replace(/\.psc$/, '')}.pex`,
  data: Buffer.alloc(0),
  literals: literals.map((text, literalIndex) => ({ text, literalIndex, usages })),
});

const PSC = [
  'Scriptname WorkshopScript extends ObjectReference',
  'Event OnActivate(ObjectReference akActionRef)',
  '  Debug.MessageBox("Choose your reward")',
  '  Debug.MessageBox("Only in the decompiled source")',
  '  Debug.Trace("internal state dump")',
  'EndEvent',
].join('\n');

describe('buildPexCsvRows', () => {
  it('turns each player-facing literal into one PEX row per script', () => {
    const rows = buildPexCsvRows(
      new Map([['WorkshopScript', bundle('WorkshopScript.psc', ['Choose your reward'])]]),
      new Map([['WorkshopScript', { headerSourceFile: 'WorkshopScript.psc', pscSource: PSC }]]),
    );

    expect(rows.map((row) => row.csvRow)).toContainEqual({
      FormID: '',
      Signature: 'PEX',
      Path: 'PEX\\WorkshopScript',
      PathSimplified: 'PEX\\WorkshopScript',
      Source: 'Choose your reward',
    });
  });

  it('adds literals that only the decompiled source shows, and drops debug-only ones', () => {
    const rows = buildPexCsvRows(
      new Map([['WorkshopScript', bundle('WorkshopScript.psc', ['Choose your reward'])]]),
      new Map([['WorkshopScript', { headerSourceFile: 'WorkshopScript.psc', pscSource: PSC }]]),
    );

    expect(rows.map((row) => row.csvRow.Source).sort()).toEqual([
      'Choose your reward',
      'Only in the decompiled source',
    ]);
  });

  it('stores where in the source the literal sits, when the source is known', () => {
    const [row] = buildPexCsvRows(
      new Map([['WorkshopScript', bundle('WorkshopScript.psc', ['Choose your reward'])]]),
      new Map([['WorkshopScript', { headerSourceFile: 'WorkshopScript.psc', pscSource: PSC }]]),
    );

    const stored = parsePexStoredContext(row!.context);
    expect(stored?.contextLines.map((line) => line.text).join('\n')).toContain(
      'Debug.MessageBox("Choose your reward")',
    );
  });

  it('falls back to the script name and literal index without a decompiled source', () => {
    const rows = buildPexCsvRows(
      new Map([
        ['WorkshopScript', bundle('WorkshopScript.psc', ['Choose your reward'], [messageBoxUsage])],
      ]),
      new Map(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.context).toContain('WorkshopScript.psc');
  });

  it('writes a repeated literal once per script, and once in each script that has it', () => {
    const rows = buildPexCsvRows(
      new Map([
        [
          'WorkshopScript',
          bundle(
            'WorkshopScript.psc',
            ['Choose your reward', 'Choose your reward'],
            [messageBoxUsage],
          ),
        ],
        ['OtherScript', bundle('OtherScript.psc', ['Choose your reward'], [messageBoxUsage])],
      ]),
      new Map(),
    );

    expect(rows.map((row) => row.csvRow.Path).sort()).toEqual([
      'PEX\\OtherScript',
      'PEX\\WorkshopScript',
    ]);
  });
});

describe('buildMcmImportRows', () => {
  it('turns every MCM key into one MCM row keyed by its path', () => {
    const rows = buildMcmImportRows(
      new Map([
        ['$SS2_Title', 'Sim Settlements 2'],
        ['$SS2_Enable', 'Enable the plot system'],
      ]),
    );

    expect(rows.map((row) => row.csvRow)).toEqual([
      {
        FormID: '',
        Signature: 'MCM',
        Path: 'MCM\\$SS2_Title',
        PathSimplified: 'MCM\\$SS2_Title',
        Source: 'Sim Settlements 2',
      },
      {
        FormID: '',
        Signature: 'MCM',
        Path: 'MCM\\$SS2_Enable',
        PathSimplified: 'MCM\\$SS2_Enable',
        Source: 'Enable the plot system',
      },
    ]);
  });
});
