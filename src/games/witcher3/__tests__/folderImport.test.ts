import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { planWitcher3FolderImport } from '../import/folder';
import { collectW3LanguageTables, parseW3RecordPath, w3RecordPath } from '../import/tables';
import { w3AppLocale, w3SlotForTargetLang } from '../packLayout';
import { encodeW3Strings } from '../w3strings';

let root: string;

const writeTable = (lang: string, texts: Record<number, string>, ...dirs: string[]): void => {
  const dir = path.join(root, ...dirs);
  fs.mkdirSync(dir, { recursive: true });
  const entries = Object.entries(texts).map(([id, text]) => ({ id: Number(id), keyHash: 0, text }));
  fs.writeFileSync(path.join(dir, `${lang}.w3strings`), encodeW3Strings(entries, lang));
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3folder-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const relPaths = (units: ReturnType<typeof planWitcher3FolderImport>): string[][] =>
  units.map((unit) => unit.files.map((file) => file.relPath).sort());

describe('planWitcher3FolderImport', () => {
  it('imports a game root as one mod and leaves its mods folder out', () => {
    writeTable('en', { 1: 'Hmm.' }, 'content', 'content0');
    writeTable('ua', { 1: 'Хм.' }, 'content', 'content0');
    writeTable('en', { 2: 'Toussaint' }, 'dlc', 'bob', 'content');
    writeTable('en', { 2110000000: 'Mods' }, 'mods', 'modFoo', 'content');

    const units = planWitcher3FolderImport(root, { perMod: false, langs: null });
    expect(units.map((unit) => unit.name)).toEqual(['The Witcher 3']);
    expect(relPaths(units)).toEqual([
      [
        'content/content0/en.w3strings',
        'content/content0/ua.w3strings',
        'dlc/bob/content/en.w3strings',
      ],
    ]);
  });

  it('filters languages', () => {
    writeTable('en', { 1: 'Hmm.' }, 'content', 'content0');
    writeTable('pl', { 1: 'Hmm.' }, 'content', 'content0');
    const units = planWitcher3FolderImport(root, { perMod: false, langs: new Set(['en']) });
    expect(relPaths(units)).toEqual([['content/content0/en.w3strings']]);
  });

  it('keeps each mod folder name in its paths when importing per mod', () => {
    writeTable('en', { 2110000000: 'A' }, 'modA', 'content');
    writeTable('en', { 2110001000: 'B' }, 'modB', 'content');
    fs.mkdirSync(path.join(root, 'modEmpty'));

    const units = planWitcher3FolderImport(root, { perMod: true, langs: null });
    expect(units.map((unit) => unit.name)).toEqual(['modA', 'modB']);
    expect(relPaths(units)).toEqual([['modA/content/en.w3strings'], ['modB/content/en.w3strings']]);
  });
});

describe('collectW3LanguageTables', () => {
  it('keys every string by its table folder and id, and skips empty text', () => {
    writeTable('en', { 7: 'Wind’s howling.', 8: '' }, 'content', 'content0');
    writeTable('en', { 7: 'Another table' }, 'dlc', 'ep1', 'content');

    const en = collectW3LanguageTables(root).get('en')!;
    expect([...en.keys()].sort()).toEqual([
      w3RecordPath('content/content0', 7),
      w3RecordPath('dlc/ep1/content', 7),
    ]);
    expect(parseW3RecordPath(w3RecordPath('dlc/ep1/content', 7))).toEqual({
      contentDir: 'dlc/ep1/content',
      id: 7,
    });
  });
});

describe('language codes', () => {
  it('stores the Remastered ua table as uk and writes uk back as ua', () => {
    expect(w3AppLocale('ua')).toBe('uk');
    expect(w3AppLocale('esmx')).toBe('esmx');
    expect(w3SlotForTargetLang('uk')).toBe('ua');
    expect(w3SlotForTargetLang('pl')).toBe('pl');
  });
});

describe('voice in a folder import', () => {
  it('plans each content folder’s voice container beside its tables', () => {
    writeTable('en', { 1: 'Hmm.' }, 'content', 'content0');
    fs.writeFileSync(path.join(root, 'content', 'content0', 'enpc.w3speech'), 'CPSW');
    fs.writeFileSync(path.join(root, 'content', 'content0', 'plpc.w3speech'), 'CPSW');

    const all = planWitcher3FolderImport(root, { perMod: false, langs: null });
    expect(relPaths(all)).toEqual([
      [
        'content/content0/en.w3strings',
        'content/content0/enpc.w3speech',
        'content/content0/plpc.w3speech',
      ],
    ]);
    const en = planWitcher3FolderImport(root, { perMod: false, langs: new Set(['en']) });
    expect(relPaths(en)).toEqual([
      ['content/content0/en.w3strings', 'content/content0/enpc.w3speech'],
    ]);
  });
});

describe('scenes in a folder import', () => {
  it('takes scene files out of the archives and stages them loose', async () => {
    const { buildBundle, sceneWith } = await import('./fixtures');
    writeTable('en', { 1: 'Hmm.' }, 'content', 'content0');
    const bundles = path.join(root, 'content', 'content0', 'bundles');
    fs.mkdirSync(bundles, { recursive: true });
    const scene = sceneWith([{ id: 1, tag: 'GERALT' }]);
    fs.writeFileSync(
      path.join(bundles, 'blob.bundle'),
      buildBundle([
        { path: 'quests/q001/a.w2scene', data: scene, zip: true },
        { path: 'characters/models/x.xbm', data: Buffer.alloc(64) },
      ]),
    );
    const [unit] = planWitcher3FolderImport(root, { perMod: false, langs: null });
    const staged = unit!.files.find((file) => file.relPath === 'scenes/quests/q001/a.w2scene');
    expect(staged && 'read' in staged ? staged.read() : null).toEqual(scene);
    expect(unit!.files.some((file) => file.relPath.endsWith('.xbm'))).toBe(false);
  });

  it('plans scene files already lying loose, as a staged folder has them', () => {
    writeTable('en', { 1: 'Hmm.' }, 'content', 'content0');
    const scenes = path.join(root, 'scenes', 'quests', 'q001');
    fs.mkdirSync(scenes, { recursive: true });
    fs.writeFileSync(path.join(scenes, 'a.w2scene'), 'CR2W');
    fs.writeFileSync(
      path.join(root, 'scenes', 'scene_voice_tags.csv'),
      'Voicetag;Sex;Pitch;Template;Id',
    );
    fs.writeFileSync(path.join(root, 'scenes', 'notes.txt'), 'not a scene');

    const [unit] = planWitcher3FolderImport(root, { perMod: false, langs: null });
    expect(unit!.files.map((file) => file.relPath)).toEqual([
      'content/content0/en.w3strings',
      'scenes/quests/q001/a.w2scene',
      'scenes/scene_voice_tags.csv',
    ]);
    const loose = unit!.files.find((file) => file.relPath.endsWith('a.w2scene'));
    expect(loose && 'absPath' in loose ? loose.absPath : null).toBe(path.join(scenes, 'a.w2scene'));
  });

  it('leaves out a mod that has scenes but no string tables', async () => {
    const { buildBundle, sceneWith } = await import('./fixtures');
    fs.mkdirSync(path.join(root, 'modScenesOnly', 'content'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'modScenesOnly', 'content', 'blob0.bundle'),
      buildBundle([{ path: 'a.w2scene', data: sceneWith([{ id: 1, tag: 'GERALT' }]) }]),
    );
    expect(planWitcher3FolderImport(root, { perMod: true, langs: null })).toEqual([]);
  });
});
