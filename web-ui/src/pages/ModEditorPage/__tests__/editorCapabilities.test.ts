import { describe, expect, it } from 'vitest';
import { clampEditorPageMode, editorCapabilities, formatDiscoPoKey } from '../editorCapabilities';

describe('editorCapabilities', () => {
  it('hides Bethesda-only surfaces for disco', () => {
    const caps = editorCapabilities('disco');
    expect(caps.isDisco).toBe(true);
    expect(caps.modes).toEqual(['strings', 'voice']);
    expect(caps.showDialogsMode).toBe(false);
    expect(caps.showFormIdColumn).toBe(false);
    expect(caps.showGenderColumn).toBe(false);
    expect(caps.showSignaturePanel).toBe(false);
    expect(caps.showGenderDetect).toBe(false);
    expect(caps.showInnrLink).toBe(false);
  });

  it('keeps Bethesda defaults for fo4', () => {
    const caps = editorCapabilities('fo4');
    expect(caps.modes).toContain('dialogs');
    expect(caps.showFormIdColumn).toBe(true);
    expect(caps.showSignaturePanel).toBe(true);
  });

  it('clamps unsupported modes to strings', () => {
    expect(clampEditorPageMode('dialogs', editorCapabilities('disco'))).toBe('strings');
    expect(clampEditorPageMode('voice', editorCapabilities('disco'))).toBe('voice');
  });
});

describe('formatDiscoPoKey', () => {
  it('formats PO path as file · entry key', () => {
    expect(formatDiscoPoKey('PO\\Dialogues.po\\Kim::Hello')).toBe('Dialogues.po · Kim::Hello');
    expect(formatDiscoPoKey('PO/General.po/::Thought Cabinet')).toBe(
      'General.po · ::Thought Cabinet',
    );
  });
});
