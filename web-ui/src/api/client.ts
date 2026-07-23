// Thin API client — all calls go through the same base URL
export const BASE = import.meta.env.VITE_API_URL ?? '';

export const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  /* Only set Content-Type: application/json when the request carries a body.
     Fastify 5 rejects requests with Content-Type: application/json but no body
     (FST_ERR_CTP_EMPTY_JSON_BODY), which breaks DELETE / POST calls without a payload. */
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

/**
 * Fetches a binary file from the API and triggers a browser download.
 * Used for endpoints that return raw binary content (e.g. ZIP archives)
 * instead of JSON.
 *
 * @param path - API endpoint path
 * @param fallbackName - Filename to use if the server doesn't provide one
 */
export const downloadBinary = async (path: string, fallbackName: string): Promise<void> => {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  // Extract filename from Content-Disposition header if available
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
