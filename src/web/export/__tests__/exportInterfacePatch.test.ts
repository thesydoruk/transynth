import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import {
  interfaceTranslateArchivePath,
  writeInterfaceTranslateBuffer,
} from '../../../formats/interface';
import { exportInterfaceTranslateFile } from '../exportInterfacePatch';

const makeOverlayDb = (rows: Array<{ path: string; export_text: string }>): Tx =>
  ({
    query: async () => ({ rows }),
  }) as unknown as Tx;

describe('exportInterfaceTranslateFile', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iface-export-'));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes changed Translate_en.txt entries for FO4 Ukrainian export', async () => {
    const modPath = path.join(tmpDir, 'Fallout4.esm');
    fs.writeFileSync(modPath, Buffer.from('plugin'));
    fs.mkdirSync(path.join(tmpDir, 'Interface'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'Interface', 'Translate_en.txt'),
      writeInterfaceTranslateBuffer([
        { key: '$10 Mins', text: '10 Mins' },
        { key: '$ABORT', text: 'ABORT' },
      ]),
    );

    const db = makeOverlayDb([{ path: 'Interface\\Translate_en\\$10 Mins', export_text: '10 хв' }]);
    const result = await exportInterfaceTranslateFile(db, 1, modPath, 'en', 'uk', 'fo4');

    expect(result?.archivePath).toBe(interfaceTranslateArchivePath('uk', 'fo4'));
    expect(result?.changedCount).toBe(1);
    const text = result!.buffer.toString('utf16le');
    expect(text).toContain('10 хв');
    expect(text).toContain('ABORT');
  });
});
