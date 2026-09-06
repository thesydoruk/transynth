/** Base URL of the bethesda-tools sidecar, or null when unset. */
export const resolveBethesdaToolsUrl = (): string | null => {
  const raw = process.env.BETHESDA_TOOLS_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
};

export const requireBethesdaToolsUrl = (): string => {
  const url = resolveBethesdaToolsUrl();
  if (url) return url;
  throw new Error('BETHESDA_TOOLS_URL is not set');
};
