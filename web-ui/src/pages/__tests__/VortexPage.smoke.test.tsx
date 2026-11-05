import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';

const group = {
  id: 3,
  game: 'fo4',
  group_key: 'fo4:c:/vortex/fallout4/mods',
  label: 'Vortex · fallout4',
  staging_path: 'C:\\Vortex\\fallout4\\mods',
  game_dir: 'C:\\Games\\Fallout 4',
};

const renderPage = async () => {
  const { VortexPage } = await import('../VortexPage');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/games/fo4/vortex']}>
        <Routes>
          <Route path="/games/:gameId/vortex" element={<VortexPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('VortexPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => {
    vi.resetModules();
  });

  it('explains how to start the agent when no group exists', async () => {
    const { api } = await import('../../api');
    vi.spyOn(api.vortex, 'groups').mockResolvedValue({ groups: [] });
    await renderPage();

    expect(await screen.findByText('No Vortex agent yet')).toBeInTheDocument();
    expect(screen.getByText(/npm run vortex:agent -- --init/)).toBeInTheDocument();
  });

  it('shows an offline agent and disables the stages whose host is down', async () => {
    const { api } = await import('../../api');
    vi.spyOn(api.vortex, 'groups').mockResolvedValue({ groups: [group] });
    vi.spyOn(api.vortex, 'state').mockResolvedValue({
      group,
      agent: {
        id: 1,
        vortex_group_id: 3,
        agent_key: 'gaming-pc',
        agent_version: '0.10.0',
        state: 'idle',
        state_json: { pollSec: 30, pending: null, lastRunId: 5, delivered: null },
        last_error: null,
        last_sync_at: '2026-11-05T01:00:00Z',
        last_seen_at: '2026-11-05T01:00:00Z',
      },
      currentRun: null,
      latestLangpack: {
        archiveId: 14,
        runId: 5,
        fileName: 'fo4_uk_langpack.zip',
        byteSize: 1048576,
      },
      services: { llm: false, embed: true, tts: true },
      probedAt: '2026-11-05T02:00:00Z',
    });
    vi.spyOn(api.vortex, 'runs').mockResolvedValue({ runs: [] });
    await renderPage();

    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.getByText('gaming-pc · 0.10.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LLM translate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voice' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export langpack' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /fo4_uk_langpack\.zip \(1 MiB\)/ }),
    ).toBeInTheDocument();
  });
});
