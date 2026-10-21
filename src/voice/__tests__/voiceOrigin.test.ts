import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildVoiceOriginResolver,
  isOriginVoiceKey,
  normalizeVoiceOrigin,
  originFormidKey,
  originFromVoiceRelPath,
  readVoiceOriginMasters,
  speakerFromVoiceRelPath,
  splitOriginFormidKey,
} from '../voiceOrigin';

const subrecord = (sig: string, text: string): Buffer => {
  const data = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 'ascii');
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
};

const writePlugin = (dir: string, name: string, masters: string[]): string => {
  const data = Buffer.concat([
    subrecord('CNAM', 'Author'),
    ...masters.map((m) => subrecord('MAST', m)),
  ]);
  const header = Buffer.alloc(24);
  header.write('TES4', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([header, data, Buffer.alloc(32)]));
  return file;
};

const withTempDir = (fn: (dir: string) => void): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-origin-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('normalizeVoiceOrigin', () => {
  it('trims and lower-cases; missing becomes empty', () => {
    expect(normalizeVoiceOrigin('  Fallout4.ESM ')).toBe('fallout4.esm');
    expect(normalizeVoiceOrigin(null)).toBe('');
    expect(normalizeVoiceOrigin(undefined)).toBe('');
  });
});

describe('buildVoiceOriginResolver', () => {
  const resolver = buildVoiceOriginResolver('C:/Data/Unofficial Fallout 4 Patch.esp', [
    'Fallout4.esm',
    'DLCRobot.esm',
  ]);

  it('exposes the lower-cased own name and the masters as written', () => {
    expect(resolver.ownOrigin).toBe('unofficial fallout 4 patch.esp');
    expect(resolver.masters).toEqual(['Fallout4.esm', 'DLCRobot.esm']);
  });

  it('maps the top byte to the master at that index, lower-cased', () => {
    expect(resolver.originOfFormid('00001234')).toBe('fallout4.esm');
    expect(resolver.originOfFormid('01ABCDEF')).toBe('dlcrobot.esm');
  });

  it('treats an index past the master list as the plugin itself', () => {
    expect(resolver.originOfFormid('02000001')).toBe('unofficial fallout 4 patch.esp');
    expect(resolver.originOfFormid('FF000001')).toBe('unofficial fallout 4 patch.esp');
  });

  it('treats FE (light plugin) FormIDs as own', () => {
    expect(resolver.originOfFormid('FE000800')).toBe('unofficial fallout 4 patch.esp');
  });

  it('accepts lower-case and short hex', () => {
    expect(resolver.originOfFormid('01abcdef')).toBe('dlcrobot.esm');
    expect(resolver.originOfFormid('1234')).toBe('fallout4.esm');
  });

  it('makes every record own when there are no masters', () => {
    const none = buildVoiceOriginResolver('Mod.esp', []);
    expect(none.originOfFormid('00000001')).toBe('mod.esp');
    expect(none.originOfFormid('00ABCDEF')).toBe('mod.esp');
  });
});

describe('originFromVoiceRelPath / speakerFromVoiceRelPath', () => {
  const rel = 'Data/Sound/Voice/Fallout4.esm/MaleRough/00012345_1.fuz';

  it('reads the origin folder (lower-cased) and the speaker folder', () => {
    expect(originFromVoiceRelPath(rel)).toBe('fallout4.esm');
    expect(speakerFromVoiceRelPath(rel)).toBe('MaleRough');
  });

  it('accepts backslashes and a missing Data prefix', () => {
    const win = 'Data\\Sound\\Voice\\Fallout4.esm\\MaleRough\\00012345_1.fuz';
    expect(originFromVoiceRelPath(win)).toBe('fallout4.esm');
    expect(speakerFromVoiceRelPath(win)).toBe('MaleRough');
    expect(originFromVoiceRelPath('sound/voice/Mod.esp/Npc/00000001_1.fuz')).toBe('mod.esp');
  });

  it('returns null for a path without a voice tree', () => {
    expect(originFromVoiceRelPath('00012345_1.fuz')).toBeNull();
    expect(originFromVoiceRelPath('Data/Textures/foo.dds')).toBeNull();
    expect(speakerFromVoiceRelPath('00012345_1.fuz')).toBeNull();
  });

  it('has no speaker when the file sits directly under the origin', () => {
    expect(originFromVoiceRelPath('Sound/Voice/Mod.esp/00000001_1.fuz')).toBe('mod.esp');
    expect(speakerFromVoiceRelPath('Sound/Voice/Mod.esp/00000001_1.fuz')).toBeNull();
  });
});

describe('originFormidKey / splitOriginFormidKey', () => {
  it('builds <origin>/<FORMID6> with the origin lower-cased and the FormID upper-cased', () => {
    expect(originFormidKey('Fallout4.esm', '00abcd')).toBe('fallout4.esm/00ABCD');
  });

  it('omits the origin when absent', () => {
    expect(originFormidKey(null, '00abcd')).toBe('00ABCD');
    expect(originFormidKey('', '00abcd')).toBe('00ABCD');
  });

  it('round-trips', () => {
    const key = originFormidKey('Unofficial Fallout 4 Patch.esp', '016D03');
    expect(splitOriginFormidKey(key)).toEqual({
      origin: 'unofficial fallout 4 patch.esp',
      lineKey: '016D03',
    });
  });

  it('splits a bare key without an origin', () => {
    expect(splitOriginFormidKey('016D03')).toEqual({ origin: null, lineKey: '016D03' });
  });
});

describe('isOriginVoiceKey', () => {
  it('accepts origin-qualified take keys only', () => {
    expect(isOriginVoiceKey('fallout4.esm/123456:1')).toBe(true);
    expect(isOriginVoiceKey('123456:1')).toBe(false);
    expect(isOriginVoiceKey('fallout4.esm/123456')).toBe(false);
  });
});

describe('readVoiceOriginMasters', () => {
  it('reads the MAST list from a TES4 header', () => {
    withTempDir((dir) => {
      const file = writePlugin(dir, 'Patch.esp', ['Fallout4.esm', 'DLCCoast.esm']);
      expect(readVoiceOriginMasters(file)).toEqual(['Fallout4.esm', 'DLCCoast.esm']);
    });
  });

  it('returns [] for a plugin without masters', () => {
    withTempDir((dir) => {
      expect(readVoiceOriginMasters(writePlugin(dir, 'Solo.esp', []))).toEqual([]);
    });
  });

  it('returns [] for a missing path and for a non-TES4 file', () => {
    expect(
      readVoiceOriginMasters(path.join(os.tmpdir(), 'does-not-exist-voice-origin.esp')),
    ).toEqual([]);
    withTempDir((dir) => {
      const file = path.join(dir, 'junk.esp');
      fs.writeFileSync(file, Buffer.alloc(64, 1));
      expect(readVoiceOriginMasters(file)).toEqual([]);
    });
  });
});
