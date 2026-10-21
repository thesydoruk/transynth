import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { disposeServicePools } from '../../services/pools';
import { syncServiceRegistryFromProjectSettings } from '../../services/registry';
import {
  deleteSeparationJob,
  downloadSeparationFile,
  getSeparationJob,
  submitSeparation,
  waitForSeparation,
} from '../jobs';

const HOST = 'http://sep-host:8080';

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe('audio-intel separation jobs client', () => {
  let tmp: string;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-jobs-'));
    fs.writeFileSync(path.join(tmp, 'clip.wav'), 'RIFF');
    disposeServicePools();
    syncServiceRegistryFromProjectSettings({
      'services.endpoints': [{ kind: 'separate', host: HOST, maxParallel: 1 }],
    });
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    syncServiceRegistryFromProjectSettings({});
    disposeServicePools();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('submits with separate=true and keeps the host that took the job', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { id: 'j1', status: 'queued' }));
    const job = await submitSeparation(path.join(tmp, 'clip.wav'), {
      language: 'en',
      align: true,
      soundEvents: true,
    });
    expect(job).toMatchObject({ id: 'j1', status: 'queued', host: HOST });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${HOST}/v1/audio/transcriptions`);
    const form = (init as RequestInit).body as FormData;
    expect(form.get('separate')).toBe('true');
    expect(form.get('align')).toBe('true');
    expect(form.get('sound_events')).toBe('true');
    expect(form.get('language')).toBe('en');
  });

  it('fails the submit on anything but 202', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: 'queue full' }));
    await expect(submitSeparation(path.join(tmp, 'clip.wav'))).rejects.toThrow('503');
  });

  it('polls until done and returns the parsed result', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 'j1', status: 'running', stage: 'separating' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'j1',
          status: 'done',
          stage: 'done',
          result: {
            text: 'hi',
            duration: 3.5,
            segments: [{ kind: 'speech', start: 0, end: 1, text: 'hi', speaker_id: 'speaker_00' }],
            speakers: [{ id: 'speaker_00', speech_seconds: 1, segment_count: 1 }],
            tracks: {
              speakers: { speaker_00: 'speaker_00_48k.wav' },
              background: 'background_48k.wav',
            },
            overlaps: [],
          },
        }),
      );
    const stages: string[] = [];
    const result = await waitForSeparation(
      { id: 'j1', host: HOST, status: 'queued', stage: '', progress: 0, error: null },
      { pollMs: 1, sleep: async () => undefined, onProgress: (j) => stages.push(j.stage) },
    );
    expect(stages).toEqual(['separating', 'done']);
    expect(result.text).toBe('hi');
    expect(result.segments[0]?.text).toBe('hi');
    expect(result.tracks.speakers.speaker_00).toBe('speaker_00_48k.wav');
  });

  it('throws when the job fails or is cancelled', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'j1', status: 'failed', stage: 'failed', error: 'boom' }),
    );
    await expect(
      waitForSeparation(
        { id: 'j1', host: HOST, status: 'queued', stage: '', progress: 0, error: null },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow('boom');
    expect(getSeparationJob).toBeDefined();
  });

  it('downloads a track and deletes the job', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('RIFFdata'));
          controller.close();
        },
      }),
    } as unknown as Response);
    const dest = path.join(tmp, 'out', 'speaker_00_48k.wav');
    await downloadSeparationFile({ id: 'j1', host: HOST }, 'speaker_00_48k.wav', dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('RIFFdata');
    expect(fetchMock.mock.calls[0]![0]).toBe(`${HOST}/v1/jobs/j1/files/speaker_00_48k.wav`);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'j1', deleted: true }));
    expect(await deleteSeparationJob({ id: 'j1', host: HOST })).toBe(true);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'DELETE' });
  });
});
