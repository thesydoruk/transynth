/**
 * Starfield NPC_, VTYP, QUST, DLBR and DIAL records, built byte for byte after
 * xEdit's `wbDefinitionsSF1.pas`, read with the Starfield record layout — and
 * the same bytes read with the Fallout 4 one, to show what the layout changes.
 */
import { describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import { EspActorExtractor } from '../EspActorExtractor';
import { EspDialogStructureExtractor } from '../EspDialogStructureExtractor';
import { component, plugin, record, struct, u32, u8, zstring } from './pluginBytes';

/** Starfield ACBS: flags u32, XP s16, level u16, min/max u16, disposition s16, template u16. */
const acbs = (flags: number): Buffer =>
  struct('ACBS', 16, (data) => {
    data.writeUInt32LE(flags, 0);
    data.writeUInt16LE(1, 6);
  });

/** An animation-graph component: its `DNAM` / `BNAM` strings reuse record signatures. */
const animationGraph = (): Buffer[] =>
  component('BGSAnimationGraph_Component', [
    zstring('ANAM', 'Root'),
    zstring('BNAM', 'Rig'),
    zstring('DNAM', 'bits.txt'),
  ]);

const actorPlugin = (): Buffer =>
  plugin([
    record('NPC_', 0x0000a001, [
      zstring('EDID', 'Andreja'),
      ...component('BGSKeywordForm_Component', []),
      acbs(0x00000001 | 0x00000020),
      u32('VTCK', 0x0000b001),
      u32('RNAM', 0x00003cd5),
      zstring('FULL', 'Andreja'),
    ]),
    record('NPC_', 0x0000a002, [
      zstring('EDID', 'SamCoe'),
      acbs(0x00000020),
      u32('VTCK', 0x0000b002),
      zstring('FULL', 'Sam Coe'),
    ]),
    record('VTYP', 0x0000b001, [
      zstring('EDID', 'NPCFAndreja'),
      ...animationGraph(),
      u8('DNAM', 0x02),
      u8('PNAM', 2),
    ]),
    // A male voice whose component `DNAM` string starts with 'b' (0x62, bit 1 set).
    record('VTYP', 0x0000b002, [zstring('EDID', 'NPCMSamCoe'), ...animationGraph(), u8('DNAM', 0)]),
  ]);

describe('EspActorExtractor on Starfield records', () => {
  it('reads sex from ACBS, the voice type from VTCK, and the VTYP Female flag', () => {
    const index = new EspActorExtractor(
      actorPlugin(),
      false,
      STARFIELD_RECORD_LAYOUT,
    ).extractActorIndex();

    expect(index.actors).toEqual([
      {
        formId: '0000A001',
        edid: 'Andreja',
        isFemale: true,
        voiceTypeFormId: '0000B001',
        nameLStringId: null,
        nameText: 'Andreja',
      },
      {
        formId: '0000A002',
        edid: 'SamCoe',
        isFemale: false,
        voiceTypeFormId: '0000B002',
        nameLStringId: null,
        nameText: 'Sam Coe',
      },
    ]);
    expect(index.voiceTypes).toEqual([
      { formId: '0000B001', edid: 'NPCFAndreja', isFemale: true },
      { formId: '0000B002', edid: 'NPCMSamCoe', isFemale: false },
    ]);
  });

  it('finds the voice type with the default layout too: VTCK is the same in every title', () => {
    const index = new EspActorExtractor(actorPlugin(), false).extractActorIndex();
    expect(index.actors.map((actor) => actor.voiceTypeFormId)).toEqual(['0000B001', '0000B002']);
  });

  it('reads a component string as the voice flag only without the brackets', () => {
    const vtyp = record('VTYP', 0x0000b003, [
      zstring('EDID', 'NPCMOnlyComponent'),
      ...animationGraph(),
    ]);
    const read = (layout?: typeof STARFIELD_RECORD_LAYOUT) =>
      new EspActorExtractor(plugin([vtyp]), false, layout).extractActorIndex().voiceTypes[0]!
        .isFemale;

    expect(read(STARFIELD_RECORD_LAYOUT)).toBeNull();
    expect(read()).toBe(true);
  });
});

describe('EspDialogStructureExtractor on Starfield records', () => {
  const structurePlugin = (): Buffer =>
    plugin([
      record('QUST', 0x0000c001, [
        zstring('EDID', 'MQ101'),
        ...component('BGSAnimationGraph_Component', [zstring('ANAM', 'x')]),
        zstring('FULL', 'One Small Step'),
        // INDX: stage u16, flags u8, unused u8 — same as Fallout 4.
        struct('INDX', 4, (data) => data.writeUInt16LE(10, 0)),
        struct('INDX', 4, (data) => {
          data.writeUInt16LE(20, 0);
          data.writeUInt8(0x02, 2); // Run On Start
        }),
      ]),
      record('DLBR', 0x0000c002, [
        zstring('EDID', 'MQ101Branch'),
        u32('QNAM', 0x0000c001),
        u32('TNAM', 0),
        u32('DNAM', 1),
        u32('SNAM', 0x0000c003),
      ]),
      record('DIAL', 0x0000c003, [
        zstring('EDID', 'MQ101Topic'),
        ...animationGraph(),
        struct('PNAM', 4, (data) => data.writeFloatLE(50, 0)),
        u32('BNAM', 0x0000c002),
        u32('QNAM', 0x0000c001),
        struct('DATA', 4, (data) => data.writeUInt8(0, 1)),
        u32('SNAM', 0),
        u32('TIFC', 0),
      ]),
      // A DIAL with no branch: the component's 4-byte `BNAM` string must not pass for one.
      record('DIAL', 0x0000c004, [
        zstring('EDID', 'MQ101Hello'),
        ...animationGraph(),
        u32('QNAM', 0x0000c001),
      ]),
    ]);

  it('reads quests, branches and DIAL ownership', () => {
    const extracted = new EspDialogStructureExtractor(
      structurePlugin(),
      false,
      STARFIELD_RECORD_LAYOUT,
    ).extract();

    expect(extracted.quests).toEqual([
      { formId: '0000C001', edid: 'MQ101', name: 'One Small Step', stages: [10, 20] },
    ]);
    expect(extracted.branches).toEqual([
      {
        formId: '0000C002',
        edid: 'MQ101Branch',
        questFormId: '0000C001',
        startTopicFormId: '0000C003',
      },
    ]);
    expect(extracted.dialOwnership).toEqual([
      { formId: '0000C003', questFormId: '0000C001', branchFormId: '0000C002' },
      { formId: '0000C004', questFormId: '0000C001', branchFormId: null },
    ]);
  });

  it('mistakes a component string for a branch without the brackets', () => {
    const extracted = new EspDialogStructureExtractor(structurePlugin(), false).extract();
    // 'Rig\0' read as a little-endian FormID.
    expect(extracted.dialOwnership[1]!.branchFormId).toBe('00676952');
    // A flagged stage is read in every layout: the stage is the leading uint16.
    expect(extracted.quests[0]!.stages).toEqual([10, 20]);
  });
});
