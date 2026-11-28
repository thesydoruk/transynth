import { fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import '../../../../../i18n';
import type { VoiceLinePreview, VoiceSpeakerLinesResponse } from '../../../../../api';
import { VoiceEffortBadge } from '../components/VoiceLinesView/VoiceEffortBadge';
import { effortBadgeView, patchVoiceLineEffort } from '../voiceEffort';

const line = (partial: Partial<VoiceLinePreview> = {}): VoiceLinePreview => ({
  lineKey: '021B2A',
  infoFormidHex: '00021B2A',
  variant: 1,
  fileName: '00021b2a_1.fuz',
  speakerKey: 'RaiderMale01',
  originPlugin: 'fallout4.esm',
  stringId: 1,
  translationId: null,
  status: 'draft',
  source: 'Get down!',
  translation: 'Лягай!',
  isReference: false,
  isInheritedAudio: false,
  inheritedFrom: null,
  isOrphanAudio: false,
  hasTranslationAudio: true,
  canGenerateVoice: false,
  ttsSkipReason: null,
  voiceSimilarity: 0.4,
  effortTag: null,
  effortAutoTag: null,
  effortOverride: null,
  effortStrength: null,
  ...partial,
});

describe('voice effort helpers', () => {
  it('shows a tag, a tag taken away by hand, or nothing', () => {
    expect(effortBadgeView(line({ effortTag: 'loud' }))).toEqual({ kind: 'tag', tag: 'loud' });
    expect(effortBadgeView(line({ effortAutoTag: 'shouting', effortOverride: 'none' }))).toEqual({
      kind: 'removed',
    });
    expect(effortBadgeView(line())).toEqual({ kind: 'empty' });
  });

  it('patches only the line the server answered for', () => {
    const other = line({ lineKey: '0AAAAA' });
    const data: VoiceSpeakerLinesResponse = {
      ok: true,
      speakerKey: 'RaiderMale01',
      lines: [line(), other],
    };
    const next = patchVoiceLineEffort(data, line(), {
      effortTag: 'shouting',
      effortAutoTag: null,
      effortOverride: 'shouting',
      effortStrength: 1.2,
    });
    expect(next?.ok && next.lines[0]?.effortOverride).toBe('shouting');
    expect(next?.ok && next.lines[1]).toBe(other);
  });
});

describe('VoiceEffortBadge', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the tag, its strength and that it was set automatically', () => {
    render(
      <VoiceEffortBadge
        line={line({ effortTag: 'shouting', effortAutoTag: 'shouting', effortStrength: 2.345 })}
        active
        onChoose={vi.fn()}
      />,
    );
    const badge = screen.getByRole('button', { name: /shouting/ });
    expect(badge).toHaveAttribute('title', 'Effort 2.35 · set automatically');
  });

  it('says the tags are off for the game while its switch is off', () => {
    render(
      <VoiceEffortBadge
        line={line({ effortTag: 'loud', effortOverride: 'loud', effortStrength: 0.8 })}
        active={false}
        onChoose={vi.fn()}
      />,
    );
    const title = screen.getByRole('button', { name: /loud/ }).getAttribute('title') ?? '';
    expect(title).toContain('set by hand (automatic: no tag)');
    expect(title).toContain('Effort tags are off for this game');
  });

  it('sets a tag from the menu of a line without one', () => {
    const onChoose = vi.fn();
    const target = line({ effortStrength: 0.3 });
    render(<VoiceEffortBadge line={target} active onChoose={onChoose} />);

    fireEvent.click(screen.getByRole('button', { name: /\+ tag/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Auto (no tag)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Shouting' }));

    expect(onChoose).toHaveBeenCalledWith(target, 'shouting');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
