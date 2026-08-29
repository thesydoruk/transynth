/** Default bind when `HOST` is unset — loopback only. */
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

export const resolveListenHost = (raw: string | undefined): string =>
  raw?.trim() || DEFAULT_LISTEN_HOST;

export const isLoopbackHost = (host: string): boolean =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1';
