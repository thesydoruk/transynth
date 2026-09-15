import { describe, expect, it } from 'vitest';
import type { GameEditorProfile } from '../../../api/types/games';
import {
  clampEditorPageMode,
  defaultEditorCapabilities,
  formatPoKey,
  formatRowFieldLabel,
} from '../editorCapabilities';

/** A profile shaped like the one a gettext-based game's plugin sends. */
const poKeyProfile: GameEditorProfile = {
  modes: ['strings', 'voice'],
  columns: { formId: false, signature: true, gender: false },
  actions: { genderDetect: false, innrLink: false },
  labels: { signature: 'discoType', edid: 'discoAudio', field: 'discoKey' },
  recordPathStyle: 'po-key',
};

const poKeyCaps = {
  ...defaultEditorCapabilities('disco'),
  ...poKeyProfile,
  usesRecordPaths: false,
};

describe('editor capabilities', () => {
  it('falls back to a permissive profile before the catalogue loads', () => {
    const caps = defaultEditorCapabilities('fo4');
    expect(caps.modes).toContain('dialogs');
    expect(caps.columns.formId).toBe(true);
    expect(caps.usesRecordPaths).toBe(true);
  });

  it('clamps a mode the game does not offer back to strings', () => {
    expect(clampEditorPageMode('dialogs', poKeyCaps)).toBe('strings');
    expect(clampEditorPageMode('voice', poKeyCaps)).toBe('voice');
  });
});

describe('row field labels', () => {
  it('formats a gettext path as file · entry key', () => {
    expect(formatPoKey('PO\\Dialogues.po\\Kim::Hello')).toBe('Dialogues.po · Kim::Hello');
    expect(formatPoKey('PO/General.po/::Thought Cabinet')).toBe('General.po · ::Thought Cabinet');
  });

  it('shows the last segment of a record path, and the whole gettext key', () => {
    const recordCaps = defaultEditorCapabilities('fo4');
    expect(formatRowFieldLabel('INFO\\NAM1', recordCaps)).toBe('NAM1');
    expect(formatRowFieldLabel('PO\\Dialogues.po\\Kim::Hello', poKeyCaps)).toBe(
      'Dialogues.po · Kim::Hello',
    );
  });
});
