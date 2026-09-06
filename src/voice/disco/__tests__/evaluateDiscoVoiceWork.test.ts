import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toDiskPath } from '../../../modImport';
import type { VoiceFileEntry } from '../../discoverVoiceFiles';
import { voiceTranslationMapKey, type VoiceTranslationRow } from '../../loadVoiceTranslations';
import { voiceTtsPayloadVersionFromPrepared } from '../../voiceTtsPayloadVersion';
import { voiceSynthesisStateKey } from '../../voiceSynthesisState';
import { discoVoiceSpeakerKey } from '../discoverDiscoVoiceFiles';
import { evaluateDiscoVoiceWork, type DiscoVoiceWorkFilter } from '../evaluateDiscoVoiceWork';
import { outputLocalizedWavRelPath } from '../voicePaths';

const entry: VoiceFileEntry = {
  relPath: 'Audio/Kim Kitsuragi-YARD-1.wav',
  absolutePath: path.join(os.tmpdir(), 'transynth-missing-kim.wav'),
  fileName: 'Kim Kitsuragi-YARD-1.wav',
  formidLower6: 'ABCDEF123456',
  variant: 1,
  ext: 'wav',
};

const row: VoiceTranslationRow = {
  formidLower6: entry.formidLower6,
  infoFormidHex: '00ABCDEF',
  voiceVariant: 1,
  stringId: 1,
  translationId: 2,
  status: 'translated',
  source: 'Hello, detective.',
  translation: 'Вітаю, детективе.',
  edid: null,
};

const translations = new Map([[voiceTranslationMapKey(entry.formidLower6, entry.variant), row]]);

const baseFilter = (
  localizeDir: string,
  extra: Partial<DiscoVoiceWorkFilter> = {},
): DiscoVoiceWorkFilter => ({
  speakerFilter: '',
  tgtLang: 'uk',
  localizeDir,
  storedVersions: new Map(),
  forceAll: false,
  transcribe: false,
  ...extra,
});

describe('evaluateDiscoVoiceWork', () => {
  let localizeDir: string;

  beforeEach(() => {
    localizeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-voice-work-'));
  });

  afterEach(() => {
    fs.rmSync(localizeDir, { recursive: true, force: true });
  });

  it('counts a synthesizable line that has no localized wav yet', async () => {
    const item = await evaluateDiscoVoiceWork(entry, translations, baseFilter(localizeDir));
    expect(item?.row).toBe(row);
    expect(item?.prepared.action).toBe('synthesize');
  });

  it('skips a clip that is already current — same rule as the job total', async () => {
    const first = await evaluateDiscoVoiceWork(entry, translations, baseFilter(localizeDir));
    expect(first).not.toBeNull();

    const dest = toDiskPath(localizeDir, outputLocalizedWavRelPath(entry));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'wav');

    const storedVersions = new Map([
      [
        voiceSynthesisStateKey(discoVoiceSpeakerKey(entry), entry.formidLower6, entry.variant),
        voiceTtsPayloadVersionFromPrepared(first!.prepared, 'uk'),
      ],
    ]);

    const again = await evaluateDiscoVoiceWork(
      entry,
      translations,
      baseFilter(localizeDir, { storedVersions }),
    );
    expect(again).toBeNull();
  });

  it('includes already-current clips when force-all is set', async () => {
    const first = await evaluateDiscoVoiceWork(entry, translations, baseFilter(localizeDir));
    const dest = toDiskPath(localizeDir, outputLocalizedWavRelPath(entry));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'wav');
    const storedVersions = new Map([
      [
        voiceSynthesisStateKey(discoVoiceSpeakerKey(entry), entry.formidLower6, entry.variant),
        voiceTtsPayloadVersionFromPrepared(first!.prepared, 'uk'),
      ],
    ]);

    const forced = await evaluateDiscoVoiceWork(
      entry,
      translations,
      baseFilter(localizeDir, { storedVersions, forceAll: true }),
    );
    expect(forced).not.toBeNull();
  });
});
