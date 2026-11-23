const DEFAULT_TIMEOUT_MS = 135_000;

const requestTimeoutMs = (): number => {
  const raw = Number.parseInt(process.env.BETHESDA_TOOLS_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw + 15_000;
  return DEFAULT_TIMEOUT_MS;
};

/**
 * The service's `{ ok: false, error }` message, or the raw body. A tool failure carries
 * the tool's own output (LipGenerator's stdout, the tail of ffxc's log), so the
 * message keeps its lines and is cut only well past a short error.
 */
const errorDetail = (body: string): string => {
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') detail = parsed.error;
  } catch {
    // Not JSON: a proxy page or a crash; keep the text.
  }
  return detail.slice(0, 2000);
};

/** POST JSON to bethesda-tools and return the raw octet-stream body. */
export const postBethesdaToolBinary = async (
  baseUrl: string,
  route: '/v1/lip' | '/v1/xwm' | '/v1/ffxanim',
  body: unknown,
): Promise<Buffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`bethesda-tools ${route}: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = errorDetail(await response.text());
    throw new Error(`bethesda-tools ${route} HTTP ${response.status}: ${detail}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`bethesda-tools ${route} returned an empty body`);
  return bytes;
};
