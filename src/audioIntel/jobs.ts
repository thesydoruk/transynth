/**
 * audio-intel's batch lane: separation jobs (`separate=true`).
 *
 * The service answers `202` with a job id, runs the separation on its own lane, and
 * exposes the result and the per-speaker tracks under `/v1/jobs/{id}`. This client
 * submits, polls until the job settles, and downloads tracks; the `separate` service
 * pool picks the host and bounds how many jobs we have open against one instance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { servicePool } from '../services/pools';
import { parseAudioIntelTranscript } from './client';
import type { AudioIntelTranscript } from './types';

export type SeparationJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type SeparationJob = {
  id: string;
  status: SeparationJobStatus;
  stage: string;
  progress: number;
  error: string | null;
  /** Base URL of the audio-intel instance that holds the job. */
  host: string;
};

export type SeparationTracks = {
  speakers: Record<string, string>;
  background: string | null;
  speech: string | null;
  master: string | null;
  rttm: string | null;
  metadata: string | null;
};

export type SeparationResult = AudioIntelTranscript & {
  speakers: Array<{
    id: string;
    speech_seconds: number;
    segment_count: number;
    embedding?: number[];
    embedding_model?: string;
  }>;
  tracks: SeparationTracks;
  overlaps: Array<{ start: number; end: number }>;
  dropped_segments?: number;
  elapsed_s?: number;
};

export type SubmitSeparationOptions = {
  language?: string;
  align?: boolean;
  soundEvents?: boolean;
  signal?: AbortSignal;
};

const jobFromBody = (host: string, body: Record<string, unknown>): SeparationJob => ({
  id: String(body.id),
  status: (body.status as SeparationJobStatus) ?? 'queued',
  stage: typeof body.stage === 'string' ? body.stage : '',
  progress: typeof body.progress === 'number' ? body.progress : 0,
  error: typeof body.error === 'string' ? body.error : null,
  host,
});

/** `POST /v1/audio/transcriptions` with `separate=true` → the queued job. */
export const submitSeparation = async (
  mediaPath: string,
  options: SubmitSeparationOptions = {},
): Promise<SeparationJob> => {
  await ensureDependencyHealthy('separate');
  return servicePool('separate').run(async (host) => {
    const form = new FormData();
    const bytes = fs.readFileSync(mediaPath);
    form.append('file', new Blob([bytes]), path.basename(mediaPath));
    form.append('separate', 'true');
    if (options.language) form.append('language', options.language);
    if (options.align) form.append('align', 'true');
    if (options.soundEvents) form.append('sound_events', 'true');
    const response = await fetch(`${host}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: options.signal,
    });
    if (response.status !== 202) {
      const detail = await response.text().catch(() => '');
      throw Object.assign(
        new Error(
          `audio-intel separation submit failed (${response.status} ${host})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        ),
        { status: response.status },
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    return jobFromBody(host, body);
  });
};

/** `GET /v1/jobs/{id}`; the result is attached once the job is done. */
export const getSeparationJob = async (
  job: Pick<SeparationJob, 'id' | 'host'>,
  signal?: AbortSignal,
): Promise<{ job: SeparationJob; result: SeparationResult | null }> => {
  const response = await fetch(`${job.host}/v1/jobs/${encodeURIComponent(job.id)}`, { signal });
  if (!response.ok) {
    throw Object.assign(new Error(`audio-intel job ${job.id} not found (${response.status})`), {
      status: response.status,
    });
  }
  const body = (await response.json()) as Record<string, unknown>;
  const raw = body.result as Record<string, unknown> | undefined;
  const result = raw
    ? ({
        ...parseAudioIntelTranscript(raw),
        speakers: (raw.speakers as SeparationResult['speakers']) ?? [],
        tracks: raw.tracks as SeparationTracks,
        overlaps: (raw.overlaps as SeparationResult['overlaps']) ?? [],
        dropped_segments: raw.dropped_segments as number | undefined,
        elapsed_s: raw.elapsed_s as number | undefined,
      } satisfies SeparationResult)
    : null;
  return { job: jobFromBody(job.host, body), result };
};

export type WaitForSeparationOptions = {
  signal?: AbortSignal;
  pollMs?: number;
  /** Give up after this long without the job settling (default 2 h). */
  timeoutMs?: number;
  onProgress?: (job: SeparationJob) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const sleepWithSignal = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Poll until the job is done; throws on `failed` / `cancelled`, on abort, and on timeout. */
export const waitForSeparation = async (
  job: SeparationJob,
  options: WaitForSeparationOptions = {},
): Promise<SeparationResult> => {
  const sleep = options.sleep ?? sleepWithSignal;
  const pollMs = options.pollMs ?? 5_000;
  const deadline = Date.now() + (options.timeoutMs ?? 2 * 3_600_000);
  let lastStage = '';
  for (;;) {
    const { job: current, result } = await getSeparationJob(job, options.signal);
    if (current.stage !== lastStage) {
      lastStage = current.stage;
      options.onProgress?.(current);
    }
    if (current.status === 'done' && result) return result;
    if (current.status === 'failed' || current.status === 'cancelled') {
      throw new Error(
        `audio-intel job ${job.id} ${current.status}: ${current.error ?? 'no detail'}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`audio-intel job ${job.id} did not finish in time (stage ${current.stage})`);
    }
    await sleep(pollMs, options.signal);
  }
};

/** Download one track of a finished job to `destPath`. */
export const downloadSeparationFile = async (
  job: Pick<SeparationJob, 'id' | 'host'>,
  name: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(
    `${job.host}/v1/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(name)}`,
    { signal },
  );
  if (!response.ok || !response.body) {
    throw new Error(`audio-intel file ${name} of job ${job.id}: ${response.status}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    fs.createWriteStream(destPath),
  );
  return destPath;
};

/** Cancel a queued or running job, or delete a finished one and its files. */
export const deleteSeparationJob = async (
  job: Pick<SeparationJob, 'id' | 'host'>,
  signal?: AbortSignal,
): Promise<boolean> => {
  const response = await fetch(`${job.host}/v1/jobs/${encodeURIComponent(job.id)}`, {
    method: 'DELETE',
    signal,
  });
  return response.ok;
};
