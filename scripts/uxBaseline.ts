import fs from 'node:fs';
import path from 'node:path';

type CliOptions = {
  baseUrl: string;
  srcLang: string;
  targetLang: string;
  samples: number;
  warmup: number;
  timeoutMs: number;
  outPath: string | null;
};

type EndpointStats = {
  name: string;
  path: string;
  samples: number;
  errors: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
};

type ModRow = {
  id: number;
  name: string;
};

type StringListResponse = {
  rows?: Array<{ string_id: number }>;
  total?: number;
};

type BaselineReport = {
  generatedAt: string;
  baseUrl: string;
  srcLang: string;
  targetLang: string;
  sampleCount: number;
  warmupCount: number;
  selectedModId: number | null;
  selectedStringId: number | null;
  metrics: EndpointStats[];
};

const DEFAULT_OPTIONS: CliOptions = {
  baseUrl: 'http://localhost:3000',
  srcLang: 'en',
  targetLang: 'uk',
  samples: 5,
  warmup: 1,
  timeoutMs: 15000,
  outPath: null,
};

const parseArgs = (): CliOptions => {
  const next = { ...DEFAULT_OPTIONS };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === '--base-url' && value) {
      next.baseUrl = value;
      i += 1;
      continue;
    }
    if (arg === '--src-lang' && value) {
      next.srcLang = value;
      i += 1;
      continue;
    }
    if (arg === '--target-lang' && value) {
      next.targetLang = value;
      i += 1;
      continue;
    }
    if (arg === '--samples' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.samples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === '--warmup' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        next.warmup = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.timeoutMs = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === '--out' && value) {
      next.outPath = value;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  next.baseUrl = next.baseUrl.replace(/\/+$/, '');
  return next;
};

const printHelp = () => {
  console.log('Usage: npm run ux:baseline -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --base-url <url>      API base URL (default: http://localhost:3000)');
  console.log('  --src-lang <lang>     Source language (default: en)');
  console.log('  --target-lang <lang>  Target language (default: uk)');
  console.log('  --samples <n>         Measured requests per endpoint (default: 5)');
  console.log('  --warmup <n>          Warmup requests per endpoint (default: 1)');
  console.log('  --timeout-ms <n>      Request timeout in milliseconds (default: 15000)');
  console.log('  --out <path>          Optional path to write JSON report');
};

const timedGet = async (baseUrl: string, reqPath: string, timeoutMs: number): Promise<number> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}${reqPath}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return performance.now() - startedAt;
  } finally {
    clearTimeout(timer);
  }
};

const getJson = async <T>(baseUrl: string, reqPath: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${reqPath}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${reqPath}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const calcStats = (durations: number[]) => {
  const sorted = [...durations].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const avgMs = sorted.length ? sorted.reduce((sum, val) => sum + val, 0) / sorted.length : 0;
  const p95Index = sorted.length ? Math.max(0, Math.ceil(sorted.length * 0.95) - 1) : 0;
  const p95Ms = sorted[p95Index] ?? 0;
  return { minMs, maxMs, avgMs, p95Ms };
};

const measureEndpoint = async (
  name: string,
  reqPath: string,
  options: CliOptions,
): Promise<EndpointStats> => {
  for (let i = 0; i < options.warmup; i += 1) {
    try {
      await timedGet(options.baseUrl, reqPath, options.timeoutMs);
    } catch {
      // Warmup failures are ignored to keep the benchmark run resilient.
    }
  }

  const durations: number[] = [];
  let errors = 0;
  for (let i = 0; i < options.samples; i += 1) {
    try {
      durations.push(await timedGet(options.baseUrl, reqPath, options.timeoutMs));
    } catch {
      errors += 1;
    }
  }

  const stats = calcStats(durations);
  return {
    name,
    path: reqPath,
    samples: durations.length,
    errors,
    minMs: Number(stats.minMs.toFixed(2)),
    maxMs: Number(stats.maxMs.toFixed(2)),
    avgMs: Number(stats.avgMs.toFixed(2)),
    p95Ms: Number(stats.p95Ms.toFixed(2)),
  };
};

const renderConsoleTable = (rows: EndpointStats[]) => {
  const header = ['Metric', 'Samples', 'Errors', 'Avg (ms)', 'P95 (ms)', 'Min (ms)', 'Max (ms)'];
  const widths = [34, 8, 7, 9, 9, 9, 9];

  const pad = (value: string, width: number) => value.padEnd(width, ' ');
  const line = (cells: string[]) => cells.map((cell, idx) => pad(cell, widths[idx] ?? 10)).join(' | ');

  console.log(line(header));
  console.log(widths.map((width) => ''.padEnd(width, '-')).join('-|-'));
  for (const row of rows) {
    console.log(
      line([
        row.name,
        String(row.samples),
        String(row.errors),
        row.avgMs.toFixed(2),
        row.p95Ms.toFixed(2),
        row.minMs.toFixed(2),
        row.maxMs.toFixed(2),
      ]),
    );
  }
};

const main = async () => {
  const options = parseArgs();

  const langParams = new URLSearchParams({
    srcLang: options.srcLang,
    targetLang: options.targetLang,
  }).toString();

  let selectedModId: number | null = null;
  let selectedStringId: number | null = null;

  try {
    const mods = await getJson<ModRow[]>(options.baseUrl, `/api/mods?${langParams}`, options.timeoutMs);
    for (const mod of mods) {
      const strings = await getJson<StringListResponse>(
        options.baseUrl,
        `/api/strings?modId=${mod.id}&${langParams}&page=1&pageSize=100`,
        options.timeoutMs,
      );
      if ((strings.total ?? 0) > 0 || (strings.rows?.length ?? 0) > 0) {
        selectedModId = mod.id;
        selectedStringId = strings.rows?.[0]?.string_id ?? null;
        break;
      }
    }
  } catch (error) {
    console.warn('Unable to preload mod/string context for editor and TM metrics.');
    console.warn(String(error));
  }

  const endpoints: Array<{ name: string; path: string }> = [
    { name: 'Dashboard stats', path: `/api/stats/dashboard?${langParams}` },
    { name: 'Mods list', path: `/api/mods?${langParams}` },
    { name: 'Import jobs list', path: '/api/mod-import' },
  ];

  if (selectedModId != null) {
    endpoints.push({
      name: 'Editor strings page (100 rows)',
      path: `/api/strings?modId=${selectedModId}&${langParams}&page=1&pageSize=100`,
    });
  }

  if (selectedStringId != null) {
    endpoints.push({
      name: 'TM suggestions lookup',
      path: `/api/strings/${selectedStringId}/suggestions?targetLang=${encodeURIComponent(options.targetLang)}`,
    });
  }

  const metrics: EndpointStats[] = [];
  for (const endpoint of endpoints) {
    metrics.push(await measureEndpoint(endpoint.name, endpoint.path, options));
  }

  const report: BaselineReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    srcLang: options.srcLang,
    targetLang: options.targetLang,
    sampleCount: options.samples,
    warmupCount: options.warmup,
    selectedModId,
    selectedStringId,
    metrics,
  };

  console.log('');
  console.log('UX baseline report');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Base URL: ${report.baseUrl}`);
  console.log(`Lang pair: ${report.srcLang} -> ${report.targetLang}`);
  if (selectedModId != null) {
    console.log(`Selected mod: ${selectedModId}`);
  } else {
    console.log('Selected mod: n/a (no mods returned)');
  }
  console.log('');
  renderConsoleTable(metrics);

  if (options.outPath) {
    const absOutPath = path.resolve(options.outPath);
    fs.mkdirSync(path.dirname(absOutPath), { recursive: true });
    fs.writeFileSync(absOutPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('');
    console.log(`Saved JSON report to ${absOutPath}`);
  }
};

void main().catch((error) => {
  console.error('UX baseline script failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
