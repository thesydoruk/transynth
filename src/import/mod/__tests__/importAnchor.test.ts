import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  filterPrimaryPlugins,
  isSecondaryPluginPath,
  selectArchiveImportAnchor,
} from '../importAnchor';

describe('importAnchor', () => {
  it('treats Optional/fomod plugins as secondary', () => {
    expect(isSecondaryPluginPath('mod/Optional/Helper.esp')).toBe(true);
    expect(isSecondaryPluginPath('mod/fomod/dummy.esl')).toBe(true);
    expect(isSecondaryPluginPath('mod/FallUI - Inventory/Main.esp')).toBe(false);
  });

  it('selects MCM translation when only Optional plugins exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fallui-anchor-'));
    const pkg = path.join(root, 'FallUI - Inventory');
    const trans = path.join(pkg, 'Interface', 'FallUI Inventory', 'Translation');
    const optional = path.join(root, 'Optional');
    fs.mkdirSync(trans, { recursive: true });
    fs.mkdirSync(optional, { recursive: true });
    fs.writeFileSync(path.join(trans, 'FallUIInv_en.txt'), '$A\tOne\n', 'utf8');
    fs.writeFileSync(path.join(optional, 'Helper.esp'), Buffer.from('TES4'));

    expect(filterPrimaryPlugins([path.join(optional, 'Helper.esp')])).toEqual([]);
    const anchor = selectArchiveImportAnchor(root);
    expect(anchor.isPlugin).toBe(false);
    expect(path.basename(anchor.anchorPath)).toBe('FallUIInv_en.txt');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
