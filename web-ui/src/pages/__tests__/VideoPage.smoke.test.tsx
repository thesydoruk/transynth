import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';

const intro = {
  id: 1,
  game: 'fo4',
  agent_key: 'gaming-pc',
  file_name: 'Intro_ru.bk2',
  byte_size: 366088784,
  fingerprint: 'abc',
  duration_s: 164.5,
  track_ids: [0, 1],
  source_track_id: 0,
  audio_rel_path: 'fo4/1/source.wav',
  status: 'uploaded',
  mod_id: null,
  dub_rel_path: null,
  dub_version: null,
  error: null,
  created_at: '2026-11-05T18:00:00Z',
  updated_at: '2026-11-05T18:00:00Z',
};

const renderPage = async () => {
  const { VideoPage } = await import('../VideoPage');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/games/fo4/video']}>
        <Routes>
          <Route path="/games/:gameId/video" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('VideoPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => {
    vi.resetModules();
  });

  it('explains how to turn the scan on when nothing is registered', async () => {
    const { api } = await import('../../api');
    vi.spyOn(api.video, 'list').mockResolvedValue({ assets: [] });
    await renderPage();

    expect(await screen.findByText('No videos registered yet')).toBeInTheDocument();
    expect(screen.getByText(/"videos": true/)).toBeInTheDocument();
  });

  it('lists a registered video with its length, tracks, status and a player', async () => {
    const { api } = await import('../../api');
    vi.spyOn(api.video, 'list').mockResolvedValue({
      assets: [
        intro,
        {
          ...intro,
          id: 2,
          file_name: 'STRENGTH.bk2',
          audio_rel_path: null,
          status: 'registered',
          track_ids: [1, 2, 3, 4, 5],
          source_track_id: 1,
          duration_s: 137.9,
        },
      ],
    });
    await renderPage();

    expect(await screen.findByText('Intro_ru.bk2')).toBeInTheDocument();
    expect(screen.getByText('2:45')).toBeInTheDocument();
    expect(screen.getByText('2 track(s), source 0')).toBeInTheDocument();
    expect(screen.getByText('audio uploaded')).toBeInTheDocument();
    expect(screen.getByLabelText('Source narration')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/video/fo4/1/audio/source'),
    );
    expect(screen.getByText('STRENGTH.bk2')).toBeInTheDocument();
    expect(screen.getByText('5 track(s), source 1')).toBeInTheDocument();
    expect(screen.getByText('waiting for audio')).toBeInTheDocument();
    expect(screen.getByText('no audio yet')).toBeInTheDocument();
  });
});
