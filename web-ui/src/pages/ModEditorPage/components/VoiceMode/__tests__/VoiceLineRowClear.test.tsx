import { fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import '../../../../../i18n';
import type { VoiceLinePreview } from '../../../../../api';
import { VoiceLineRow, type VoiceLineRowProps } from '../components/VoiceLinesView/VoiceLineRow';

const line = (partial: Partial<VoiceLinePreview> = {}): VoiceLinePreview => ({
  lineKey: '825D9B',
  infoFormidHex: '00825D9B',
  variant: 1,
  fileName: '00825d9b_1.fuz',
  speakerKey: 'PlayerVoiceFemale01',
  originPlugin: 'fallout4.esm',
  stringId: 11,
  translationId: 5,
  status: 'draft',
  source: 'Hello.',
  translation: 'Привіт.',
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

const renderRow = (target: VoiceLinePreview, props: Partial<VoiceLineRowProps> = {}) => {
  const onClear = vi.fn();
  const onCommit = vi.fn();
  render(
    <VoiceLineRow
      line={target}
      focused={false}
      editing={false}
      saving={false}
      playingTrack={null}
      loadingTrack={null}
      setReferencePending={false}
      generatePending={false}
      regenerateOpen={false}
      onFocus={vi.fn()}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
      onCommit={onCommit}
      onClear={onClear}
      onPlay={vi.fn()}
      onSetReference={vi.fn()}
      onGenerate={vi.fn()}
      onRegenerate={vi.fn()}
      {...props}
    />,
  );
  return { onClear, onCommit, button: screen.getByRole('button', { name: 'Clear' }) };
};

describe('VoiceLineRow Clear', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('says it removes the take too and asks the voice clear, not a plain text save', () => {
    const row = renderRow(line());

    expect(row.button).toHaveAttribute('title', 'Remove the translation and its voice take');
    fireEvent.click(row.button);
    expect(row.onClear).toHaveBeenCalledTimes(1);
    expect(row.onCommit).not.toHaveBeenCalled();
  });

  it('is enabled by a take alone', () => {
    expect(renderRow(line({ translation: null })).button).toBeEnabled();
  });

  it('is disabled with neither text nor take', () => {
    const row = renderRow(line({ translation: null, hasTranslationAudio: false }));
    expect(row.button).toBeDisabled();
  });

  it('waits while a voice job is synthesizing the line', () => {
    expect(renderRow(line(), { synthesizing: true }).button).toBeDisabled();
  });

  it('shows Generate again once the take is gone', () => {
    renderRow(line({ hasTranslationAudio: false, voiceSimilarity: null, canGenerateVoice: true }));
    expect(screen.queryByRole('button', { name: /Regenerate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });
});
