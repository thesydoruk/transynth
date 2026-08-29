import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import '../../i18n';
import { NotFoundPage } from '../NotFoundPage';

describe('NotFoundPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the 404 copy and a link to the games catalogue', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('This address is not a route in Transynth.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to games' })).toHaveAttribute('href', '/');
  });
});
