import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';

const game = {
  id: 'fo4',
  name: 'Fallout 4',
  developer: 'Bethesda Game Studios',
  releaseYear: 2015,
  engine: 'Creation Engine',
};

const renderAt = async (path: string) => {
  const { GameLayout } = await import('../GameLayout');
  const { api } = await import('../../api');
  vi.spyOn(api.games, 'list').mockResolvedValue([game] as never);
  vi.spyOn(api.reference, 'count').mockResolvedValue({ count: 12 } as never);
  vi.spyOn(api.vortex, 'groups').mockResolvedValue({ groups: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/:gameId" element={<GameLayout />}>
            <Route index element={<p>mods section</p>} />
            <Route path="nexus/:nexusModId" element={<p>nexus mod</p>} />
            <Route path="glossary" element={<p>glossary section</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('GameLayout', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(cleanup);

  it('frames a section with the crumb and the tabs, the current one marked', async () => {
    await renderAt('/games/fo4/glossary');

    expect(await screen.findByText('glossary section')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Fallout 4' })).toHaveAttribute('href', '/games/fo4');

    // The reference count arrives after the tabs do.
    expect(await screen.findByText('12')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Game sections' });
    const names = Array.from(tabs.querySelectorAll('a')).map((a) => a.textContent);
    expect(names).toEqual([
      'Mods',
      'Nexus',
      'Coherence',
      'Diff',
      'Reference12',
      'Glossary',
      'Vortex',
    ]);
    expect(screen.getByRole('link', { name: 'Glossary' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Mods' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the Nexus tab current on a Nexus mod and the Mods tab only on the index', async () => {
    await renderAt('/games/fo4/nexus/4598');

    expect(await screen.findByText('nexus mod')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nexus' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Mods' })).not.toHaveAttribute('aria-current');
  });

  it('says the game is unknown instead of rendering a section', async () => {
    await renderAt('/games/nope/glossary');

    expect(await screen.findByText('Game not found')).toBeInTheDocument();
    expect(screen.queryByText('glossary section')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Game sections' })).not.toBeInTheDocument();
  });
});
