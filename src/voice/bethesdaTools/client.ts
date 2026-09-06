const DEFAULT_TIMEOUT_MS = 135_000;

const requestTimeoutMs = (): number => {
  const raw = Number.parseInt(process.env.BETHESDA_TOOLS_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw + 15_000;
  return DEFAULT_TIMEOUT_MS;
};

/** POST JSON to bethesda-tools and return the raw octet-stream body. */
export const postBethesdaToolBinary = async (
  baseUrl: string,
  route: '/v1/lip' | '/v1/xwm',
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
    const detail = await response.text();
    throw new Error(`bethesda-tools ${route} HTTP ${response.status}: ${detail.slice(0, 240)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`bethesda-tools ${route} returned an empty body`);
  return bytes;
};
