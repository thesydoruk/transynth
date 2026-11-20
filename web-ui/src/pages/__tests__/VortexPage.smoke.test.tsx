import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VortexGroupState, VortexMachine } from '../../api';
import '../../i18n';

const group = {
  id: 3,
  game: 'fo4',
  group_key: 'fo4:c:/vortex/fallout4/mods',
  label: 'Vortex · fallout4',
  staging_path: 'C:\\Vortex\\fallout4\\mods',
  game_dir: 'C:\\Games\\Fallout 4',
};

const langpack = { archiveId: 14, runId: 5, fileName: 'fo4_uk_langpack.zip', byteSize: 1048576 };

/** A machine last seen long ago, so the page shows it offline. */
const machine = (
  id: number,
  agentKey: string,
  own: Partial<VortexMachine> = {},
): VortexMachine => ({
  id,
  vortex_group_id: 3,
  agent_key: agentKey,
  agent_version: '0.10.0',
  state: 'idle',
  state_json: { pollSec: 30, pending: null, lastRunId: 5, delivered: null },
  last_error: null,
  last_sync_at: '2026-11-05T01:00:00Z',
  last_seen_at: '2026-11-05T01:00:00Z',
  staging_path: 'C:\\Vortex\\fallout4\\mods',
  game_dir: 'C:\\Games\\Fallout 4',
  mod_count: 26,
  game_version: '1.10.984',
  latestLangpack: null,
  ...own,
});

const stateOf = (machines: VortexMachine[]): VortexGroupState => ({
  group,
  agent: machines[0] ?? null,
  machines,
  currentRun: null,
  latestLangpack: langpack,
  services: { llm: false, embed: true, tts: true },
  probedAt: '2026-11-05T02:00:00Z',
});

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
    // Each test renders its own page: without this the earlier ones stay in the document.
    cleanup();
    vi.restoreAllMocks();
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
    vi.spyOn(api.vortex, 'state').mockResolvedValue(
      stateOf([machine(1, 'gaming-pc', { latestLangpack: langpack })]),
    );
    vi.spyOn(api.vortex, 'runs').mockResolvedValue({ runs: [] });
    await renderPage();

    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'gaming-pc' })).toBeInTheDocument();
    expect(screen.getByText('0.10.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LLM translate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voice' })).toBeEnabled();
    // One machine: the export is its own, nothing to choose and nothing to forget.
    expect(screen.getByRole('button', { name: 'Export langpack' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget this machine' })).not.toBeInTheDocument();
    // A link, not a fetch: the browser's download manager takes a 5 GB langpack.
    const link = screen.getByRole('link', { name: /fo4_uk_langpack\.zip \(1 MiB\)/ });
    expect(link).toHaveAttribute('href', '/api/vortex/sync/5/langpack');
    expect(link).toHaveAttribute('download', 'fo4_uk_langpack.zip');
  });

  it('shows every machine of the group and exports for the one chosen', async () => {
    const { api } = await import('../../api');
    vi.spyOn(api.vortex, 'groups').mockResolvedValue({ groups: [group] });
    vi.spyOn(api.vortex, 'state').mockResolvedValue(
      stateOf([
        machine(1, 'gaming-pc', { latestLangpack: langpack, mod_count: 26 }),
        machine(2, 'laptop', { mod_count: null, game_version: '1.10.163' }),
      ]),
    );
    vi.spyOn(api.vortex, 'runs').mockResolvedValue({ runs: [] });
    const start = vi
      .spyOn(api.vortex, 'startStage')
      .mockResolvedValue({ ok: true, runId: 9, jobId: 1, stage: 'export' });
    const forget = vi.spyOn(api.vortex, 'forgetMachine').mockResolvedValue({ ok: true });
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'laptop' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'gaming-pc' })).toBeInTheDocument();
    expect(screen.getByText('not synced yet')).toBeInTheDocument();
    // The langpack is the desk's: the laptop has none of its own.
    expect(screen.getAllByRole('link', { name: /fo4_uk_langpack/ })).toHaveLength(1);
    expect(screen.getByText('none exported yet')).toBeInTheDocument();

    const exportButton = screen.getByRole('button', { name: 'Export langpack' });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAttribute('title', 'Choose the machine to export for');
    expect(screen.getByRole('button', { name: 'Voice' })).toBeEnabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Stages for' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export langpack' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(3, 'export', undefined, 2));

    fireEvent.click(screen.getAllByRole('button', { name: 'Forget this machine' })[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(forget).toHaveBeenCalledWith(3, 2));
  });
});
