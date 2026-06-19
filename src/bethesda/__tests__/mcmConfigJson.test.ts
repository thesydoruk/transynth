import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractMcmStringsFromConfigJson,
  findMcmConfigJsonFiles,
  loadMcmLocalesFromConfigJson,
  mcmConfigJsonMatchesMod,
} from '../parsers/mcmConfigJson';

describe('extractMcmStringsFromConfigJson', () => {
  it('extracts id-based text and help keys', () => {
    const strings = extractMcmStringsFromConfigJson({
      modName: 'MyMod',
      displayName: 'My Mod',
      content: [
        { type: 'section', text: 'General' },
        {
          id: 'bIsEnabled:general',
          text: 'Enable mod',
          type: 'switcher',
          help: 'Turn the mod on or off.',
        },
      ],
      pages: [
        {
          pageDisplayName: 'Advanced',
          content: [
            { id: 'iValue:advanced', text: 'Value', type: 'slider', help: 'Adjust value.' },
          ],
        },
      ],
    });

    expect(strings.get('$displayName')).toBe('My Mod');
    expect(strings.get('$Main_section_1')).toBe('General');
    expect(strings.get('$bIsEnabled:general')).toBe('Enable mod');
    expect(strings.get('$bIsEnabled:general_help')).toBe('Turn the mod on or off.');
    expect(strings.get('$Page0_DisplayName')).toBe('Advanced');
    expect(strings.get('$iValue:advanced')).toBe('Value');
    expect(strings.get('$iValue:advanced_help')).toBe('Adjust value.');
  });

  it('registers $placeholder references without inline text', () => {
    const strings = extractMcmStringsFromConfigJson({
      content: [{ text: '$generalSettings', type: 'section' }],
    });

    expect(strings.get('$generalSettings')).toBe('$generalSettings');
  });
});

describe('loadMcmLocalesFromConfigJson', () => {
  it('loads config.json strings for matching mod prefixes', () => {
    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-config-'));
    const configDir = path.join(modDir, 'MCM', 'Config', 'WorkshopFramework');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        modName: 'WorkshopFramework',
        displayName: 'Workshop Framework',
        content: [{ id: 'StartupWorkshop', text: 'Start Workshop Mode', type: 'hotkey' }],
      }),
      'utf8',
    );

    const configPath = path.join(configDir, 'config.json');
    expect(findMcmConfigJsonFiles(modDir)).toEqual([configPath]);
    expect(mcmConfigJsonMatchesMod(configPath, ['WorkshopFramework'])).toBe(true);

    const locales = loadMcmLocalesFromConfigJson(modDir, ['WorkshopFramework']);
    expect(locales.get('en')?.get('$StartupWorkshop')).toBe('Start Workshop Mode');
    expect(locales.get('en')?.get('$displayName')).toBe('Workshop Framework');

    fs.rmSync(modDir, { recursive: true, force: true });
  });
});
