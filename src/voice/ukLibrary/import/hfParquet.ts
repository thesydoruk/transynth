import { request } from 'undici';

export type HfTreeEntry = {
  type: string;
  path: string;
  size?: number;
};

/** List `data/*.parquet` shards for a public HF dataset repo. */
export const listHfDatasetParquetPaths = async (dataset: string): Promise<string[]> => {
  const url = `https://huggingface.co/api/datasets/${dataset}/tree/main/data`;
  const res = await request(url, { maxRedirections: 5 });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`HF tree ${dataset}: HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  const entries = (await res.body.json()) as HfTreeEntry[];
  return entries
    .filter((e) => e.type === 'file' && e.path.toLowerCase().endsWith('.parquet'))
    .map((e) => e.path)
    .sort();
};

export const hfDatasetResolveUrl = (dataset: string, filePath: string): string =>
  `https://huggingface.co/datasets/${dataset}/resolve/main/${filePath}`;
