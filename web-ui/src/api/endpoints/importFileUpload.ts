/** Where an uploaded EET or CSV file belongs; the server falls back to its defaults. */
export type ImportFileUploadOptions = {
  /** Registered game id of the page the file is uploaded on. */
  game?: string;
  srcLang?: string;
  tgtLang?: string;
};

/** `?game=…&srcLang=…&tgtLang=…`, or an empty string when nothing is set. */
export const uploadQuery = (options?: ImportFileUploadOptions): string => {
  const qs = new URLSearchParams();
  if (options?.game) qs.set('game', options.game);
  if (options?.srcLang) qs.set('srcLang', options.srcLang);
  if (options?.tgtLang) qs.set('tgtLang', options.tgtLang);
  return qs.toString() ? `?${qs}` : '';
};
