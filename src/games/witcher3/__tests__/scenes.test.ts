import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { readBundleEntry, readBundleIndex } from '../bundles';
import { readCr2w } from '../cr2w';
import { collectW3SceneSpeakers, parseW3VoiceTagTable } from '../scenes';
import { buildBundle, sceneWith } from './fixtures';
import type { SpeakerGender } from '../../../dialog/gender';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3scenes-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bundles', () => {
  it('lists and reads stored and zlib entries', () => {
    const file = path.join(root, 'blob.bundle');
    fs.writeFileSync(
      file,
      buildBundle([
        { path: 'Quests/A.w2scene', data: Buffer.from('stored') },
        {
          path: 'gameplay/globals/scene_voice_tags.csv',
          data: Buffer.from('zipped'.repeat(20)),
          zip: true,
        },
      ]),
    );
    const index = readBundleIndex(file);
    expect(index.entries.map((e) => e.path)).toEqual([
      'quests/a.w2scene',
      'gameplay/globals/scene_voice_tags.csv',
    ]);
    const fd = fs.openSync(file, 'r');
    try {
      expect(readBundleEntry(fd, index.entries[0]!).toString()).toBe('stored');
      expect(readBundleEntry(fd, index.entries[1]!).toString()).toBe('zipped'.repeat(20));
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe('scene speakers', () => {
  it('reads a line’s speaker, addressee and string id', () => {
    const scene = sceneWith([{ id: 577145, tag: 'YENNEFER', to: 'GERALT' }]);
    const lines = readCr2w(scene).chunks.filter((c) => c.properties.has('dialogLine'));
    expect(lines[0]!.properties.get('voicetag')?.value).toBe('YENNEFER');
    expect(lines[0]!.properties.get('dialogLine')?.value).toBe(577145);
  });

  it('collects speakers and genders from bundles and loose files', () => {
    fs.mkdirSync(path.join(root, 'mods', 'modA', 'content'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'mods', 'modA', 'content', 'blob0.bundle'),
      buildBundle([
        {
          path: 'quests/q1.w2scene',
          data: sceneWith([{ id: 10, tag: 'GERALT', to: 'CIRILLA' }]),
          zip: true,
        },
        {
          path: 'gameplay/globals/scene_voice_tags.csv',
          data: Buffer.from(
            'Voicetag;Sex;Pitch;Template;Id\nGERALT;M;;;GRLT\nCIRILLA;F;;;CIRI\nMATHILDA;W;;;MTHL\n',
          ),
        },
      ]),
    );
    fs.mkdirSync(path.join(root, 'scenes'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scenes', 'q2.w2scene'),
      sceneWith([{ id: 20, tag: 'cirilla' }]),
    );

    const speakers = collectW3SceneSpeakers(root);
    expect(speakers.scenes).toBe(2);
    expect(speakers.lines.get(10)).toEqual({ speaker: 'GERALT', addressee: 'CIRILLA' });
    expect(speakers.lines.get(20)).toEqual({ speaker: 'CIRILLA', addressee: null });
    expect([...speakers.genders]).toEqual([
      ['GERALT', 'male'],
      ['CIRILLA', 'female'],
      ['MATHILDA', 'female'],
    ]);
  });

  it('marks a voice tag with no sex as unknown', () => {
    const genders = new Map<string, SpeakerGender>();
    parseW3VoiceTagTable('Voicetag;Sex;Pitch;Template;Id\nTOWER;;;;TOWR\n', genders);
    expect(genders.get('TOWER')).toBe('unknown');
  });
});
