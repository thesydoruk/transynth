/** Minimal Hugging Face datasets-server client for audio+text rows. */

export type HfAudioRow = {
  rowIdx: number;
  audioUrl: string;
  duration: number | null;
  transcription: string;
  raw: Record<string, unknown>;
};

type HfRowsResponse = {
  rows?: Array<{
    row_idx: number;
    row: Record<string, unknown>;
  }>;
  num_rows_total?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const audioSrc = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (!first || typeof first !== 'object') return null;
  const src = (first as { src?: unknown }).src;
  return typeof src === 'string' && src ? src : null;
};

const fetchWithRetry = async (url: string, dataset: string): Promise<Response> => {
  let delayMs = 8_000;
  for (let attempt = 1; attempt <= 16; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (!RETRYABLE.has(res.status)) {
        throw new Error(`HF rows ${dataset}: HTTP ${res.status}`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delayMs;
      await sleep(waitMs);
      delayMs = Math.min(delayMs * 2, 180_000);
    } catch (err) {
      if (attempt >= 16) throw err;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 180_000);
    }
  }
  throw new Error(`HF rows ${dataset}: exhausted retries`);
};

export const fetchHfDatasetRows = async (
  dataset: string,
  offset: number,
  length: number,
  opts: { config?: string; split?: string } = {},
): Promise<{ rows: HfAudioRow[]; total: number }> => {
  const config = opts.config ?? 'default';
  const split = opts.split ?? 'train';
  const url =
    `https://datasets-server.huggingface.co/rows` +
    `?dataset=${encodeURIComponent(dataset)}` +
    `&config=${encodeURIComponent(config)}` +
    `&split=${encodeURIComponent(split)}` +
    `&offset=${offset}&length=${length}`;

  const res = await fetchWithRetry(url, dataset);
  const body = (await res.json()) as HfRowsResponse;
  const rows: HfAudioRow[] = [];
  for (const entry of body.rows ?? []) {
    const audioUrl = audioSrc(entry.row.audio);
    const transcription =
      typeof entry.row.transcription === 'string'
        ? entry.row.transcription
        : typeof entry.row.sentence === 'string'
          ? entry.row.sentence
          : '';
    if (!audioUrl || !transcription.trim()) continue;
    const duration =
      typeof entry.row.duration === 'number' && Number.isFinite(entry.row.duration)
        ? entry.row.duration
        : null;
    rows.push({
      rowIdx: entry.row_idx,
      audioUrl,
      duration,
      transcription: transcription.trim(),
      raw: entry.row,
    });
  }
  return { rows, total: body.num_rows_total ?? offset + rows.length };
};
