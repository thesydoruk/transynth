import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isVideoManifestPath,
  listVideoManifests,
  parseVideoManifest,
  readVideoManifest,
  videoManifestName,
} from '../manifest';

const sha1 = 'a'.repeat(40);

describe('video manifest', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-manifest-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('names the manifest after the video and recognises it', () => {
    expect(videoManifestName('Intro_ru.bk2')).toBe('Intro_ru.bk2.video.json');
    expect(isVideoManifestPath('Video/Intro_ru.bk2.video.json')).toBe(true);
    expect(isVideoManifestPath('Video/Intro_ru.bk2')).toBe(false);
  });

  it('parses what the agent writes and refuses what it would not', () => {
    expect(
      parseVideoManifest({
        fileName: 'Intro_ru.bk2',
        byteSize: 366088784,
        sha1: sha1.toUpperCase(),
        durationS: 164.5,
        trackIds: [1, 0, -1, 'x'],
        sourceTrackId: 0,
        agentKey: 'pc',
      }),
    ).toEqual({
      fileName: 'Intro_ru.bk2',
      byteSize: 366088784,
      sha1,
      durationS: 164.5,
      trackIds: [1, 0],
      sourceTrackId: 0,
      agentKey: 'pc',
    });
    expect(parseVideoManifest({ fileName: 'Video/Intro.bk2', sha1 })).toBeNull();
    expect(parseVideoManifest({ fileName: 'Intro.bk2', sha1: 'nope' })).toBeNull();
    expect(parseVideoManifest(null)).toBeNull();
    expect(parseVideoManifest({ fileName: 'Intro.bk2', sha1 })).toEqual({
      fileName: 'Intro.bk2',
      byteSize: 0,
      sha1,
      durationS: null,
      trackIds: [],
      sourceTrackId: null,
    });
  });

  it('lists the manifests of a mod folder, laid out like Data or with Data', () => {
    const write = (rel: string, body: unknown) => {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(body));
    };
    write('Video/Intro_ru.bk2.video.json', { fileName: 'Intro_ru.bk2', sha1 });
    write('Data/Video/LUCK.bk2.video.json', { fileName: 'LUCK.bk2', sha1 });
    write('Video/notes.json', {});
    const found = listVideoManifests(root, 'Data/Video').map((f) => path.relative(root, f));
    expect(found.map((f) => f.replace(/\\/g, '/')).sort()).toEqual([
      'Data/Video/LUCK.bk2.video.json',
      'Video/Intro_ru.bk2.video.json',
    ]);
    expect(readVideoManifest(path.join(root, 'Video/Intro_ru.bk2.video.json'))?.fileName).toBe(
      'Intro_ru.bk2',
    );
    expect(readVideoManifest(path.join(root, 'Video/notes.json'))).toBeNull();
    expect(listVideoManifests(path.join(root, 'nowhere'), 'Data/Video')).toEqual([]);
  });
});
