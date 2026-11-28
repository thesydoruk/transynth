import { fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import '../../../../../i18n';
import { VoiceRegenerateEffortChoice } from '../components/VoiceRegenerateEffortChoice';

describe('VoiceRegenerateEffortChoice', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('uk');
  });

  it('names the analysis tag under "auto" and reports a new choice', () => {
    const onChange = vi.fn();
    render(<VoiceRegenerateEffortChoice value="auto" autoTag="shouting" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Авто (крик)' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Без тегу' }));
    expect(onChange).toHaveBeenCalledWith('none');
  });
});
