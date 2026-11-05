/**
 * The agent's (and the manual CLI's) view of the server: JSON calls with the
 * CLI token, file-backed uploads of unit zips, and polling a run to its end.
 */
import fs from 'node:fs';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import type { VortexFanOutStage } from '../stages';
import type { VortexAgentHeartbeat, VortexExportOrder, VortexLatestLangpack } from '../types';

export type VortexRunView = {
  id: number;
  status: string;
  stage?: string | null;
  current_stage: string | null;
  last_completed_stage: string | null;
  error: string | null;
  export_archive_id?: number | null;
};

export type HeartbeatReply = {
  ok: boolean;
  groupId: number;
  latestLangpack: VortexLatestLangpack | null;
};

export type AgentApi = ReturnType<typeof createAgentApi>;

/** Official Voices/Main archives are multi-GB: no header or body timeout on uploads. */
const uploadAgent = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 0 });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createAgentApi = (opts: { api: string; token?: string }) => {
  const base = opts.api.replace(/\/+$/, '');
  const headers = (): Record<string, string> =>
    opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
  const url = (suffix: string): string => `${base}${suffix}`;

  /**
   * A LAN hiccup (`fetch failed`, a reset) must not fail a sync that is
   * otherwise fine; the server's own answers (4xx/5xx) are never retried.
   */
  const fetchWithRetry = async (
    input: string,
    init: RequestInit | undefined,
    attempts = 3,
  ): Promise<Response> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetch(input, init);
      } catch (err) {
        if (attempt >= attempts) throw err;
        await sleep(2000 * attempt);
      }
    }
  };

  const json = async <T>(suffix: string, init?: RequestInit): Promise<T> => {
    const res = await fetchWithRetry(url(suffix), {
      ...init,
      headers: { Accept: 'application/json', ...headers(), ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${suffix}: ${text}`);
    return text ? (JSON.parse(text) as T) : ({} as T);
  };

  const post = <T>(suffix: string, body: unknown): Promise<T> =>
    json<T>(suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const putUnitZip = async (runId: number, unitId: string, zipPath: string): Promise<void> => {
    const blob = await openAsBlob(zipPath, { type: 'application/zip' });
    const form = new FormData();
    form.append('file', blob, path.basename(zipPath));
    const res = await undiciFetch(
      url(`/api/vortex/sync/${runId}/packs/${encodeURIComponent(unitId)}`),
      {
        method: 'PUT',
        headers: headers(),
        body: form,
        dispatcher: uploadAgent,
      },
    ).catch((err: unknown) => {
      // `fetch failed` alone says nothing; the cause (ECONNRESET, EPIPE…) does.
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Upload ${unitId} failed: ${message}${cause ? ` (${cause})` : ''}`);
    });
    if (!res.ok) throw new Error(`Upload ${unitId} failed: ${await res.text()}`);
  };

  /** Poll a run until it completes; throws on failure or cancellation. */
  const waitRun = async (
    runId: number,
    onTick?: (run: VortexRunView) => void,
    pollMs = 3000,
  ): Promise<VortexRunView> => {
    for (;;) {
      const run = await json<VortexRunView>(`/api/vortex/sync/${runId}`);
      onTick?.(run);
      if (run.status === 'completed') return run;
      if (run.status === 'failed' || run.status === 'cancelled') {
        throw new Error(run.error || `run #${runId} ${run.status}`);
      }
      await sleep(pollMs);
    }
  };

  const downloadFile = async (suffix: string, destPath: string): Promise<number> => {
    const res = await fetch(url(suffix), { headers: headers() });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
    if (!res.body) throw new Error('Download failed: empty body');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(destPath));
    return fs.statSync(destPath).size;
  };

  return {
    json,
    post,
    putUnitZip,
    waitRun,
    heartbeat: (beat: VortexAgentHeartbeat) =>
      post<HeartbeatReply>('/api/vortex/agent/heartbeat', beat),
    postExportOrder: (groupId: number, exportOrder: VortexExportOrder) =>
      post<{ ok: boolean }>(`/api/vortex/groups/${groupId}/export-order`, { exportOrder }),
    startRange: (runId: number, from: string, to: string, extra: Record<string, unknown> = {}) =>
      post<{ ok: boolean; jobId?: number; skipped?: boolean }>(`/api/vortex/sync/${runId}/start`, {
        from,
        to,
        ...extra,
      }),
    startStage: (
      groupId: number,
      stage: VortexFanOutStage | 'export',
      body: Record<string, unknown> = {},
    ) =>
      post<{ ok: boolean; runId: number; jobId: number }>(
        `/api/vortex/groups/${groupId}/stage/${stage}`,
        body,
      ),
    downloadLangpack: (runId: number, destPath: string) =>
      downloadFile(`/api/vortex/sync/${runId}/langpack`, destPath),
  };
};
