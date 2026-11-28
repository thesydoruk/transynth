import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceEffortResultDialog } from '../VoiceEffortResultDialog';

const RESULT = {
  modId: 7,
  takes: 1200,
  measured: 800,
  failed: 3,
  speakers: 14,
  speakersWithBaseline: 9,
  shouting: 61,
  loud: 12,
  skipped: false,
};

describe('VoiceEffortResultDialog', () => {
  it('lists what the analysis found and closes', () => {
    const onClose = vi.fn();
    render(<VoiceEffortResultDialog result={RESULT} modName="Base" onClose={onClose} />);

    for (const value of ['1200', '800', '3', '61', '12']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    // Failed takes get the "tried again next time" note.
    expect(screen.getByText('modEditor.voiceEffortResult.failedHint')).toBeInTheDocument();

    // The header's close button and the footer's both close it; press the footer's.
    fireEvent.click(screen.getAllByRole('button', { name: 'common.close' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });
});
