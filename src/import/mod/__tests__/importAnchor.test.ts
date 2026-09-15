import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterPrimaryPlugins, isSecondaryPluginPath } from '../importAnchor';
import { gamePlugin } from '../../../games/registry';

describe('import anchors', () => {
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
    const anchor = gamePlugin('fo4').import.selectAnchor(root);
    expect(anchor && path.basename(anchor)).toBe('FallUIInv_en.txt');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('selects a Final Cut .po pack for Disco Elysium', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-anchor-'));
    const lang = path.join(root, 'English_English_en');
    fs.mkdirSync(lang, { recursive: true });
    fs.writeFileSync(
      path.join(lang, 'Dialogues.po'),
      'msgid ""\nmsgstr ""\n\nmsgid "Hello"\nmsgstr "Hello"\n',
      'utf8',
    );

    const anchor = gamePlugin('disco').import.selectAnchor(root);
    expect(anchor && path.basename(anchor)).toBe('Dialogues.po');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
