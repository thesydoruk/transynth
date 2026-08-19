import { EspSceneExtractor } from '../EspSceneExtractor';
import { sceneHasTimingConstraint } from '../scene/actionTypes';

const buildPlugin = (records: Buffer[]): Buffer => {
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  tes4.writeUInt32LE(0, 4);
  return Buffer.concat([tes4, ...records]);
};

const buildRecord = (sig: string, formId: number, subrecords: Buffer[]): Buffer => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, data]);
};

const zstring = (sig: string, text: string): Buffer => {
  const payload = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const u16 = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(2, 4);
  const data = Buffer.alloc(2);
  data.writeUInt16LE(value, 0);
  return Buffer.concat([header, data]);
};

const u32 = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(4, 4);
  const data = Buffer.alloc(4);
  data.writeUInt32LE(value >>> 0, 0);
  return Buffer.concat([header, data]);
};

const i32 = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(4, 4);
  const data = Buffer.alloc(4);
  data.writeInt32LE(value, 0);
  return Buffer.concat([header, data]);
};

const f32 = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(4, 4);
  const data = Buffer.alloc(4);
  data.writeFloatLE(value, 0);
  return Buffer.concat([header, data]);
};

const empty = (sig: string): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(0, 4);
  return header;
};

const action = (type: number, parts: Buffer[]): Buffer[] => [
  u16('ANAM', type),
  ...parts,
  empty('ANAM'),
];

describe('EspSceneExtractor', () => {
  it('keeps dialogue, timer, player-dialogue, package, and start-scene actions', () => {
    const scene = buildRecord('SCEN', 0x00000abc, [
      zstring('EDID', 'MQ101Scene'),
      u32('PNAM', 0x00000aaa),
      ...action(0, [
        i32('ALID', 1),
        u32('SNAM', 0),
        u32('ENAM', 0),
        u32('DATA', 0x00000d01),
        u32('HTID', 0x00000bad),
      ]),
      ...action(2, [u32('SNAM', 0), u32('ENAM', 1), f32('SNAM', 12.5), f32('TNAM', 8)]),
      ...action(3, [i32('ALID', -2), u32('SNAM', 1), u32('ENAM', 1), u32('PTOP', 0x00000d02)]),
      ...action(1, [i32('ALID', 1), u32('SNAM', 0), u32('ENAM', 1)]),
      ...action(4, [u32('SNAM', 2), u32('ENAM', 2), u32('LCEP', 0x00000eee)]),
    ]);

    const [extracted] = new EspSceneExtractor(buildPlugin([scene])).extractScenes();
    expect(extracted?.formId).toBe('00000ABC');
    expect(extracted?.edid).toBe('MQ101Scene');
    expect(extracted?.questFormId).toBe('00000AAA');
    expect(extracted?.actions.map((a) => a.actionType)).toEqual([
      'dialogue',
      'timer',
      'package',
      'player_dialogue',
      'start_scene',
    ]);

    const dialogue = extracted?.actions.find((a) => a.actionType === 'dialogue');
    expect(dialogue?.topicFormId).toBe('00000D01');
    expect(dialogue?.topicFormIds).toEqual(['00000D01']);

    const timer = extracted?.actions.find((a) => a.actionType === 'timer');
    expect(timer?.startPhase).toBe(0);
    expect(timer?.endPhase).toBe(1);
    expect(timer?.timerMaxSeconds).toBeCloseTo(12.5);
    expect(timer?.timerMinSeconds).toBeCloseTo(8);

    const player = extracted?.actions.find((a) => a.actionType === 'player_dialogue');
    expect(player?.aliasId).toBe(-2);
    expect(player?.topicFormIds).toEqual(['00000D02']);

    const start = extracted?.actions.find((a) => a.actionType === 'start_scene');
    expect(start?.startSceneFormId).toBe('00000EEE');
    expect(sceneHasTimingConstraint(extracted?.actions ?? [])).toBe(true);
  });

  it('does not treat HTID as a topic and flags looping dialogue as timing-sensitive', () => {
    const scene = buildRecord('SCEN', 0x00000def, [
      zstring('EDID', 'LoopTalk'),
      ...action(0, [
        i32('ALID', 2),
        u32('SNAM', 0),
        u32('ENAM', 0),
        u32('DATA', 0x00000d03),
        u32('HTID', 0x00000bad),
        u32('FNAM', 0x00010000),
        f32('DMIN', 2),
        f32('DMAX', 6),
      ]),
    ]);

    const [extracted] = new EspSceneExtractor(buildPlugin([scene])).extractScenes();
    const dialogue = extracted?.actions[0];
    expect(dialogue?.topicFormIds).toEqual(['00000D03']);
    expect(dialogue?.loopMin).toBeCloseTo(2);
    expect(dialogue?.loopMax).toBeCloseTo(6);
    expect(sceneHasTimingConstraint(extracted?.actions ?? [])).toBe(true);
  });

  it('marks a linear dialogue-only scene as not timing-sensitive', () => {
    const scene = buildRecord('SCEN', 0x00000111, [
      zstring('EDID', 'Chat'),
      ...action(0, [i32('ALID', 1), u32('SNAM', 0), u32('ENAM', 0), u32('DATA', 0x00000d04)]),
      ...action(0, [i32('ALID', 1), u32('SNAM', 1), u32('ENAM', 1), u32('DATA', 0x00000d05)]),
    ]);

    const [extracted] = new EspSceneExtractor(buildPlugin([scene])).extractScenes();
    expect(extracted?.actions).toHaveLength(2);
    expect(sceneHasTimingConstraint(extracted?.actions ?? [])).toBe(false);
  });
});
