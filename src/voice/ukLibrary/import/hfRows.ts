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

const audioSrc = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (!first || typeof first !== 'object') return null;
  const src = (first as { src?: unknown }).src;
  return typeof src === 'string' && src ? src : null;
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

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF rows ${dataset}: HTTP ${res.status}`);
  }
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
