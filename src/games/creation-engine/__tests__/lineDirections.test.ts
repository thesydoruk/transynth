import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  grup,
  plugin,
  record,
  struct,
  sub,
  u32,
  zstring,
} from '../../../formats/esp/__tests__/pluginBytes';
import { _resetInfoVoiceResponseCacheForTests } from '../../../voice/infoResponseNumbers';
import { loadCreationEngineLineDirections } from '../voice/lineDirections';

const topic = (formId: number, category: number, subtype: string): Buffer =>
  record('DIAL', formId, [
    struct('DATA', 4, (d) => d.writeUInt8(category, 1)),
    sub('SNAM', Buffer.from(subtype, 'ascii')),
  ]);

const response = (number: number, stringId: number, note: string): Buffer[] => [
  struct('TRDA', 20, (d) => d.writeUInt32LE(number, 4)),
  u32('NAM1', stringId),
  zstring('NAM2', note),
];

describe('loadCreationEngineLineDirections', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-directions-'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, masters: string[], records: Buffer[]): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, plugin(records, 0, masters));
    return file;
  };

  it('keys every response by origin, line and number, with its topic and note', () => {
    const file = write(
      'Raiders.esp',
      ['Fallout4.esm'],
      [
        grup('DIAL', 0, [
          topic(0x01000d01, 3, 'FLEE'),
          grup(0x01000d01, 7, [
            record('INFO', 0x01000a01, [
              ...response(1, 11, 'quick shout as you flee'),
              ...response(102, 12, ''),
            ]),
            // An override of the master's line keeps the master as its origin.
            record('INFO', 0x00021b2a, response(1, 13, '')),
          ]),
          topic(0x01000d02, 7, 'HELO'),
          grup(0x01000d02, 7, [record('INFO', 0x01000a02, response(1, 14, 'friendly'))]),
          // Fallout4.esm files some hit topics under the category of ordinary talk.
          topic(0x01000d03, 0, 'HIT_'),
          grup(0x01000d03, 7, [record('INFO', 0x01000a03, response(1, 15, ''))]),
        ]),
      ],
    );

    expect(Object.fromEntries(loadCreationEngineLineDirections(file))).toEqual({
      'raiders.esp/000A01:1': { calmTopic: false, actorNote: 'quick shout as you flee' },
      'raiders.esp/000A01:102': { calmTopic: false, actorNote: null },
      'fallout4.esm/021B2A:1': { calmTopic: false, actorNote: null },
      'raiders.esp/000A02:1': { calmTopic: true, actorNote: 'friendly' },
      'raiders.esp/000A03:1': { calmTopic: false, actorNote: null },
    });
  });

  it('gives a line that replays another its own topic and the other line’s note', () => {
    const file = write(
      'Shared.esp',
      [],
      [
        grup('DIAL', 0, [
          topic(0x00000d01, 3, 'TAUT'),
          grup(0x00000d01, 7, [record('INFO', 0x00000a01, response(1, 11, 'Yelling.'))]),
          topic(0x00000d02, 2, 'SCEN'),
          grup(0x00000d02, 7, [record('INFO', 0x00000a02, [u32('DNAM', 0x00000a01)])]),
        ]),
      ],
    );

    const directions = loadCreationEngineLineDirections(file);
    expect(directions.get('shared.esp/000A01:1')).toEqual({
      calmTopic: false,
      actorNote: 'Yelling.',
    });
    expect(directions.get('shared.esp/000A02:1')).toEqual({
      calmTopic: true,
      actorNote: 'Yelling.',
    });
  });

  it('has nothing to say about a plugin it cannot read', () => {
    expect(loadCreationEngineLineDirections(path.join(dir, 'Missing.esp')).size).toBe(0);
  });
});
