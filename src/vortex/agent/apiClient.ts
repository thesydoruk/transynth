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
import { vortexUnitKey } from '../groupKey';
import type { VortexFanOutStage } from '../stages';
import type {
  VideoUploadTask,
  VortexAgentHeartbeat,
  VortexExportOrder,
  VortexLatestLangpack,
} from '../types';

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
  /** The newest langpack; the group's dubbed videos travel in it. */
  latestLangpack: VortexLatestLangpack | null;
  /** Videos the import registered whose file the agent has not uploaded yet. */
  videoUploads?: VideoUploadTask[];
};

export type AgentApi = ReturnType<typeof createAgentApi>;

/** Official Voices/Main archives are multi-GB: no header or body timeout on uploads. */
const uploadAgent = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 0 });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The server looked at the unit and refused it (nothing it can import). Only
 * the route's own 5xx counts: a page or an empty 2xx is an upload that went
 * nowhere, not a refusal.
 */
export const isUploadRejection = (message: string): boolean =>
  /^Upload .+ failed: 5\d\d\b/.test(message) || /Archive holds no/.test(message);

/** The upload route answers `{ job: { id }, unitId }` for the unit it registered. */
export const isRegisteredUpload = (body: string, unitId: string): boolean => {
  try {
    const parsed = JSON.parse(body) as { job?: { id?: unknown }; unitId?: unknown };
    return parsed.unitId === unitId && typeof parsed.job?.id === 'number';
  } catch {
    return false;
  }
};

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

  /** Multipart PUT of one file from disk, streamed, without a body timeout. */
  const putFile = async (
    suffix: string,
    filePath: string,
    mime: string,
    label: string,
  ): Promise<{ status: number; text: string }> => {
    const blob = await openAsBlob(filePath, { type: mime });
    const form = new FormData();
    form.append('file', blob, path.basename(filePath));
    const res = await undiciFetch(url(suffix), {
      method: 'PUT',
      headers: headers(),
      body: form,
      dispatcher: uploadAgent,
    }).catch((err: unknown) => {
      // `fetch failed` alone says nothing; the cause (ECONNRESET, EPIPE…) does.
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Upload ${label} failed: ${message}${cause ? ` (${cause})` : ''}`);
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Upload ${label} failed: ${res.status} ${text}`);
    return { status: res.status, text };
  };

  /**
   * Upload one unit and insist the server registered it. A 2xx that is not the
   * route's own answer (a page, an empty body) means the upload went nowhere.
   */
  const putUnitZip = async (runId: number, unitId: string, zipPath: string): Promise<void> => {
    const { status, text } = await putFile(
      `/api/vortex/sync/${runId}/packs/${vortexUnitKey(unitId)}`,
      zipPath,
      'application/zip',
      unitId,
    );
    if (!isRegisteredUpload(text, unitId)) {
      throw new Error(
        `Upload ${unitId} was not registered by the server (${status}: ${text.slice(0, 120)})`,
      );
    }
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
    putVideoFile: async (modId: number, id: number, filePath: string): Promise<void> => {
      await putFile(
        `/api/mods/${modId}/video/${id}/file`,
        filePath,
        'application/octet-stream',
        `video #${id}`,
      );
    },
  };
};
