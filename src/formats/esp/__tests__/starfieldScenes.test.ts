/**
 * Starfield SCEN actions, built after xEdit's `wbDefinitionsSF1.pas`: type 5 is
 * Radio (Fallout 4's NPC Response), player-dialogue choices name their topics
 * in `ESCE` / `ESCS`, a start-scene action names its scene in `LCEP` or
 * `STSC`, and types 6–10 (move, camera, FX, animation, timeline) are new.
 */
import { describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import { EspSceneExtractor } from '../EspSceneExtractor';
import { f32, i32, plugin, record, sub, u16, u32, zstring } from './pluginBytes';

/** Common action head: ANAM type, NAM0 name, ALID, INAM, FNAM, SNAM start, ENAM end. */
const action = (type: number, alias: number, start: number, end: number, body: Buffer[]) => [
  u16('ANAM', type),
  zstring('NAM0', ''),
  i32('ALID', alias),
  u32('INAM', type + 1),
  u32('FNAM', 0),
  u32('SNAM', start),
  u32('ENAM', end),
  ...body,
  sub('ANAM'),
];

const headTracking = (): Buffer[] => [sub('HNAM'), sub('FNAM'), sub('PNAM'), sub('HNAM')];

const starfieldScene = (): Buffer =>
  record('SCEN', 0x0000d001, [
    zstring('EDID', 'MQ101_Scene'),
    u32('FNAM', 0),
    // One phase.
    sub('HNAM'),
    zstring('NAM0', ''),
    sub('NEXT'),
    sub('NEXT'),
    u32('WNAM', 350),
    sub('HNAM'),
    // One actor.
    i32('ALID', 1),
    u32('LNAM', 0),
    u32('DNAM', 26),
    ...action(0, 1, 0, 0, [
      u32('DATA', 0x0000e001),
      f32('DMAX', 0),
      f32('DMIN', 0),
      ...headTracking(),
    ]),
    ...action(3, 0, 1, 1, [
      ...headTracking(),
      i32('DTGT', 1),
      u32('ESCE', 0x0000e002),
      u32('PPST', 0x0000f001),
      u32('PAPI', 0),
      u32('ESCS', 0x0000e003),
      u32('ESCE', 0x0000e004),
      u32('ESCS', 0x0000e005),
    ]),
    ...action(2, -1, 2, 2, [f32('SNAM', 4), f32('TNAM', 2)]),
    ...action(4, -1, 3, 3, [u32('STSC', 0x0000d002), u16('INTT', 0), sub('HTID')]),
    ...action(5, 1, 4, 4, [u32('DATA', 0x0000e006)]),
    // Move and timeline: no counterpart, must be dropped, not misread.
    ...action(6, 1, 5, 5, [i32('ALLA', 1), u32('REPL', 0x14), f32('HNAM', 1)]),
    ...action(10, 1, 6, 6, [u32('TNAM', 3), f32('SNAM', 1.5)]),
    u32('PNAM', 0x0000c001),
    u32('INAM', 7),
  ]);

describe('EspSceneExtractor on Starfield records', () => {
  it('maps Starfield action types and their topic and scene slots', () => {
    const [scene] = new EspSceneExtractor(
      plugin([starfieldScene()]),
      STARFIELD_RECORD_LAYOUT,
    ).extractScenes();

    expect(scene!.questFormId).toBe('0000C001');
    expect(
      scene!.actions.map((a) => [a.actionType, a.startPhase, a.topicFormId, a.topicFormIds]),
    ).toEqual([
      ['dialogue', 0, '0000E001', ['0000E001']],
      ['player_dialogue', 1, '0000E002', ['0000E002', '0000E003', '0000E004', '0000E005']],
      ['timer', 2, null, []],
      ['start_scene', 3, null, []],
      ['radio', 4, '0000E006', ['0000E006']],
    ]);
    const timer = scene!.actions[2]!;
    expect([timer.timerMinSeconds, timer.timerMaxSeconds]).toEqual([2, 4]);
    expect(scene!.actions[3]!.startSceneFormId).toBe('0000D002');
  });

  it("tells the player's side of a choice (ESCE) from the NPC's (ESCS)", () => {
    const [scene] = new EspSceneExtractor(
      plugin([starfieldScene()]),
      STARFIELD_RECORD_LAYOUT,
    ).extractScenes();
    const [dialogue, choice, timer] = scene!.actions;
    expect(choice!.playerTopicFormIds).toEqual(['0000E002', '0000E004']);
    expect(choice!.aliasId).toBe(0);
    // Only actions with a player side carry the field at all.
    expect(dialogue).not.toHaveProperty('playerTopicFormIds');
    expect(timer).not.toHaveProperty('playerTopicFormIds');
  });

  it('accepts LCEP for the started scene too', () => {
    const scene = record('SCEN', 0x0000d003, [
      ...action(4, -1, 0, 0, [u32('LCEP', 0x0000d004), u16('INTT', 0)]),
      u32('PNAM', 0x0000c001),
    ]);
    const [extracted] = new EspSceneExtractor(
      plugin([scene]),
      STARFIELD_RECORD_LAYOUT,
    ).extractScenes();
    expect(extracted!.actions[0]!.startSceneFormId).toBe('0000D004');
  });

  it('misreads radio as an NPC response with the Fallout 4 layout', () => {
    const [scene] = new EspSceneExtractor(plugin([starfieldScene()])).extractScenes();
    expect(scene!.actions.map((a) => a.actionType)).toEqual([
      'dialogue',
      'player_dialogue',
      'timer',
      'start_scene',
      'npc_response',
      'radio',
    ]);
    expect(scene!.actions.some((a) => 'playerTopicFormIds' in a)).toBe(false);
  });
});
