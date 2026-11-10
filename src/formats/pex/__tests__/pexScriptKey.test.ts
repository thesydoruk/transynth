import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { collectModPexSources } from '../pexSources';
import { listLoosePexFiles, pexScriptBaseName, pexScriptKeyFromRelPath } from '../pexScriptKey';
import { pexScriptKeyFromRecordPath } from '../pexSourceLocate';
import { buildPex } from './pexFixture';

describe('pexScriptKeyFromRelPath', () => {
  it('keeps a top-level script under its bare name', () => {
    expect(pexScriptKeyFromRelPath('Scripts\\WSFW_Utility.pex')).toBe('WSFW_Utility');
  });

  it('turns the folders under Scripts into the namespace', () => {
    expect(pexScriptKeyFromRelPath('Scripts/SimSettlementsV2/Quests/SS2Main.pex')).toBe(
      'SimSettlementsV2:Quests:SS2Main',
    );
    expect(pexScriptKeyFromRelPath('SCRIPTS\\DLC01\\DLC01Caravan.pex')).toBe('DLC01:DLC01Caravan');
  });

  it('prefers the header spelling of the name when only the case differs', () => {
    expect(pexScriptKeyFromRelPath('scripts/wsfw_utility.pex', 'WSFW_Utility')).toBe(
      'WSFW_Utility',
    );
    expect(pexScriptKeyFromRelPath('Scripts/Ns/Foo.pex', 'Other')).toBe('Ns:Foo');
  });

  it('ignores files that are not compiled scripts', () => {
    expect(pexScriptKeyFromRelPath('Scripts/Source/User/Foo.psc')).toBeNull();
  });

  it('names the file stem of a namespaced key', () => {
    expect(pexScriptBaseName('SimSettlementsV2:Quests:SS2Main')).toBe('SS2Main');
    expect(pexScriptBaseName('SS2Main')).toBe('SS2Main');
  });
});

describe('pexScriptKeyFromRecordPath with namespaces', () => {
  it('keeps the namespace of a record path', () => {
    expect(pexScriptKeyFromRecordPath('PEX\\SimSettlementsV2:Actors:ForceVoiceType')).toBe(
      'simsettlementsv2:actors:forcevoicetype',
    );
  });
});

describe('loose scripts in an unpacked mod folder', () => {
  let modDir: string;

  const writePex = (rel: string, strings: string[], sourceFile = path.basename(rel, '.pex')) => {
    const full = path.join(modDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buildPex(strings, { sourceFile: `${sourceFile}.psc` }));
  };

  beforeEach(() => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pex-key-'));
    fs.writeFileSync(path.join(modDir, 'SS2.esm'), '');
  });

  afterEach(() => {
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it('lists scripts at any depth and under any case of Scripts', () => {
    writePex('Scripts/Top.pex', ['Hello there']);
    writePex('Scripts/SimSettlementsV2/Quests/SS2Main.pex', ['Give holotape']);
    fs.writeFileSync(path.join(modDir, 'Scripts', 'notes.txt'), 'x');

    expect(
      listLoosePexFiles(modDir)
        .map((f) => f.archivePath)
        .sort(),
    ).toEqual(['Scripts\\SimSettlementsV2\\Quests\\SS2Main.pex', 'Scripts\\Top.pex']);
  });

  it('finds an upper-case SCRIPTS folder', () => {
    writePex('SCRIPTS/DLC01/Caravan.pex', ['Trade with caravan']);

    expect(listLoosePexFiles(modDir).map((f) => f.archivePath)).toEqual([
      'SCRIPTS\\DLC01\\Caravan.pex',
    ]);
  });

  it('keeps two scripts that share a name in different namespaces apart', () => {
    writePex('Scripts/SimSettlementsV2/Actors/ForceVoiceType.pex', ['Actor line']);
    writePex('Scripts/SimSettlementsV2/Aliases/ForceVoiceType.pex', ['Alias line']);

    const sources = collectModPexSources(path.join(modDir, 'SS2.esm'));

    expect([...sources.keys()].sort()).toEqual([
      'simsettlementsv2:actors:forcevoicetype',
      'simsettlementsv2:aliases:forcevoicetype',
    ]);
    expect(sources.get('simsettlementsv2:aliases:forcevoicetype')?.archivePath).toBe(
      'Scripts\\SimSettlementsV2\\Aliases\\ForceVoiceType.pex',
    );
  });
});
